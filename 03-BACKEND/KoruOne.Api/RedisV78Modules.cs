// KORU_V781_REDIS_OPERATIONS
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.RegularExpressions;
using StackExchange.Redis;

public static class RedisV78Modules
{
    private const string Stream = "koru:lab:events:v78";
    private const string Group = "koru-lab-group";
    private const string Consumer = "portal-operator";

    private static readonly ConcurrentDictionary<
        string, Lazy<Task<ConnectionMultiplexer>>
    > Pool = new();

    private static bool Viewer(ClaimsPrincipal u) =>
        Auth.Has(u, "admin", "redis-viewer", "redis-operator");

    private static bool Operator(ClaimsPrincipal u) =>
        Auth.Has(u, "admin", "redis-operator");

    private static bool Dev() =>
        Environment.GetEnvironmentVariable(
            "ASPNETCORE_ENVIRONMENT") == "Development";

    private static async Task<ConnectionMultiplexer> Connect(
        string node)
    {
        int port = node == "streams" ? 6380 : 6379;

        string env = node == "streams"
            ? "REDIS_STREAMS_PASSWORD"
            : "REDIS_CACHE_PASSWORD";

        string? password = Environment.GetEnvironmentVariable(env);

        if (string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException(
                "Redis monitoring credentials missing.");

        var lazy = Pool.GetOrAdd(
            node,
            _ => new Lazy<Task<ConnectionMultiplexer>>(
                async () =>
                {
                    var options = new ConfigurationOptions
                    {
                        Password = password,
                        AllowAdmin = true,
                        AbortOnConnectFail = false,
                        ConnectTimeout = 3000,
                        AsyncTimeout = 3000
                    };

                    options.EndPoints.Add("127.0.0.1", port);

                    return await ConnectionMultiplexer
                        .ConnectAsync(options);
                })
        );

        try
        {
            return await lazy.Value;
        }
        catch
        {
            Pool.TryRemove(node, out _);
            throw;
        }
    }

    public static void MapRedisV78(this WebApplication app)
    {
        var api = app.MapGroup("/api/v7")
            .RequireAuthorization();

        api.MapGet("/streams/overview", Overview);
        api.MapPost("/streams/demo/initialize", Initialize);
        api.MapPost("/streams/demo/publish", Publish);
        api.MapPost("/streams/demo/deliver", Deliver);
        api.MapPost("/streams/demo/ack/{id}", Acknowledge);

        api.MapGet("/redis/acl/{node}", AclInventory);
    }

    private static async Task<IResult> Overview(
        ClaimsPrincipal user)
    {
        if (!Viewer(user)) return Results.Forbid();

        try
        {
            var redis = await Connect("streams");
            var db = redis.GetDatabase();

            if (!await db.KeyExistsAsync(Stream))
            {
                return Results.Ok(new
                {
                    connected = redis.IsConnected,
                    initialized = false,
                    streamKey = Stream,
                    length = 0L,
                    groups = Array.Empty<object>(),
                    pending = Array.Empty<object>(),
                    consumers = Array.Empty<object>(),
                    recent = Array.Empty<object>()
                });
            }

            var length = await db.StreamLengthAsync(Stream);

            var groups = await db.StreamGroupInfoAsync(Stream);

            // StackExchange.Redis 2.8: messageOrder, order degil.
            var recent = await db.StreamRangeAsync(
                Stream,
                count: 12,
                messageOrder: Order.Descending
            );

            object[] pending = Array.Empty<object>();
            object[] consumers = Array.Empty<object>();

            bool initialized = groups.Any(
                g => g.Name == Group);

            if (initialized)
            {
                var p = await db.StreamPendingMessagesAsync(
                    Stream, Group, 20, RedisValue.Null);

                pending = p.Select(x => (object)new
                {
                    id = x.MessageId.ToString(),
                    consumer = x.ConsumerName.ToString(),
                    idleMs = x.IdleTimeInMilliseconds,
                    deliveries = x.DeliveryCount
                }).ToArray();

                var c = await db.StreamConsumerInfoAsync(
                    Stream, Group);

                consumers = c.Select(x => (object)new
                {
                    name = x.Name,
                    pending = x.PendingMessageCount,
                    idleMs = x.IdleTimeInMilliseconds
                }).ToArray();
            }

            return Results.Ok(new
            {
                connected = redis.IsConnected,
                initialized,
                streamKey = Stream,
                length,

                groups = groups.Select(g => new
                {
                    name = g.Name,
                    consumers = g.ConsumerCount,
                    pending = g.PendingMessageCount,
                    lag = g.Lag,
                    lastDeliveredId = g.LastDeliveredId
                }).ToArray(),

                pending,
                consumers,

                recent = recent.Select(e => new
                {
                    id = e.Id.ToString(),
                    fields = e.Values
                        .Where(v =>
                            v.Name == "event" ||
                            v.Name == "source" ||
                            v.Name == "createdAt")
                        .ToDictionary(
                            v => v.Name.ToString(),
                            v => v.Value.ToString())
                }).ToArray()
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 OVERVIEW] " +
                ex.GetType().Name + ": " + ex.Message);

            return Results.Problem(
                "Streams metrikleri okunamadi.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> Initialize(
        ClaimsPrincipal user)
    {
        if (!Operator(user)) return Results.Forbid();
        if (!Dev()) return Results.StatusCode(403);

        try
        {
            var db = (await Connect("streams")).GetDatabase();

            try
            {
                await db.StreamCreateConsumerGroupAsync(
                    Stream,
                    Group,
                    "0-0",
                    createStream: true);
            }
            catch (RedisServerException ex)
                when (ex.Message.Contains("BUSYGROUP"))
            {
                // Mevcut gruba dokunulmaz.
            }

            return Results.Ok(new
            {
                initialized = true,
                streamKey = Stream,
                group = Group
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 INIT] " + ex.Message);

            return Results.Problem(
                "Lab stream baslatilamadi.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> Publish(
        V78Publish input,
        ClaimsPrincipal user)
    {
        if (!Operator(user)) return Results.Forbid();
        if (!Dev()) return Results.StatusCode(403);

        string eventType = input.EventType?.Trim() ?? "";

        if (!Regex.IsMatch(
            eventType,
            @"^[A-Za-z0-9_.-]{1,36}$"))
        {
            return Results.BadRequest(new
            {
                message = "Event tipi gecersiz."
            });
        }

        try
        {
            var db = (await Connect("streams")).GetDatabase();

            var groups = await db.StreamGroupInfoAsync(Stream);

            if (!groups.Any(g => g.Name == Group))
            {
                return Results.Conflict(new
                {
                    message = "Once lab consumer group'u baslatin."
                });
            }

            var length = await db.StreamLengthAsync(Stream);

            if (length >= 2000)
            {
                return Results.Conflict(new
                {
                    message = "Lab 2000 mesaj limitine ulasti."
                });
            }

            var id = await db.StreamAddAsync(
                Stream,
                new[]
                {
                    new NameValueEntry("event", eventType),
                    new NameValueEntry(
                        "source", "koru-v78-demo"),
                    new NameValueEntry(
                        "createdAt",
                        DateTimeOffset.UtcNow.ToString("O"))
                }
            );

            return Results.Ok(new
            {
                published = true,
                id = id.ToString()
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 PUBLISH] " + ex.Message);

            return Results.Problem(
                "Lab eventi uretilemedi.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> Deliver(
        V78Deliver input,
        ClaimsPrincipal user)
    {
        if (!Operator(user)) return Results.Forbid();
        if (!Dev()) return Results.StatusCode(403);

        try
        {
            var db = (await Connect("streams")).GetDatabase();

            var entries = await db.StreamReadGroupAsync(
                Stream,
                Group,
                Consumer,
                position: ">",
                count: Math.Clamp(input.Count, 1, 5),
                noAck: false
            );

            return Results.Ok(new
            {
                delivered = entries.Length,
                ids = entries.Select(
                    e => e.Id.ToString()).ToArray()
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 DELIVER] " + ex.Message);

            return Results.Problem(
                "Consumer'a teslim basarisiz.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> Acknowledge(
        string id,
        ClaimsPrincipal user)
    {
        if (!Operator(user)) return Results.Forbid();
        if (!Dev()) return Results.StatusCode(403);

        if (!Regex.IsMatch(id, @"^\d+-\d+$"))
            return Results.BadRequest();

        try
        {
            var db = (await Connect("streams")).GetDatabase();

            var count = await db.StreamAcknowledgeAsync(
                Stream, Group, id);

            return Results.Ok(new
            {
                acknowledged = count,
                id
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 ACK] " + ex.Message);

            return Results.Problem(
                "ACK basarisiz.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> AclInventory(
        string node,
        ClaimsPrincipal user)
    {
        if (!Operator(user)) return Results.Forbid();

        if (node != "cache" && node != "streams")
            return Results.NotFound();

        try
        {
            var redis = await Connect(node);
            var db = redis.GetDatabase();

            // Sadece isimler. ACL LIST/GETUSER yok.
            var response = await db.ExecuteAsync("ACL", "USERS");

            RedisResult[] users =
                (RedisResult[]?)response
                ?? Array.Empty<RedisResult>();

            var current = await db.ExecuteAsync(
                "ACL", "WHOAMI");

            return Results.Ok(new
            {
                node,
                connected = redis.IsConnected,
                authenticatedAs = current.ToString(),
                users = users
                    .Select(x => x.ToString())
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .OrderBy(x => x)
                    .ToArray(),
                credentialsIncluded = false,
                mode = "read-only",
                checkedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V78 ACL] " + node + ": " +
                ex.GetType().Name + ": " + ex.Message);

            return Results.Problem(
                "ACL envanteri okunamadi.",
                statusCode: 503);
        }
    }
}

public record V78Publish(string? EventType);
public record V78Deliver(int Count);
