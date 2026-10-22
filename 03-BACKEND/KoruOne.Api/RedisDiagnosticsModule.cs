// KORU_V77_DIAGNOSTICS
using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using StackExchange.Redis;

public static class RedisDiagnosticsModule
{
    private sealed record Node(
        string Id,
        string Name,
        int Port,
        string PasswordVariable
    );

    private static readonly Node[] Nodes =
    {
        new(
            "redis-cache",
            "Redis Cache",
            6379,
            "REDIS_CACHE_PASSWORD"
        ),
        new(
            "redis-streams",
            "Redis Streams",
            6380,
            "REDIS_STREAMS_PASSWORD"
        )
    };

    private static readonly ConcurrentDictionary<
        string,
        Lazy<Task<ConnectionMultiplexer>>
    > Connections = new();

    public static void MapRedisDiagnostics(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v7/redis/diagnostics",
            async (ClaimsPrincipal user) =>
            {
                if (!Auth.Has(
                    user,
                    "admin",
                    "redis-viewer",
                    "redis-operator",
                    "network"))
                    return Results.Forbid();

                var visible = await
                    RedisNodeRegistryV82.VisibleNodesAsync(user);

                var reports = await Task.WhenAll(
                    Nodes
                        .Where(n => visible.Contains(n.Id))
                        .Select(ReadNodeAsync)
                );

                return Results.Ok(new
                {
                    checkedAt = DateTime.UtcNow,
                    nodes = reports
                });
            }
        ).RequireAuthorization();
    }

    private static async Task<ConnectionMultiplexer>
        GetConnectionAsync(Node node, string password)
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
                        "127.0.0.1",
                        node.Port
                    );

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
            Connections.TryRemove(node.Id, out _);
            throw;
        }
    }

    private static async Task<object> ReadNodeAsync(
        Node node)
    {
        var password = Environment.GetEnvironmentVariable(
            node.PasswordVariable
        );

        if (string.IsNullOrWhiteSpace(password))
        {
            return new
            {
                id = node.Id,
                name = node.Name,
                connected = false,
                error = "Monitoring bilgisi tanimli degil."
            };
        }

        try
        {
            var redis = await GetConnectionAsync(
                node,
                password
            );

            var server = redis.GetServer(
                "127.0.0.1",
                node.Port
            );

            var ping = await redis
                .GetDatabase()
                .PingAsync();

            var sections = await server.InfoAsync("all");

            var info = sections
                .SelectMany(section => section)
                .GroupBy(pair => pair.Key)
                .ToDictionary(
                    group => group.Key,
                    group => group.Last().Value
                );

            string? Text(string name)
            {
                return info.TryGetValue(name, out var value)
                    ? value
                    : null;
            }

            long? Number(string name)
            {
                if (info.TryGetValue(name, out var raw)
                    && long.TryParse(
                        raw,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out var result))
                    return result;

                return null;
            }

            double? DecimalNumber(string name)
            {
                if (info.TryGetValue(name, out var raw)
                    && double.TryParse(
                        raw,
                        NumberStyles.Float,
                        CultureInfo.InvariantCulture,
                        out var result))
                    return result;

                return null;
            }

            bool? Flag(string name)
            {
                var value = Number(name);
                return value.HasValue
                    ? value.Value == 1
                    : null;
            }

            return new
            {
                id = node.Id,
                name = node.Name,
                connected = redis.IsConnected,
                error = (string?)null,

                version = Text("redis_version"),
                redisMode = Text("redis_mode"),
                role = Text("role"),

                clusterEnabled = Flag("cluster_enabled"),
                connectedReplicas = Number("connected_slaves"),
                masterLinkStatus = Text("master_link_status"),

                aofEnabled = Flag("aof_enabled"),
                rdbLastBgsaveStatus =
                    Text("rdb_last_bgsave_status"),
                rdbChangesSinceLastSave =
                    Number("rdb_changes_since_last_save"),
                aofLastRewriteStatus =
                    Text("aof_last_bgrewrite_status"),

                memoryBytes = Number("used_memory"),
                memoryRssBytes = Number("used_memory_rss"),
                memoryPeakBytes = Number("used_memory_peak"),
                maxMemoryBytes = Number("maxmemory"),
                maxMemoryPolicy = Text("maxmemory_policy"),
                fragmentation =
                    DecimalNumber("mem_fragmentation_ratio"),

                clients = Number("connected_clients"),
                blockedClients = Number("blocked_clients"),
                rejectedConnections =
                    Number("rejected_connections"),
                totalErrorReplies =
                    Number("total_error_replies"),

                evictions = Number("evicted_keys"),
                expiredKeys = Number("expired_keys"),
                hits = Number("keyspace_hits"),
                misses = Number("keyspace_misses"),

                operationsPerSecond =
                    Number("instantaneous_ops_per_sec"),

                uptimeSeconds =
                    Number("uptime_in_seconds"),

                latencyMs = Math.Round(
                    ping.TotalMilliseconds, 2),

                checkedAt = DateTime.UtcNow
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[REDIS DIAGNOSTICS] " +
                node.Id + " " +
                ex.GetType().Name + ": " +
                ex.Message
            );

            return new
            {
                id = node.Id,
                name = node.Name,
                connected = false,
                error = "Node tanilama islemi basarisiz."
            };
        }
    }
}
