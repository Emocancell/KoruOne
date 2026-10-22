using System.Globalization;
using System.Security.Claims;
using Npgsql;
using StackExchange.Redis;

public sealed record V85Plan(
    string Department, string NodeId,
    int BudgetMb, string Prefix, bool Active);

public sealed record V85Node(
    string Id, bool Connected, long UsedMemory,
    long MaxMemory, long Clients, long BlockedClients,
    long OpsPerSecond, double PingMs, string? Error);

public sealed record V85Slow(
    string NodeId, long Id, DateTime Time,
    string Command, long DurationUs);

public sealed record V85Candidate(
    string Key, string NodeId, string Severity,
    string Title, string Detail);

public static class RedisOpsV85
{
    static readonly string[] Nodes =
        ["redis-cache", "redis-streams"];

    static readonly string[] Departments =
        ["network", "it", "hr", "marketing",
         "advertising", "redis"];

    static readonly SemaphoreSlim SchemaLock = new(1, 1);
    static bool Ready;

    static string Db() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    static bool Admin(ClaimsPrincipal u) =>
        Auth.Has(u, "admin");

    static string Actor(ClaimsPrincipal u) =>
        u.FindFirst("preferred_username")?.Value
        ?? u.Identity?.Name
        ?? Auth.UserId(u);

