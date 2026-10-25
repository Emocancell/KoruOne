using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using StackExchange.Redis;

public static class RedisStorageLiveV89Module
{
    private sealed record Node(
        string Id, int Port, string Password);

    private static readonly string Home = Path.Combine(
        Environment.GetFolderPath(
            Environment.SpecialFolder.UserProfile),
        ".local", "share", "koru-one", "redis-managed");

    private static List<Node> GetNodes()
    {
        var result = new List<Node>();
        var registry = Path.Combine(Home, "registry.json");
        var secrets = Path.Combine(Home, "secrets.json");

        if (!File.Exists(registry) || !File.Exists(secrets))
            return result;

        using var nodesDoc = JsonDocument.Parse(
            File.ReadAllText(registry));

        using var secretsDoc = JsonDocument.Parse(
            File.ReadAllText(secrets));

        foreach (var entry in nodesDoc.RootElement.EnumerateObject())
        {
            var id = entry.Name;

            if (!Regex.IsMatch(id, @"^redis[0-9]{2,3}$"))
                continue;

            if (!secretsDoc.RootElement.TryGetProperty(
                id, out var credentials))
                continue;

            if (!credentials.TryGetProperty(
                "koru_admin", out var admin))
                continue;

            var password = admin.GetString();

            if (string.IsNullOrWhiteSpace(password))
                continue;

            var number = int.Parse(id.Substring(5));
            var port = 3000 + number;

            if (entry.Value.ValueKind == JsonValueKind.Object &&
                entry.Value.TryGetProperty("port", out var portValue))
            {
                if (portValue.ValueKind == JsonValueKind.Number &&
                    portValue.TryGetInt32(out var configuredPort))
                    port = configuredPort;
                else if (portValue.ValueKind == JsonValueKind.String &&
                    int.TryParse(portValue.GetString(),out configuredPort))
                    port = configuredPort;
            }

            if (port < 3001 || port > 3999)
                continue;

            result.Add(new Node(id,port,password));
        }

        return result.OrderBy(x => x.Port).ToList();
    }

    private static string GroupOf(string key)
    {
        if (key.StartsWith("koru:hr:"))
            return "Human Resources";
        if (key.StartsWith("koru:marketing:"))
            return "Marketing";
        if (key.StartsWith("koru:network:"))
            return "Network";
        if (key.StartsWith("koru:it:"))
            return "IT Operations";
        if (key.StartsWith("koru:redis:"))
            return "Redis Operations";

        return "Other / Unassigned";
    }

    private static async Task<object> Measure(Node node)
    {
        try
        {
            var config = new ConfigurationOptions
            {
                User = "koru_admin",
                Password = node.Password,
                AllowAdmin = true,
                AbortOnConnectFail = false,
                ConnectRetry = 1,
                ConnectTimeout = 2500,
                SyncTimeout = 2500,
                AsyncTimeout = 2500
            };

            config.EndPoints.Add("127.0.0.1", node.Port);

            using var connection =
                await ConnectionMultiplexer.ConnectAsync(config);

            var server = connection.GetServer(
                connection.GetEndPoints().First());

            var info = (await server.InfoAsync())
                .SelectMany(x => x)
                .GroupBy(x => x.Key)
                .ToDictionary(
                    x => x.Key,
                    x => x.Last().Value?.ToString() ?? "0");

            long Number(string key)
                => info.TryGetValue(key,out var value) &&
                   long.TryParse(value,out var n) ? n : 0;

            var totalKeys =
                (long)await server.DatabaseSizeAsync(0);

            var counts = new Dictionary<string,int>();
            int scanned = 0;
            bool scanAvailable = true;

            // Yalnizca key ADLARI backend icinde okunur.
            // API'ye key adlari veya degerleri GONDERILMEZ.
            try
            {
                foreach (var key in server.Keys(
                    database: 0,pageSize: 100))
                {
                    if (scanned >= 500)
                        break;

                    var group = GroupOf(key.ToString());

                    counts[group] =
                        counts.GetValueOrDefault(group) + 1;

                    scanned++;
                }
            }
            catch
            {
                scanAvailable = false;
            }

            return new
            {
                id = node.Id,
                online = true,
                usedBytes = Number("used_memory"),
                overheadBytes = Number("used_memory_overhead"),
                datasetBytes = Number("used_memory_dataset"),
                maxMemoryBytes = Number("maxmemory"),
                totalKeys,
                scannedKeys = scanned,
                scanComplete = scanAvailable &&
                    scanned == totalKeys,
                groups = counts
                    .OrderByDescending(x => x.Value)
                    .Select(x => new {
                        name = x.Key,
                        count = x.Value
                    }).ToArray()
            };
        }
        catch(Exception ex)
        {
            Console.Error.WriteLine(
                "[V89 LIVE] " + node.Id + " " +
                ex.GetType().Name);

            return new
            {
                id = node.Id,
                online = false,
                usedBytes = 0L,
                overheadBytes = 0L,
                datasetBytes = 0L,
                maxMemoryBytes = 0L,
                totalKeys = 0L,
                scannedKeys = 0,
                scanComplete = false,
                groups = Array.Empty<object>()
            };
        }
    }

    public static void MapRedisStorageLiveV89(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/storage/live-v89",
            async (ClaimsPrincipal user) =>
            {
                if (!Auth.Has(user,"admin","redis-operator"))
                    return Results.Forbid();

                var nodes = GetNodes();

                var results = await Task.WhenAll(
                    nodes.Select(Measure));

                return Results.Ok(new
                {
                    checkedAt = DateTime.UtcNow,
                    nodes = results
                });
            }
        ).RequireAuthorization();
    }
}
