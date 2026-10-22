using System.Globalization;
using System.Security.Claims;
using Npgsql;
using StackExchange.Redis;

public sealed record V86Sample(
    string NodeId,
    DateTime SampleAt,
    bool Connected,
    long MemoryBytes,
    long MaxMemoryBytes,
    long Clients,
    long OpsPerSecond,
    double LatencyMs,
    double HitRatio,
    long BlockedClients
);

public sealed record V86AlertRule(
    string NodeId,
    string RuleId,
    string Severity,
    string Title,
    string Detail
);

public sealed class RedisMonitoringWorkerV86(
    ILogger<RedisMonitoringWorkerV86> logger
) : BackgroundService
{
    protected override async Task ExecuteAsync(
        CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "KORU V8.6 Monitoring Worker started.");

        using var timer =
            new PeriodicTimer(TimeSpan.FromSeconds(60));

        try
        {
            do
            {
                try
                {
                    await RedisMonitoringV86.CollectAsync(
                        stoppingToken);
                }
                catch (OperationCanceledException)
                    when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    logger.LogWarning(
                        "Redis monitoring cycle failed: {Type}",
                        ex.GetType().Name);
                }
            }
            while (await timer.WaitForNextTickAsync(
                stoppingToken));
        }
        catch (OperationCanceledException)
            when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }

        logger.LogInformation(
            "KORU V8.6 Monitoring Worker stopped.");
    }
}

public static class RedisMonitoringV86
{
    private static readonly string[] Nodes =
        ["redis-cache", "redis-streams"];

    private static readonly string[] Rules =
        ["offline", "memory", "latency", "blocked"];

    private static readonly SemaphoreSlim SchemaLock = new(1, 1);
    private static bool SchemaReady;

    private static string ConnectionString() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    private static string Actor(ClaimsPrincipal user) =>
        user.FindFirst("preferred_username")?.Value
        ?? user.Identity?.Name
        ?? Auth.UserId(user);

    private static async Task EnsureSchemaAsync()
    {
        if (SchemaReady) return;

        await SchemaLock.WaitAsync();

        try
        {
            if (SchemaReady) return;

            await using var c =
                new NpgsqlConnection(ConnectionString());

            await c.OpenAsync();

            const string sql = """
                CREATE TABLE IF NOT EXISTS
                    koru_redis_metrics_v86
                (
                    node_id text NOT NULL,
                    sample_at timestamptz NOT NULL,
                    connected boolean NOT NULL,
                    memory_bytes bigint NOT NULL,
                    max_memory_bytes bigint NOT NULL,
                    clients bigint NOT NULL,
                    ops_per_second bigint NOT NULL,
                    latency_ms double precision NOT NULL,
                    hit_ratio double precision NOT NULL,
                    blocked_clients bigint NOT NULL,
                    PRIMARY KEY (node_id,sample_at)
                );

                CREATE INDEX IF NOT EXISTS
                    idx_koru_v86_metrics_time
                ON koru_redis_metrics_v86(sample_at);

                CREATE TABLE IF NOT EXISTS
                    koru_redis_alerts_v86
                (
                    node_id text NOT NULL,
                    rule_id text NOT NULL,
                    severity text NOT NULL,
                    title text NOT NULL,
                    detail text NOT NULL,
                    status text NOT NULL
                        CHECK(status IN (
                            'open','acknowledged','resolved'
                        )),
                    first_seen timestamptz NOT NULL,
                    last_seen timestamptz NOT NULL,
                    acknowledged_by text NULL,
                    acknowledged_at timestamptz NULL,
                    resolved_at timestamptz NULL,
                    PRIMARY KEY (node_id,rule_id)
                );

                CREATE TABLE IF NOT EXISTS
                    koru_redis_alarm_events_v86
                (
                    id bigint GENERATED ALWAYS AS IDENTITY
                        PRIMARY KEY,
                    node_id text NOT NULL,
                    rule_id text NOT NULL,
                    action text NOT NULL,
                    actor text NOT NULL,
                    happened_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE INDEX IF NOT EXISTS
                    idx_koru_v86_alarm_events_time
                ON koru_redis_alarm_events_v86(happened_at);
                """;

            await using var cmd = new NpgsqlCommand(sql, c);
            await cmd.ExecuteNonQueryAsync();

            SchemaReady = true;
        }
        finally
        {
            SchemaLock.Release();
        }
    }

