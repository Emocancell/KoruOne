using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using StackExchange.Redis;

public static class RedisFleetReadOnly
{
    private sealed record NodeConfig(
        string Id,
        string Name,
        string Host,
        int Port,
        string Kind
    );

    private static readonly NodeConfig[] Inventory =
    {
        new(
            "redis-cache",
            "Redis Cache",
            "127.0.0.1",
            6379,
            "cache"
        ),
        new(
            "redis-streams",
            "Redis Streams",
            "127.0.0.1",
            6380,
            "streams"
        )
    };

    private static readonly ConcurrentDictionary<
        string,
        Lazy<Task<ConnectionMultiplexer>>
    > Connections = new();

    public static void MapRedisFleetReadOnly(
        this WebApplication app)
    {
        var api = app
            .MapGroup("/api/v7/redis")
            .RequireAuthorization();

        api.MapGet("/nodes",
            async (ClaimsPrincipal user) =>
        {
            if (!CanView(user))
                return Results.Forbid();

            var visible = await
                RedisNodeRegistryV82.VisibleNodesAsync(user);

            return Results.Ok(new
            {
                nodes = Inventory
                    .Where(n => visible.Contains(n.Id))
                    .Select(n => new
                {
                    id = n.Id,
                    name = n.Name,
                    host = n.Host,
                    port = n.Port,
                    role = n.Kind
                })
            });
        });

        api.MapGet(
            "/nodes/{id}/metrics",
            async (string id, ClaimsPrincipal user) =>
        {
            if (!CanView(user))
                return Results.Forbid();

            var node = Inventory.FirstOrDefault(
                n => n.Id.Equals(
                    id,
                    StringComparison.OrdinalIgnoreCase));

            if (node is null)
                return Results.NotFound(new
                {
                    message = "Node envanterde bulunamadi."
                });

            var password = Environment.GetEnvironmentVariable(
                node.Kind == "cache"
                    ? "REDIS_CACHE_PASSWORD"
                    : "REDIS_STREAMS_PASSWORD");

            if (string.IsNullOrWhiteSpace(password))
            {
                return Results.Problem(
                    "Redis monitoring baglanti bilgisi eksik.",
                    statusCode: 503);
            }

            try
            {
                var redis = await GetConnection(node, password);

                var database = redis.GetDatabase();
                var server = redis.GetServer(
                    node.Host,
                    node.Port);

                var latency = await database.PingAsync();

                var sections = await server.InfoAsync();

                var values = sections
                    .SelectMany(section => section)
                    .GroupBy(pair => pair.Key)
                    .ToDictionary(
                        group => group.Key,
                        group => group.Last().Value);

                long Number(string name)
                {
                    if (values.TryGetValue(name, out var raw)
                        && long.TryParse(
                            raw,
                            NumberStyles.Integer,
                            CultureInfo.InvariantCulture,
                            out var number))
                        return number;

                    return 0;
                }

                double DecimalNumber(string name)
                {
                    if (values.TryGetValue(name, out var raw)
                        && double.TryParse(
                            raw,
                            NumberStyles.Float,
                            CultureInfo.InvariantCulture,
                            out var number))
                        return number;

                    return 0;
                }

                string Text(string name)
                {
                    return values.TryGetValue(name, out var raw)
                        ? raw
                        : "unknown";
                }

                var hits = Number("keyspace_hits");
                var misses = Number("keyspace_misses");
                var total = hits + misses;

                var keyCount = await server.DatabaseSizeAsync(0);

                return Results.Ok(new
                {
                    connected = redis.IsConnected,
                    nodeId = node.Id,
                    version = Text("redis_version"),
                    role = Text("role"),

                    memoryBytes = Number("used_memory"),
                    memoryRssBytes = Number("used_memory_rss"),
                    maxMemoryBytes = Number("maxmemory"),

                    operationsPerSecond =
                        Number("instantaneous_ops_per_sec"),

                    clients = Number("connected_clients"),

                    totalKeys = keyCount,

                    hits,
                    misses,

                    hitRatio = total > 0
                        ? Math.Round(
                            100.0 * hits / total, 2)
                        : 0,

                    evictions = Number("evicted_keys"),
                    expired = Number("expired_keys"),

                    uptimeSeconds =
                        Number("uptime_in_seconds"),

                    fragmentation =
                        DecimalNumber("mem_fragmentation_ratio"),

                    cpu = DecimalNumber("used_cpu_sys"),

                    latencyMs = Math.Round(
                        latency.TotalMilliseconds, 2),

                    checkedAt = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[REDIS FLEET] {node.Id}: " +
                    $"{ex.GetType().Name}: {ex.Message}");

                return Results.Problem(
                    "Redis node metrikleri okunamadi.",
                    statusCode: 503);
            }
        });
    }

    private static bool CanView(ClaimsPrincipal user)
    {
        return Auth.Has(
            user,
            "admin",
            "redis-viewer",
            "redis-operator",
            "network");
    }

    private static async Task<ConnectionMultiplexer> GetConnection(
        NodeConfig node,
        string password)
    {
        var lazy = Connections.GetOrAdd(
            node.Id,
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

                    options.EndPoints.Add(
                        node.Host, node.Port);

                    return await ConnectionMultiplexer
                        .ConnectAsync(options);
                }));

        try
        {
            return await lazy.Value;
        }
        catch
        {
            Connections.TryRemove(node.Id, out _);
            throw;
        }
    }
}