    public static async Task EnsureSchemaAsync()
    {
        if (Ready) return;

        await SchemaLock.WaitAsync();
        try
        {
            if (Ready) return;

            await using var c = new NpgsqlConnection(Db());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                CREATE TABLE IF NOT EXISTS koru_redis_storage_v84
                (
                    department text NOT NULL,
                    node_id text NOT NULL,
                    budget_mb integer NOT NULL,
                    prefix text NOT NULL,
                    updated_by text NOT NULL DEFAULT 'system',
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY(department,node_id)
                );

                ALTER TABLE koru_redis_storage_v84
                    ADD COLUMN IF NOT EXISTS active boolean
                    NOT NULL DEFAULT true;

                CREATE TABLE IF NOT EXISTS
                    koru_redis_storage_plan_audit_v85
                (
                    id bigint GENERATED ALWAYS AS IDENTITY
                        PRIMARY KEY,
                    actor text NOT NULL,
                    department text NOT NULL,
                    node_id text NOT NULL,
                    action text NOT NULL,
                    changed_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS
                    koru_redis_ops_alerts_v85
                (
                    alert_key text PRIMARY KEY,
                    node_id text NOT NULL,
                    severity text NOT NULL,
                    title text NOT NULL,
                    detail text NOT NULL,
                    active boolean NOT NULL DEFAULT true,
                    acknowledged_by text NULL,
                    acknowledged_at timestamptz NULL,
                    last_seen timestamptz NOT NULL DEFAULT now()
                );
                """, c);

            await cmd.ExecuteNonQueryAsync();
            Ready = true;
        }
        finally
        {
            SchemaLock.Release();
        }
    }

    public static void MapRedisOpsV85(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/storage/plans",
            GetPlans).RequireAuthorization();

        app.MapDelete(
            "/api/v8/redis/storage/plans/{department}/{node}",
            async (string department, string node,
                   ClaimsPrincipal user) =>
                await SetPlan(department, node, false, user)
        ).RequireAuthorization();

        app.MapPost(
            "/api/v8/redis/storage/plans/{department}/{node}/restore",
            async (string department, string node,
                   ClaimsPrincipal user) =>
                await SetPlan(department, node, true, user)
        ).RequireAuthorization();

        app.MapGet(
            "/api/v8/redis/operations",
            GetOperations).RequireAuthorization();

        app.MapPost(
            "/api/v8/redis/operations/alerts/{key}/ack",
            Acknowledge).RequireAuthorization();
    }

    static async Task<IResult> GetPlans(ClaimsPrincipal user)
    {
        if (!Admin(user)) return Results.Forbid();

        try
        {
            await EnsureSchemaAsync();

            var rows = new List<V85Plan>();

            await using var c = new NpgsqlConnection(Db());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                SELECT department,node_id,budget_mb,
                       prefix,active
                FROM koru_redis_storage_v84
                ORDER BY department,node_id
                """, c);

            await using var r = await cmd.ExecuteReaderAsync();

            while (await r.ReadAsync())
                rows.Add(new V85Plan(
                    r.GetString(0), r.GetString(1),
                    r.GetInt32(2), r.GetString(3),
                    r.GetBoolean(4)));

            return Results.Ok(rows);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V85 PLANS] " + ex.GetType().Name);

            return Results.Problem(
                "Storage plans unavailable.",
                statusCode: 503);
        }
    }

    static async Task<IResult> SetPlan(
        string department, string node,
        bool activate, ClaimsPrincipal user)
    {
        if (!Admin(user)) return Results.Forbid();

        department = department.ToLowerInvariant();
        node = node.ToLowerInvariant();

        if (!Departments.Contains(department) ||
            !Nodes.Contains(node))
            return Results.BadRequest();

        try
        {
            await EnsureSchemaAsync();

            await using var c = new NpgsqlConnection(Db());
            await c.OpenAsync();

            await using var tx =
                await c.BeginTransactionAsync();

            // Ayni node'un paralel plan islemlerini kilitle.
            await using (var guard = new NpgsqlCommand(
                """
                SELECT pg_advisory_xact_lock(
                    hashtext('koru-v84-' || @node)
                )
                """, c, tx))
            {
                guard.Parameters.AddWithValue("node", node);
                await guard.ExecuteNonQueryAsync();
            }

            string prefix;
            bool previous;

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT prefix,active
                FROM koru_redis_storage_v84
                WHERE department=@d AND node_id=@n
                FOR UPDATE
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("d", department);
                cmd.Parameters.AddWithValue("n", node);

                await using var r = await cmd.ExecuteReaderAsync();

                if (!await r.ReadAsync())
                    return Results.NotFound();

                prefix = r.GetString(0);
                previous = r.GetBoolean(1);
            }

            if (activate && !previous)
            {
                await using var cmd = new NpgsqlCommand(
                    """
                    SELECT prefix
                    FROM koru_redis_storage_v84
                    WHERE node_id=@n
                      AND department<>@d
                      AND active=true
                    """, c, tx);

                cmd.Parameters.AddWithValue("n", node);
                cmd.Parameters.AddWithValue("d", department);

                await using var r = await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    string other = r.GetString(0);

                    if (prefix.StartsWith(other,
                            StringComparison.Ordinal) ||
                        other.StartsWith(prefix,
                            StringComparison.Ordinal))
                        return Results.Conflict(new
                        {
                            message = "Namespace overlap: " + other
                        });
                }
            }

            if (previous == activate)
            {
                await tx.CommitAsync();
                return Results.Ok(new
                {
                    changed = false,
                    active = activate
                });
            }

            await using (var cmd = new NpgsqlCommand(
                """
                UPDATE koru_redis_storage_v84
                SET active=@active,updated_by=@actor,
                    updated_at=now()
                WHERE department=@d AND node_id=@n
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("active", activate);
                cmd.Parameters.AddWithValue("actor", Actor(user));
                cmd.Parameters.AddWithValue("d", department);
                cmd.Parameters.AddWithValue("n", node);
                await cmd.ExecuteNonQueryAsync();
            }

            await using (var cmd = new NpgsqlCommand(
                """
                INSERT INTO koru_redis_storage_plan_audit_v85
                (actor,department,node_id,action)
                VALUES (@actor,@d,@n,@action)
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("actor", Actor(user));
                cmd.Parameters.AddWithValue("d", department);
                cmd.Parameters.AddWithValue("n", node);
                cmd.Parameters.AddWithValue(
                    "action", activate ? "restore" : "disable");

                await cmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return Results.Ok(new
            {
                changed = true,
                department,
                nodeId = node,
                active = activate,
                redisDataDeleted = false
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V85 PLAN CHANGE] " + ex.GetType().Name);

            return Results.Problem(
                "Storage plan change failed.",
                statusCode: 503);
        }
    }

    static async Task<(V85Node, List<V85Slow>)>
        ReadNode(string id)
    {
        var slow = new List<V85Slow>();

        try
        {
            int port = id == "redis-cache" ? 6379 : 6380;

            string passwordVariable = id == "redis-cache"
                ? "REDIS_CACHE_PASSWORD"
                : "REDIS_STREAMS_PASSWORD";

            string? password =
                Environment.GetEnvironmentVariable(passwordVariable);

            if (string.IsNullOrWhiteSpace(password))
                throw new InvalidOperationException(
                    "Redis credentials unavailable.");

            var options = new ConfigurationOptions
            {
                Password = password,
                AllowAdmin = true,
                AbortOnConnectFail = false,
                ConnectTimeout = 3000,
                AsyncTimeout = 3000
            };

            options.EndPoints.Add("127.0.0.1", port);

            using var redis =
                await ConnectionMultiplexer.ConnectAsync(options);

            var db = redis.GetDatabase();
            var server = redis.GetServer("127.0.0.1", port);

            var ping = await db.PingAsync();
            var sections = await server.InfoAsync();

            var info = sections
                .SelectMany(section => section)
                .GroupBy(pair => pair.Key)
                .ToDictionary(
                    group => group.Key,
                    group => group.Last().Value);

            long Number(string name) =>
                info.TryGetValue(name, out var raw)
                && long.TryParse(
                    raw, NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out long result)
                    ? result : 0;

            try
            {
                var response = await db.ExecuteAsync(
                    "SLOWLOG", "GET", 15);

                RedisResult[] entries = (RedisResult[])response;

                foreach (var entry in entries)
                {
                    RedisResult[] values = (RedisResult[])entry;
                    if (values.Length < 4) continue;

                    RedisResult[] args =
                        (RedisResult[])values[3];

                    string command = args.Length > 0
                        ? (args[0].ToString() ?? "UNKNOWN")
                        : "UNKNOWN";

                    if (!long.TryParse(
                        values[0].ToString(),
                        out long logId)) continue;

                    if (!long.TryParse(
                        values[1].ToString(),
                        out long unix)) continue;

                    if (!long.TryParse(
                        values[2].ToString(),
                        out long duration)) continue;

                    slow.Add(new V85Slow(
                        id, logId,
                        DateTimeOffset
                            .FromUnixTimeSeconds(unix)
                            .UtcDateTime,
                        command, duration));
                }
            }
            catch (RedisServerException)
            {
                // SLOWLOG izni olmayan node'da
                // metrikler yine gosterilir.
            }

            return (
                new V85Node(
                    id, redis.IsConnected,
                    Number("used_memory"),
                    Number("maxmemory"),
                    Number("connected_clients"),
                    Number("blocked_clients"),
                    Number("instantaneous_ops_per_sec"),
                    Math.Round(
                        ping.TotalMilliseconds, 2),
                    null),
                slow
            );
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V85 NODE] " + id + " " +
                ex.GetType().Name);

            return (
                new V85Node(
                    id, false, 0, 0, 0, 0, 0, 0,
                    "Redis node unavailable"),
                slow
            );
        }
    }

    static List<V85Candidate> Detect(
        V85Node node, List<V85Slow> logs)
    {
        var alerts = new List<V85Candidate>();

        void Add(string rule, string level,
                 string title, string detail)
        {
            alerts.Add(new V85Candidate(
                node.Id + ":" + rule,
                node.Id, level, title, detail));
        }

        if (!node.Connected)
        {
            Add("offline", "critical",
                "Redis node unavailable",
                "Connection or monitoring failed.");
            return alerts;
        }

        if (node.MaxMemory > 0)
        {
            double percent =
                100.0 * node.UsedMemory / node.MaxMemory;

            if (percent >= 80)
                Add("memory", percent >= 95
                    ? "critical" : "warning",
                    "Memory threshold",
                    $"{percent:F1}% of configured maxmemory");
        }

        if (node.BlockedClients > 5)
            Add("blocked", "warning",
                "Blocked client threshold",
                $"{node.BlockedClients} blocked clients");

        if (node.OpsPerSecond >= 5000)
            Add("operations", "warning",
                "High command throughput",
                $"{node.OpsPerSecond} operations/sec");

        long slowCount = logs.Count(log =>
            log.DurationUs >= 100000 &&
            log.Time >= DateTime.UtcNow.AddMinutes(-5));

        if (slowCount > 0)
            Add("slow", "warning",
                "Slow commands detected",
                $"{slowCount} commands >= 100 ms in recent slowlog");

        return alerts;
    }

    static async Task SaveAlerts(
        List<V85Candidate> active,
        HashSet<string> nodes)
    {
        await using var c = new NpgsqlConnection(Db());
        await c.OpenAsync();

        await using var tx =
            await c.BeginTransactionAsync();

        foreach (string node in nodes)
        {
            string[] keys = active
                .Where(x => x.NodeId == node)
                .Select(x => x.Key)
                .ToArray();

            await using (var cmd = new NpgsqlCommand(
                """
                UPDATE koru_redis_ops_alerts_v85
                SET active=false
                WHERE node_id=@node
                  AND active=true
                  AND NOT (alert_key=ANY(@keys))
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("node", node);
                cmd.Parameters.AddWithValue("keys", keys);
                await cmd.ExecuteNonQueryAsync();
            }
        }

        foreach (var item in active)
        {
            await using var cmd = new NpgsqlCommand(
                """
                INSERT INTO koru_redis_ops_alerts_v85 AS a
                (alert_key,node_id,severity,title,detail)
                VALUES (@key,@node,@severity,@title,@detail)
                ON CONFLICT(alert_key) DO UPDATE SET
                    severity=excluded.severity,
                    title=excluded.title,
                    detail=excluded.detail,
                    active=true,
                    last_seen=now(),
                    acknowledged_by=
                        CASE WHEN a.active
                          THEN a.acknowledged_by ELSE NULL END,
                    acknowledged_at=
                        CASE WHEN a.active
                          THEN a.acknowledged_at ELSE NULL END
                """, c, tx);

            cmd.Parameters.AddWithValue("key", item.Key);
            cmd.Parameters.AddWithValue("node", item.NodeId);
            cmd.Parameters.AddWithValue(
                "severity", item.Severity);
            cmd.Parameters.AddWithValue("title", item.Title);
            cmd.Parameters.AddWithValue("detail", item.Detail);

            await cmd.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
    }

    static async Task<IResult> GetOperations(
        ClaimsPrincipal user)
    {
        try
        {
            if (!await RedisStorageV84.CanRead(user))
                return Results.Forbid();

            await EnsureSchemaAsync();

            var visible =
                await RedisNodeRegistryV82.VisibleNodesAsync(user);

            var statuses = new List<V85Node>();
            var slowlogs = new List<V85Slow>();
            var candidates = new List<V85Candidate>();

            foreach (string id in Nodes)
            {
                if (!visible.Contains(id)) continue;

                var (status, logs) = await ReadNode(id);

                statuses.Add(status);
                slowlogs.AddRange(logs);
                candidates.AddRange(Detect(status, logs));
            }

            await SaveAlerts(candidates, visible);

            var alerts = new List<object>();

            await using var c = new NpgsqlConnection(Db());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                SELECT alert_key,node_id,severity,title,
                       detail,acknowledged_by,last_seen
                FROM koru_redis_ops_alerts_v85
                WHERE active=true
                  AND node_id=ANY(@nodes)
                ORDER BY
                    CASE WHEN severity='critical'
                        THEN 0 ELSE 1 END,
                    last_seen DESC
                LIMIT 100
                """, c);

            cmd.Parameters.AddWithValue(
                "nodes", visible.ToArray());

            await using var r = await cmd.ExecuteReaderAsync();

            while (await r.ReadAsync())
                alerts.Add(new
                {
                    key = r.GetString(0),
                    nodeId = r.GetString(1),
                    severity = r.GetString(2),
                    title = r.GetString(3),
                    detail = r.GetString(4),
                    acknowledgedBy = r.IsDBNull(5)
                        ? null : r.GetString(5),
                    lastSeen = r.GetDateTime(6)
                });

            return Results.Ok(new
            {
                nodes = statuses,
                alerts,
                slowlogs = slowlogs
                    .OrderByDescending(x => x.Time)
                    .Take(30)
                    .ToArray(),
                canAcknowledge = Auth.Has(
                    user, "admin", "network", "redis-operator"),
                checkedAt = DateTime.UtcNow,
                collectionMode = "on-demand",
                rawSlowlogArgumentsIncluded = false
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V85 OPERATIONS] " +
                ex.GetType().Name + ": " + ex.Message);

            return Results.Problem(
                "Operations data unavailable.",
                statusCode: 503);
        }
    }

    static async Task<IResult> Acknowledge(
        string key, ClaimsPrincipal user)
    {
        if (!Auth.Has(
            user, "admin", "network", "redis-operator"))
            return Results.Forbid();

        try
        {
            if (!await RedisStorageV84.CanRead(user))
                return Results.Forbid();

            var visible =
                await RedisNodeRegistryV82.VisibleNodesAsync(user);

            await EnsureSchemaAsync();

            await using var c = new NpgsqlConnection(Db());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                UPDATE koru_redis_ops_alerts_v85
                SET acknowledged_by=@actor,
                    acknowledged_at=now()
                WHERE alert_key=@key AND active=true
                  AND node_id=ANY(@nodes)
                RETURNING alert_key
                """, c);

            cmd.Parameters.AddWithValue("actor", Actor(user));
            cmd.Parameters.AddWithValue("key", key);
            cmd.Parameters.AddWithValue(
                "nodes", visible.ToArray());

            var result = await cmd.ExecuteScalarAsync();

            return result is null
                ? Results.NotFound()
                : Results.Ok(new
                {
                    acknowledged = true,
                    key
                });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V85 ACK] " + ex.GetType().Name);

            return Results.Problem(
                "Acknowledgement failed.",
                statusCode: 503);
        }
    }
}