    private static async Task<V86Sample> ProbeAsync(string id)
    {
        DateTime now = DateTime.UtcNow;

        try
        {
            bool cache = id == "redis-cache";
            int port = cache ? 6379 : 6380;

            string variable = cache
                ? "REDIS_CACHE_PASSWORD"
                : "REDIS_STREAMS_PASSWORD";

            string? password =
                Environment.GetEnvironmentVariable(variable);

            if (string.IsNullOrWhiteSpace(password))
                throw new InvalidOperationException(
                    "Monitoring credential missing.");

            var options = new ConfigurationOptions
            {
                Password = password,
                AbortOnConnectFail = false,
                AllowAdmin = true,
                ConnectTimeout = 3000,
                AsyncTimeout = 3000
            };

            options.EndPoints.Add("127.0.0.1", port);

            using var redis = await
                ConnectionMultiplexer.ConnectAsync(options);

            var db = redis.GetDatabase();

            TimeSpan ping = await db.PingAsync();

            var server = redis.GetServer(
                "127.0.0.1", port);

            var sections = await server.InfoAsync();

            var info = sections
                .SelectMany(section => section)
                .GroupBy(item => item.Key)
                .ToDictionary(
                    group => group.Key,
                    group => group.Last().Value);

            long Number(string key)
            {
                return info.TryGetValue(key, out var raw)
                    && long.TryParse(
                        raw,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out long value)
                    ? value : 0;
            }

            long hits = Number("keyspace_hits");
            long misses = Number("keyspace_misses");
            long total = hits + misses;

            double ratio = total > 0
                ? 100.0 * hits / total
                : 0;

            return new V86Sample(
                id, now, redis.IsConnected,
                Number("used_memory"),
                Number("maxmemory"),
                Number("connected_clients"),
                Number("instantaneous_ops_per_sec"),
                Math.Round(
                    ping.TotalMilliseconds, 3),
                Math.Round(ratio, 2),
                Number("blocked_clients")
            );
        }
        catch
        {
            return new V86Sample(
                id, now, false,
                0, 0, 0, 0, 0, 0, 0);
        }
    }

    private static List<V86AlertRule> Evaluate(
        V86Sample sample)
    {
        var result = new List<V86AlertRule>();

        void Add(
            string rule, string severity,
            string title, string detail)
        {
            result.Add(new V86AlertRule(
                sample.NodeId,
                rule, severity, title, detail));
        }

        if (!sample.Connected)
        {
            Add(
                "offline", "critical",
                "Redis connection unavailable",
                "Node monitoring connection failed.");

            return result;
        }

        if (sample.MaxMemoryBytes > 0)
        {
            double percent =
                sample.MemoryBytes * 100.0 /
                sample.MaxMemoryBytes;

            if (percent >= 80)
                Add(
                    "memory",
                    percent >= 95
                        ? "critical" : "warning",
                    "Redis memory pressure",
                    $"{percent:F1}% of configured maxmemory");
        }

        if (sample.LatencyMs >= 100)
            Add(
                "latency",
                sample.LatencyMs >= 250
                    ? "critical" : "warning",
                "High Redis ping latency",
                $"{sample.LatencyMs:F2} ms");

        if (sample.BlockedClients >= 5)
            Add(
                "blocked", "warning",
                "Blocked Redis clients",
                $"{sample.BlockedClients} blocked clients");

        return result;
    }

