using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using StackExchange.Redis;

public static class RedisStorageRealityModule
{
    public static IEndpointRouteBuilder MapRedisStorageReality(
        this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v8/redis/storage/reality")
            .RequireAuthorization();

        group.MapGet("/", Get);
        group.MapGet("/live", Get);

        return app;
    }

    private static async Task<IResult> Get(ClaimsPrincipal user)
    {
        if (!Auth.Has(user,
            "admin", "redis-operator", "redis-viewer",
            "network", "it"))
            return Results.Forbid();

        var cacheConn =
            Environment.GetEnvironmentVariable("REDIS_URL")
            ?? "127.0.0.1:6379,abortConnect=false";

        var streamsConn =
            Environment.GetEnvironmentVariable("REDIS_STREAMS_URL")
            ?? "127.0.0.1:6380,abortConnect=false";

        var cache = await ReadNode("Redis Cache", cacheConn);
        var streams = await ReadNode("Redis Streams", streamsConn);

        return Results.Ok(new
        {
            checkedAt = DateTime.UtcNow,
            cache,
            streams
        });
    }

    private static async Task<object> ReadNode(
        string label,
        string connectionString)
    {
        var options = ConfigurationOptions.Parse(connectionString, true);
        options.AbortOnConnectFail = false;
        options.ConnectRetry = 1;
        options.ConnectTimeout = 3000;
        options.SyncTimeout = 3000;
        options.AllowAdmin = true;

        await using var muxHolder = new AsyncMuxHolder(
            await ConnectionMultiplexer.ConnectAsync(options));

        var mux = muxHolder.Value;
        var endpoint = mux.GetEndPoints().First();
        var server = mux.GetServer(endpoint);
        var db = mux.GetDatabase();

        var info = await server.InfoAsync();
        var flat = info
            .SelectMany(x => x)
            .GroupBy(x => x.Key)
            .ToDictionary(
                g => g.Key,
                g => g.Last().Value?.ToString() ?? "0",
                StringComparer.OrdinalIgnoreCase);

        long Num(string key)
        {
            return flat.TryGetValue(key, out var s) &&
                   long.TryParse(
                       s,
                       NumberStyles.Any,
                       CultureInfo.InvariantCulture,
                       out var n)
                ? n
                : 0;
        }

        double NumD(string key)
        {
            return flat.TryGetValue(key, out var s) &&
                   double.TryParse(
                       s,
                       NumberStyles.Any,
                       CultureInfo.InvariantCulture,
                       out var n)
                ? n
                : 0;
        }

        var totalKeys = (long)await server.DatabaseSizeAsync(0);
        var scanned = 0;
        var maxScan = 500;

        var groupMap = new Dictionary<string, GroupSummary>(
            StringComparer.OrdinalIgnoreCase);

        void Ensure(string name)
        {
            if (!groupMap.ContainsKey(name))
                groupMap[name] = new GroupSummary(name);
        }

        Ensure("Human Resources");
        Ensure("IT Operations");
        Ensure("Network");
        Ensure("Marketing");
        Ensure("Advertising");
        Ensure("Redis Operations");
        Ensure("Unassigned");

        string ResolveGroup(string key)
        {
            var k = key.ToLowerInvariant();

            if (k.StartsWith("koru:hr:")) return "Human Resources";
            if (k.StartsWith("koru:it:")) return "IT Operations";
            if (k.StartsWith("koru:network:")) return "Network";
            if (k.StartsWith("koru:marketing:")) return "Marketing";
            if (k.StartsWith("koru:advertising:")) return "Advertising";
            if (k.StartsWith("koru:redis:")) return "Redis Operations";

            return "Unassigned";
        }

        foreach (var key in server.Keys(0, pageSize: 100))
        {
            scanned++;
            if (scanned > maxScan) break;

            var keyText = key.ToString();
            var group = ResolveGroup(keyText);

            if (!groupMap.TryGetValue(group, out var row))
            {
                row = new GroupSummary(group);
                groupMap[group] = row;
            }

            row.KeyCount++;

            try
            {
                var usage = await db.ExecuteAsync("MEMORY", "USAGE", keyText);
                if (!usage.IsNull &&
                    long.TryParse(
                        usage.ToString(),
                        NumberStyles.Any,
                        CultureInfo.InvariantCulture,
                        out var bytes))
                {
                    row.Bytes += bytes;
                }
            }
            catch
            {
            }
        }

        return new
        {
            label,
            usedMemoryBytes = Num("used_memory"),
            overheadBytes = Num("used_memory_overhead"),
            datasetBytes = Num("used_memory_dataset"),
            totalKeys,
            scannedKeys = scanned > maxScan ? maxScan : scanned,
            maxMemoryBytes = Num("maxmemory"),
            hitCount = Num("keyspace_hits"),
            missCount = Num("keyspace_misses"),
            fragmentationRatio = NumD("mem_fragmentation_ratio"),
            groups = groupMap.Values
                .OrderByDescending(x => x.Bytes)
                .ThenByDescending(x => x.KeyCount)
                .ToList()
        };
    }

    private sealed class GroupSummary
    {
        public GroupSummary(string name)
        {
            Name = name;
        }

        public string Name { get; }
        public int KeyCount { get; set; }
        public long Bytes { get; set; }
    }

    private sealed class AsyncMuxHolder : IAsyncDisposable
    {
        public AsyncMuxHolder(IConnectionMultiplexer value)
        {
            Value = value;
        }

        public IConnectionMultiplexer Value { get; }

        public async ValueTask DisposeAsync()
        {
            await Value.CloseAsync();
            Value.Dispose();
        }
    }
}
