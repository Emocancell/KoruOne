// KORU_V79_ACL_SECURITY_PRO

using System.Collections.Concurrent;
using System.Security.Claims;
using StackExchange.Redis;

public static class RedisAclProV79
{
    private sealed record Probe(
        string Id,
        string Label,
        string Category,
        string[] Args
    );

    private static readonly Probe[] Probes =
    {
        new(
            "get", "GET", "Data Read",
            new[] { "GET", "koru:acl:probe:v79" }
        ),
        new(
            "set", "SET", "Data Write",
            new[] {
                "SET", "koru:acl:probe:v79", "example"
            }
        ),
        new(
            "del", "DEL", "Data Delete",
            new[] { "DEL", "koru:acl:probe:v79" }
        ),
        new(
            "xadd", "XADD", "Streams Write",
            new[] {
                "XADD", "koru:lab:events:v78",
                "*", "event", "dryrun"
            }
        ),
        new(
            "xreadgroup", "XREADGROUP", "Streams Read",
            new[] {
                "XREADGROUP", "GROUP",
                "koru-lab-group", "portal-operator",
                "COUNT", "1",
                "STREAMS", "koru:lab:events:v78", ">"
            }
        ),
        new(
            "flushall", "FLUSHALL", "Dangerous",
            new[] { "FLUSHALL" }
        ),
        new(
            "config", "CONFIG SET", "Administration",
            new[] {
                "CONFIG", "SET",
                "maxmemory", "1048576"
            }
        ),
        new(
            "acl-admin", "ACL SETUSER", "Administration",
            new[] {
                "ACL", "SETUSER",
                "koru-v79-dryrun", "on"
            }
        )
    };

    private static readonly ConcurrentDictionary<
        string, Lazy<Task<ConnectionMultiplexer>>
    > Pool = new();

    public static void MapRedisAclProV79(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v7/redis/acl-pro/{node}",
            GetReport
        ).RequireAuthorization();
    }

    private static async Task<ConnectionMultiplexer>
        Connect(string node)
    {
        int port = node == "cache" ? 6379 : 6380;

        string env = node == "cache"
            ? "REDIS_CACHE_PASSWORD"
            : "REDIS_STREAMS_PASSWORD";

        string? password =
            Environment.GetEnvironmentVariable(env);

        if (string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException(
                "Monitoring credentials missing.");

        var lazy = Pool.GetOrAdd(
            node,
            _ => new Lazy<Task<ConnectionMultiplexer>>(
                async () =>
                {
                    var options = new ConfigurationOptions
                    {
                        Password = password,
                        AbortOnConnectFail = false,
                        AllowAdmin = true,
                        ConnectTimeout = 3000,
                        AsyncTimeout = 3000
                    };

                    options.EndPoints.Add(
                        "127.0.0.1", port);

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

    private static async Task<IResult> GetReport(
        string node,
        ClaimsPrincipal user)
    {
        if (!Auth.Has(
            user, "admin", "redis-operator"))
            return Results.Forbid();

        if (node != "cache" && node != "streams")
            return Results.NotFound();

        try
        {
            var redis = await Connect(node);
            var db = redis.GetDatabase();

            // Kullanici isimleri ve aktif hesap okunur.
            // ACL LIST / GETUSER kullanilmiyor.
            // Parola hash'leri sorgulanmiyor.
            var usersResult = await db.ExecuteAsync(
                "ACL", "USERS");

            RedisResult[] rawUsers =
                (RedisResult[]?)usersResult
                ?? Array.Empty<RedisResult>();

            var users = rawUsers
                .Select(x => x.ToString() ?? "")
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Take(100)
                .OrderBy(x => x)
                .ToArray();

            var whoami = await db.ExecuteAsync(
                "ACL", "WHOAMI");

            string account = whoami.ToString() ?? "unknown";

            var checks = new List<object>();

            foreach (var probe in Probes)
            {
                // ACL DRYRUN, hedef komutu calistirmaz.
                // Yalnizca yetki kontrolu yapar.
                string status = "unknown";

                try
                {
                    object[] arguments =
                        new object[probe.Args.Length + 2];

                    arguments[0] = "DRYRUN";
                    arguments[1] = account;

                    for (int i = 0; i < probe.Args.Length; i++)
                        arguments[i + 2] = probe.Args[i];

                    var response = await db.ExecuteAsync(
                        "ACL", arguments);

                    string answer = response.ToString() ?? "";

                    status = answer.Equals(
                        "OK",
                        StringComparison.OrdinalIgnoreCase)
                        ? "allowed"
                        : "denied";
                }
                catch (RedisServerException ex)
                {
                    status = ex.Message.Contains(
                        "NOPERM",
                        StringComparison.OrdinalIgnoreCase)
                        ? "denied"
                        : "unknown";
                }
                catch
                {
                    status = "unknown";
                }

                checks.Add(new
                {
                    id = probe.Id,
                    label = probe.Label,
                    category = probe.Category,
                    status
                });
            }

            return Results.Ok(new
            {
                node,
                connected = redis.IsConnected,
                authenticatedAs = account,
                users,
                checks,
                commandsExecuted = false,
                credentialsIncluded = false,
                checkedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[ACL PRO] " + node + ": " +
                ex.GetType().Name + ": " +
                ex.Message);

            return Results.Problem(
                "ACL Security Pro envanteri okunamadi.",
                statusCode: 503);
        }
    }
}