    private static async Task RecordEvent(
        NpgsqlConnection c,
        NpgsqlTransaction tx,
        string node, string rule,
        string action, string actor)
    {
        await using var cmd = new NpgsqlCommand(
            """
            INSERT INTO koru_redis_alarm_events_v86
                (node_id,rule_id,action,actor)
            VALUES (@n,@r,@a,@u)
            """, c, tx);

        cmd.Parameters.AddWithValue("n", node);
        cmd.Parameters.AddWithValue("r", rule);
        cmd.Parameters.AddWithValue("a", action);
        cmd.Parameters.AddWithValue("u", actor);

        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SaveSample(
        NpgsqlConnection c,
        NpgsqlTransaction tx,
        V86Sample sample)
    {
        await using var cmd = new NpgsqlCommand(
            """
            INSERT INTO koru_redis_metrics_v86
            (node_id,sample_at,connected,memory_bytes,
             max_memory_bytes,clients,ops_per_second,
             latency_ms,hit_ratio,blocked_clients)
            VALUES
            (@node,@at,@connected,@memory,@max,
             @clients,@ops,@latency,@ratio,@blocked)
            ON CONFLICT(node_id,sample_at)
            DO NOTHING
            """, c, tx);

        cmd.Parameters.AddWithValue("node", sample.NodeId);
        cmd.Parameters.AddWithValue("at", sample.SampleAt);
        cmd.Parameters.AddWithValue(
            "connected", sample.Connected);
        cmd.Parameters.AddWithValue(
            "memory", sample.MemoryBytes);
        cmd.Parameters.AddWithValue(
            "max", sample.MaxMemoryBytes);
        cmd.Parameters.AddWithValue(
            "clients", sample.Clients);
        cmd.Parameters.AddWithValue(
            "ops", sample.OpsPerSecond);
        cmd.Parameters.AddWithValue(
            "latency", sample.LatencyMs);
        cmd.Parameters.AddWithValue(
            "ratio", sample.HitRatio);
        cmd.Parameters.AddWithValue(
            "blocked", sample.BlockedClients);

        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SyncAlerts(
        NpgsqlConnection c,
        NpgsqlTransaction tx,
        V86Sample sample)
    {
        var detected = Evaluate(sample);

        foreach (string rule in Rules)
        {
            // Node offline ise diger kurallari
            // cozuldu olarak isaretleme.
            if (!sample.Connected && rule != "offline")
                continue;

            var active = detected.FirstOrDefault(
                a => a.RuleId == rule);

            string? previous;

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT status
                FROM koru_redis_alerts_v86
                WHERE node_id=@n AND rule_id=@r
                FOR UPDATE
                """, c, tx))
            {
                cmd.Parameters.AddWithValue(
                    "n", sample.NodeId);
                cmd.Parameters.AddWithValue("r", rule);

                previous =
                    await cmd.ExecuteScalarAsync() as string;
            }

            if (active is not null)
            {
                if (previous is null)
                {
                    await using var cmd = new NpgsqlCommand(
                        """
                        INSERT INTO koru_redis_alerts_v86
                        (node_id,rule_id,severity,title,
                         detail,status,first_seen,last_seen)
                        VALUES
                        (@n,@r,@s,@t,@d,'open',now(),now())
                        """, c, tx);

                    cmd.Parameters.AddWithValue(
                        "n", active.NodeId);
                    cmd.Parameters.AddWithValue(
                        "r", active.RuleId);
                    cmd.Parameters.AddWithValue(
                        "s", active.Severity);
                    cmd.Parameters.AddWithValue(
                        "t", active.Title);
                    cmd.Parameters.AddWithValue(
                        "d", active.Detail);

                    await cmd.ExecuteNonQueryAsync();
                }
                else
                {
                    await using var cmd = new NpgsqlCommand(
                        """
                        UPDATE koru_redis_alerts_v86
                        SET severity=@s,
                            title=@t,
                            detail=@d,
                            last_seen=now(),
                            status=CASE
                              WHEN status='resolved'
                              THEN 'open' ELSE status END,
                            first_seen=CASE
                              WHEN status='resolved'
                              THEN now() ELSE first_seen END,
                            acknowledged_by=CASE
                              WHEN status='resolved'
                              THEN NULL ELSE acknowledged_by END,
                            acknowledged_at=CASE
                              WHEN status='resolved'
                              THEN NULL ELSE acknowledged_at END,
                            resolved_at=CASE
                              WHEN status='resolved'
                              THEN NULL ELSE resolved_at END
                        WHERE node_id=@n AND rule_id=@r
                        """, c, tx);

                    cmd.Parameters.AddWithValue(
                        "n", active.NodeId);
                    cmd.Parameters.AddWithValue(
                        "r", active.RuleId);
                    cmd.Parameters.AddWithValue(
                        "s", active.Severity);
                    cmd.Parameters.AddWithValue(
                        "t", active.Title);
                    cmd.Parameters.AddWithValue(
                        "d", active.Detail);

                    await cmd.ExecuteNonQueryAsync();
                }

                if (previous is null ||
                    previous == "resolved")
                {
                    await RecordEvent(
                        c, tx, sample.NodeId,
                        rule, "triggered", "monitor-worker");
                }
            }
            else if (previous is "open" or "acknowledged")
            {
                await using (var cmd = new NpgsqlCommand(
                    """
                    UPDATE koru_redis_alerts_v86
                    SET status='resolved',
                        resolved_at=now(),
                        last_seen=now()
                    WHERE node_id=@n AND rule_id=@r
                    """, c, tx))
                {
                    cmd.Parameters.AddWithValue(
                        "n", sample.NodeId);
                    cmd.Parameters.AddWithValue("r", rule);

                    await cmd.ExecuteNonQueryAsync();
                }

                await RecordEvent(
                    c, tx, sample.NodeId,
                    rule, "resolved", "monitor-worker");
            }
        }
    }

    public static async Task CollectAsync(
        CancellationToken cancellationToken)
    {
        await EnsureSchemaAsync();

        // Redis hatasi node-bazli kaydedilir;
        // PostgreSQL hatasi worker dongusunde yakalanir.
        var samples = new List<V86Sample>();

        foreach (string node in Nodes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            samples.Add(await ProbeAsync(node));
        }

        await using var c =
            new NpgsqlConnection(ConnectionString());

        await c.OpenAsync(cancellationToken);

        await using var tx =
            await c.BeginTransactionAsync(cancellationToken);

        foreach (var sample in samples)
        {
            await SaveSample(c, tx, sample);
            await SyncAlerts(c, tx, sample);
        }

        await using (var cleanup = new NpgsqlCommand(
            """
            DELETE FROM koru_redis_metrics_v86
            WHERE sample_at < now() - interval '7 days'
            """, c, tx))
        {
            await cleanup.ExecuteNonQueryAsync(
                cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    public static void MapRedisMonitoringV86(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/monitoring",
            GetMonitoring
        ).RequireAuthorization();

        app.MapPost(
            "/api/v8/redis/monitoring/alerts/{node}/{rule}/ack",
            Acknowledge
        ).RequireAuthorization();
    }

    private static async Task<IResult> GetMonitoring(
        string? range,
        ClaimsPrincipal user)
    {
        if (!Auth.Has(
            user, "admin", "network",
            "redis-viewer", "redis-operator"))
            return Results.Forbid();

        try
        {
            if (!await RedisStorageV84.CanRead(user))
                return Results.Forbid();

            await EnsureSchemaAsync();

            var visible = await
                RedisNodeRegistryV82.VisibleNodesAsync(user);

            int hours = range switch
            {
                "24h" => 24,
                "7d" => 168,
                _ => 1
            };

            int bucket = hours switch
            {
                168 => 900,
                24 => 300,
                _ => 60
            };

            DateTime since = DateTime.UtcNow
                .AddHours(-hours);

            var latest = new List<object>();
            var points = new List<object>();
            var alerts = new List<object>();
            var events = new List<object>();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            // Node son olcumleri.
            await using (var cmd = new NpgsqlCommand(
                """
                SELECT DISTINCT ON (node_id)
                    node_id,sample_at,connected,
                    memory_bytes,max_memory_bytes,
                    clients,ops_per_second,latency_ms,hit_ratio
                FROM koru_redis_metrics_v86
                WHERE node_id=ANY(@nodes)
                ORDER BY node_id,sample_at DESC
                """, c))
            {
                cmd.Parameters.AddWithValue(
                    "nodes", visible.ToArray());

                await using var r = await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    latest.Add(new
                    {
                        nodeId = r.GetString(0),
                        sampleAt = r.GetDateTime(1),
                        connected = r.GetBoolean(2),
                        memoryBytes = r.GetInt64(3),
                        maxMemoryBytes = r.GetInt64(4),
                        clients = r.GetInt64(5),
                        opsPerSecond = r.GetInt64(6),
                        latencyMs = r.GetDouble(7),
                        hitRatio = r.GetDouble(8)
                    });
                }
            }

            // Uzun araliklari Postgres uzerinde
            // ozetle; istemciye binlerce ham satir gonderme.
            await using (var cmd = new NpgsqlCommand(
                """
                SELECT
                    node_id,
                    date_bin(
                        make_interval(
                            secs => CAST(@bucket AS double precision)
                        ),
                        sample_at,
                        TIMESTAMPTZ '2000-01-01 00:00:00+00'
                    ) AS time_bucket,
                    avg(memory_bytes)::bigint,
                    avg(ops_per_second)::double precision,
                    avg(latency_ms)::double precision,
                    bool_and(connected)
                FROM koru_redis_metrics_v86
                WHERE sample_at >= @since
                  AND node_id=ANY(@nodes)
                GROUP BY node_id,time_bucket
                ORDER BY time_bucket ASC
                """, c))
            {
                cmd.Parameters.AddWithValue("bucket", bucket);
                cmd.Parameters.AddWithValue("since", since);
                cmd.Parameters.AddWithValue(
                    "nodes", visible.ToArray());

                await using var r = await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    points.Add(new
                    {
                        nodeId = r.GetString(0),
                        time = r.GetDateTime(1),
                        memoryBytes = r.GetInt64(2),
                        opsPerSecond = r.GetDouble(3),
                        latencyMs = r.GetDouble(4),
                        connected = r.GetBoolean(5)
                    });
                }
            }

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT node_id,rule_id,severity,title,
                       detail,status,first_seen,last_seen,
                       acknowledged_by,resolved_at
                FROM koru_redis_alerts_v86
                WHERE node_id=ANY(@nodes)
                ORDER BY
                    CASE WHEN status='resolved'
                         THEN 1 ELSE 0 END,
                    last_seen DESC
                LIMIT 60
                """, c))
            {
                cmd.Parameters.AddWithValue(
                    "nodes", visible.ToArray());

                await using var r = await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    alerts.Add(new
                    {
                        nodeId = r.GetString(0),
                        ruleId = r.GetString(1),
                        severity = r.GetString(2),
                        title = r.GetString(3),
                        detail = r.GetString(4),
                        status = r.GetString(5),
                        firstSeen = r.GetDateTime(6),
                        lastSeen = r.GetDateTime(7),
                        acknowledgedBy = r.IsDBNull(8)
                            ? null : r.GetString(8),
                        resolvedAt = r.IsDBNull(9)
                            ? (DateTime?)null : r.GetDateTime(9)
                    });
                }
            }

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT node_id,rule_id,action,actor,happened_at
                FROM koru_redis_alarm_events_v86
                WHERE node_id=ANY(@nodes)
                ORDER BY id DESC
                LIMIT 50
                """, c))
            {
                cmd.Parameters.AddWithValue(
                    "nodes", visible.ToArray());

                await using var r = await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    events.Add(new
                    {
                        nodeId = r.GetString(0),
                        ruleId = r.GetString(1),
                        action = r.GetString(2),
                        actor = r.GetString(3),
                        happenedAt = r.GetDateTime(4)
                    });
                }
            }

            return Results.Ok(new
            {
                range = hours == 168 ? "7d"
                    : hours == 24 ? "24h" : "1h",
                latest,
                points,
                alerts,
                events,
                visibleNodes = visible.OrderBy(x => x).ToArray(),
                canAcknowledge = Auth.Has(
                    user, "admin", "network",
                    "redis-operator"),
                workerIntervalSeconds = 60,
                checkedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V86 READ] " +
                ex.GetType().Name + ": " + ex.Message);

            return Results.Problem(
                "Monitoring history unavailable.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> Acknowledge(
        string node,
        string rule,
        ClaimsPrincipal user)
    {
        if (!Auth.Has(
            user, "admin", "network", "redis-operator"))
            return Results.Forbid();

        if (!Nodes.Contains(node) || !Rules.Contains(rule))
            return Results.NotFound();

        try
        {
            if (!await RedisStorageV84.CanRead(user))
                return Results.Forbid();

            var visible = await
                RedisNodeRegistryV82.VisibleNodesAsync(user);

            if (!visible.Contains(node))
                return Results.Forbid();

            await EnsureSchemaAsync();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var tx =
                await c.BeginTransactionAsync();

            await using var cmd = new NpgsqlCommand(
                """
                UPDATE koru_redis_alerts_v86
                SET status='acknowledged',
                    acknowledged_by=@actor,
                    acknowledged_at=now()
                WHERE node_id=@node
                  AND rule_id=@rule
                  AND status='open'
                RETURNING node_id
                """, c, tx);

            cmd.Parameters.AddWithValue(
                "actor", Actor(user));
            cmd.Parameters.AddWithValue("node", node);
            cmd.Parameters.AddWithValue("rule", rule);

            object? changed =
                await cmd.ExecuteScalarAsync();

            if (changed is null)
            {
                await tx.RollbackAsync();
                return Results.Conflict(new
                {
                    message = "Alarm open durumunda degil."
                });
            }

            await RecordEvent(
                c, tx, node, rule,
                "acknowledged", Actor(user));

            await tx.CommitAsync();

            return Results.Ok(new
            {
                nodeId = node,
                ruleId = rule,
                status = "acknowledged"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V86 ACK] " + ex.GetType().Name);

            return Results.Problem(
                "Alert acknowledgement failed.",
                statusCode: 503);
        }
    }
}
