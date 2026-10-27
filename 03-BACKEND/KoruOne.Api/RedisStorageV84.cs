using System.Collections.Concurrent;
using System.Security.Claims;
using System.Globalization;
using System.Text.RegularExpressions;
using Npgsql;
using StackExchange.Redis;

public sealed record V84BudgetInput(
    int BudgetMb, string Prefix);

public sealed record V84Policy(
    string Department, string NodeId,
    int BudgetMb, string Prefix);

public sealed record V84Usage(
    string Department, string NodeId,
    int BudgetMb, string Prefix,
    long? MeasuredBytes, int SampledKeys,
    string State);

public sealed record V84Node(
    string Id, bool Connected,
    long UsedBytes, long MaxMemoryBytes,
    string? Error);

public sealed record V84Sample(
    string Department, string NodeId,
    DateTime SampleAt, long MeasuredBytes,
    bool Complete);

public static class RedisStorageV84
{
    private static readonly string[] Departments =
    [
        "hr", "network", "it", "marketing",
        "advertising", "redis"
    ];

    private static readonly string[] Nodes =
    [
        "redis-cache", "redis-streams"
    ];

    private static readonly ConcurrentDictionary<
        string, Lazy<Task<ConnectionMultiplexer>>
    > Connections = new();

    private static readonly SemaphoreSlim SetupLock = new(1, 1);
    private static readonly SemaphoreSlim SampleLock = new(1, 1);
    private static bool Ready;

    private static string ConnectionString() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    private static bool Admin(ClaimsPrincipal user) =>
        Auth.Has(user, "admin");

    private static string? Department(ClaimsPrincipal user) =>
        RedisDepartmentAccessV8.Department(user);

    private static string Actor(ClaimsPrincipal user) =>
        user.FindFirst("preferred_username")?.Value
        ?? user.Identity?.Name
        ?? Auth.UserId(user);

    private static async Task Setup()
    {
        if (Ready) return;

        await SetupLock.WaitAsync();
        try
        {
            if (Ready) return;

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            const string sql = """
                CREATE TABLE IF NOT EXISTS koru_redis_storage_v84
                (
                    department text NOT NULL,
                    node_id text NOT NULL,
                    budget_mb integer NOT NULL,
                    prefix text NOT NULL,
                    updated_by text NOT NULL DEFAULT 'system',
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (department,node_id)
                );

                CREATE TABLE IF NOT EXISTS koru_redis_storage_history_v84
                (
                    department text NOT NULL,
                    node_id text NOT NULL,
                    sample_at timestamptz NOT NULL,
                    measured_bytes bigint NOT NULL,
                    complete boolean NOT NULL,
                    PRIMARY KEY (department,node_id,sample_at)
                );

                CREATE TABLE IF NOT EXISTS koru_redis_storage_audit_v84
                (
                    id bigint GENERATED ALWAYS AS IDENTITY
                        PRIMARY KEY,
                    actor text NOT NULL,
                    department text NOT NULL,
                    node_id text NOT NULL,
                    old_budget integer NOT NULL,
                    new_budget integer NOT NULL,
                    old_prefix text NOT NULL,
                    new_prefix text NOT NULL,
                    changed_at timestamptz NOT NULL DEFAULT now()
                );

                INSERT INTO koru_redis_storage_v84
                    (department,node_id,budget_mb,prefix)
                SELECT d.department,n.node_id,256,
                    CASE
                      WHEN d.department='redis'
                       AND n.node_id='redis-streams'
                      THEN 'koru:lab:'
                      ELSE 'koru:' || d.department || ':'
                    END
                FROM (
                    VALUES ('hr'),('network'),('it'),
                           ('marketing'),('advertising'),
                           ('redis')
                ) d(department)
                CROSS JOIN (
                    VALUES ('redis-cache'),('redis-streams')
                ) n(node_id)
                ON CONFLICT (department,node_id) DO NOTHING;
                """;

            await using var cmd = new NpgsqlCommand(sql, c);
            await cmd.ExecuteNonQueryAsync();
            Ready = true;
        }
        finally
        {
            SetupLock.Release();
        }
    }

    public static async Task<bool> CanRead(
        ClaimsPrincipal user)
    {
        if (Admin(user)) return true;

        if (!Auth.Has(
            user, "network", "redis-viewer",
            "redis-operator"))
            return false;

        string? dept = Department(user);
        if (string.IsNullOrWhiteSpace(dept))
            return false;

        bool? personal =
            await RedisUserAccessV83.OverrideAsync(
                user, dept, "monitor");

        if (personal.HasValue)
            return personal.Value;

        await using var c =
            new NpgsqlConnection(ConnectionString());
        await c.OpenAsync();

        await using var cmd = new NpgsqlCommand(
            """
            SELECT allowed FROM koru_redis_dept_policy
            WHERE department=@d AND tool='monitor'
            """, c);

        cmd.Parameters.AddWithValue("d", dept);

        return await cmd.ExecuteScalarAsync() is true;
    }

    // KORU_V897_LEGACY_REDIS_CONNECTION
    // REDIS_URL ve REDIS_STREAMS_URL onceliklidir.
    // Eski parola degiskenleri geriye uyumluluk icin desteklenir.
    private static async Task<ConnectionMultiplexer>
        Connection(string node)
    {
        bool cache=node=="redis-cache";

        string urlEnv=cache
            ? "REDIS_URL"
            : "REDIS_STREAMS_URL";

        string passwordEnv=cache
            ? "REDIS_CACHE_PASSWORD"
            : "REDIS_STREAMS_PASSWORD";

        string? url=Environment.GetEnvironmentVariable(urlEnv);
        string? password=Environment.GetEnvironmentVariable(passwordEnv);

        if(string.IsNullOrWhiteSpace(url) &&
           string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException(
                "Redis connection configuration missing.");

        var lazy=Connections.GetOrAdd(
            node,
            _=>new Lazy<Task<ConnectionMultiplexer>>(
                async ()=>
                {
                    ConfigurationOptions options;

                    if(!string.IsNullOrWhiteSpace(url))
                    {
                        options=ConfigurationOptions.Parse(url,true);
                    }
                    else
                    {
                        options=new ConfigurationOptions
                        {
                            Password=password
                        };
                    }

                    if(options.EndPoints.Count==0)
                        options.EndPoints.Add(
                            "127.0.0.1",cache?6379:6380);

                    options.AllowAdmin=true;
                    options.AbortOnConnectFail=false;
                    options.ConnectTimeout=3000;
                    options.AsyncTimeout=3000;

                    return await ConnectionMultiplexer
                        .ConnectAsync(options);
                }));

        try
        {
            return await lazy.Value;
        }
        catch
        {
            Connections.TryRemove(node,out _);
            throw;
        }
    }

    private static async Task<List<V84Policy>>
        ReadPolicies()
    {
        await RedisOpsV85.EnsureSchemaAsync();
        var policies = new List<V84Policy>();

        await using var c =
            new NpgsqlConnection(ConnectionString());
        await c.OpenAsync();

        await using var cmd = new NpgsqlCommand(
            """
            SELECT department,node_id,budget_mb,prefix
            FROM koru_redis_storage_v84
            WHERE active=true
            ORDER BY department,node_id
            """, c);

        await using var r = await cmd.ExecuteReaderAsync();

        while (await r.ReadAsync())
            policies.Add(new V84Policy(
                r.GetString(0), r.GetString(1),
                r.GetInt32(2), r.GetString(3)));

        return policies;
    }

    // En fazla 4 SCAN sayfasi ve 40 anahtar.
    // Sinira ulasilirsa sonuc kismi olarak isaretlenir.
    private static async Task<(long, int, bool)>
        Measure(IDatabase db, string prefix)
    {
        long cursor = 0;
        long totalBytes = 0;
        bool complete = false;

        var seen = new HashSet<string>(
            StringComparer.Ordinal);

        for (int page = 0; page < 4; page++)
        {
            var raw = await db.ExecuteAsync(
                "SCAN",
                cursor, "MATCH", prefix + "*",
                "COUNT", 80);

            RedisResult[] parts = (RedisResult[])raw;
            RedisResult[] keys =
                (RedisResult[])parts[1];

            if (!long.TryParse(
                parts[0].ToString(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out cursor))
                throw new InvalidOperationException(
                    "Invalid SCAN cursor.");

            foreach (var item in keys)
            {
                string key = item.ToString() ?? "";

                if (!seen.Add(key)) continue;

                var usage = await db.ExecuteAsync(
                    "MEMORY", "USAGE", key);

                if (long.TryParse(
                    usage.ToString(),
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out long bytes))
                    totalBytes += bytes;

                if (seen.Count >= 40) break;
            }

            if (seen.Count >= 40)
            {
                complete = false;
                break;
            }

            if (cursor == 0)
            {
                complete = true;
                break;
            }
        }

        return (totalBytes, seen.Count, complete);
    }

    private static async Task<(V84Node, List<V84Usage>)>
        ReadNode(string node, List<V84Policy> policies)
    {
        var readings = new List<V84Usage>();

        try
        {
            var redis = await Connection(node);
            var db = redis.GetDatabase();

            int port = node == "redis-cache" ? 6379 : 6380;

            var server = redis.GetServer(
                "127.0.0.1", port);

            var sections = await server.InfoAsync("memory");

            var info = sections
                .SelectMany(section => section)
                .GroupBy(pair => pair.Key)
                .ToDictionary(
                    group => group.Key,
                    group => group.Last().Value);

            long Number(string key)
            {
                return info.TryGetValue(key, out var value)
                    && long.TryParse(
                        value,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out long parsed)
                    ? parsed : 0;
            }

            foreach (var policy in policies)
            {
                try
                {
                    var (bytes, keys, complete) =
                        await Measure(db, policy.Prefix);

                    readings.Add(new V84Usage(
                        policy.Department,
                        node,
                        policy.BudgetMb,
                        policy.Prefix,
                        bytes,
                        keys,
                        complete ? "complete" : "partial"));
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        "[V84 MEASURE] " +
                        node + "/" + policy.Department +
                        ": " + ex.GetType().Name);

                    readings.Add(new V84Usage(
                        policy.Department,
                        node,
                        policy.BudgetMb,
                        policy.Prefix,
                        null, 0, "unavailable"));
                }
            }

            return (
                new V84Node(
                    node, redis.IsConnected,
                    Number("used_memory"),
                    Number("maxmemory"), null),
                readings
            );
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V84 NODE] " + node + ": " +
                ex.GetType().Name);

            foreach (var policy in policies)
                readings.Add(new V84Usage(
                    policy.Department, node,
                    policy.BudgetMb, policy.Prefix,
                    null, 0, "unavailable"));

            return (
                new V84Node(
                    node, false, 0, 0,
                    "Metrics unavailable"),
                readings
            );
        }
    }

    public static void MapRedisStorageV84(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/storage",
            GetStorage).RequireAuthorization();

        app.MapPut(
            "/api/v8/redis/storage/{department}/{node}",
            UpdatePolicy).RequireAuthorization();
    }

    private static async Task<IResult> GetStorage(
        ClaimsPrincipal user)
    {
        try
        {
            await Setup();

            if (!await CanRead(user))
                return Results.Forbid();

            bool admin = Admin(user);
            string? dept = Department(user);

            var visibleNodes = await
                RedisNodeRegistryV82.VisibleNodesAsync(user);

            var policies = (await ReadPolicies())
                .Where(p => admin ||
                    p.Department == dept)
                .Where(p => visibleNodes.Contains(p.NodeId))
                .ToList();

            var nodeStats = new List<V84Node>();
            var readings = new List<V84Usage>();

            // Eszamanli agir taramalarin onune gec.
            await SampleLock.WaitAsync();
            try
            {
                foreach (var node in Nodes)
                {
                    if (!visibleNodes.Contains(node)) continue;

                    var scoped = policies
                        .Where(p => p.NodeId == node)
                        .ToList();

                    var (stats, usage) = await
                        ReadNode(node, scoped);

                    nodeStats.Add(stats);
                    readings.AddRange(usage);
                }

                await using var c =
                    new NpgsqlConnection(ConnectionString());
                await c.OpenAsync();

                foreach (var row in readings)
                {
                    if (!row.MeasuredBytes.HasValue)
                        continue;

                    await using var cmd = new NpgsqlCommand(
                        """
                        INSERT INTO koru_redis_storage_history_v84
                        (department,node_id,sample_at,
                         measured_bytes,complete)
                        VALUES (
                            @d,@n,
                            date_trunc('minute',now()),
                            @bytes,@complete
                        )
                        ON CONFLICT
                            (department,node_id,sample_at)
                        DO UPDATE SET
                            measured_bytes=excluded.measured_bytes,
                            complete=excluded.complete
                        """, c);

                    cmd.Parameters.AddWithValue(
                        "d", row.Department);
                    cmd.Parameters.AddWithValue(
                        "n", row.NodeId);
                    cmd.Parameters.AddWithValue(
                        "bytes", row.MeasuredBytes.Value);
                    cmd.Parameters.AddWithValue(
                        "complete", row.State == "complete");

                    await cmd.ExecuteNonQueryAsync();
                }

                await using var cleanup = new NpgsqlCommand(
                    """
                    DELETE FROM koru_redis_storage_history_v84
                    WHERE sample_at < now() - interval '48 hours'
                    """, c);

                await cleanup.ExecuteNonQueryAsync();
            }
            finally
            {
                SampleLock.Release();
            }

            var history = new List<V84Sample>();

            await using (var c =
                new NpgsqlConnection(ConnectionString()))
            {
                await c.OpenAsync();

                await using var cmd = new NpgsqlCommand(
                    """
                    SELECT department,node_id,sample_at,
                           measured_bytes,complete
                    FROM koru_redis_storage_history_v84
                    WHERE sample_at >= now() - interval '1 hour'
                      AND (@admin OR department=@department)
                    ORDER BY sample_at DESC
                    LIMIT 1000
                    """, c);

                cmd.Parameters.AddWithValue("admin", admin);
                cmd.Parameters.AddWithValue(
                    "department", dept ?? "");

                await using var r =
                    await cmd.ExecuteReaderAsync();

                while (await r.ReadAsync())
                {
                    if (!visibleNodes.Contains(r.GetString(1)))
                        continue;

                    history.Add(new V84Sample(
                        r.GetString(0),
                        r.GetString(1),
                        r.GetDateTime(2),
                        r.GetInt64(3),
                        r.GetBoolean(4)));
                }
            }

            return Results.Ok(new
            {
                isAdmin = admin,
                nodes = nodeStats,
                departments = readings,
                history,
                checkedAt = DateTime.UtcNow,
                budgetIsEnforced = false,
                attributionMethod = "namespace-memory-usage",
                samplingLimit = "4 SCAN pages / 40 keys per namespace"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V84 STORAGE] " +
                ex.GetType().Name + ": " + ex.Message);

            return Results.Problem(
                "Storage metrics unavailable.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> UpdatePolicy(
        string department,
        string node,
        V84BudgetInput input,
        ClaimsPrincipal user)
    {
        if (!Admin(user)) return Results.Forbid();

        department = department.ToLowerInvariant();
        node = node.ToLowerInvariant();

        if (!Departments.Contains(department) ||
            !Nodes.Contains(node))
            return Results.BadRequest(
                new { message = "Invalid scope." });

        string prefix = (input.Prefix ?? "")
            .Trim().ToLowerInvariant();

        if (input.BudgetMb < 1 ||
            input.BudgetMb > 102400 ||
            !Regex.IsMatch(
                prefix,
                @"^koru:[a-z0-9][a-z0-9:_-]{1,55}:$"))
            return Results.BadRequest(new
            {
                message = "Budget 1-102400 MB; prefix koru:...: formatinda olmali."
            });

        try
        {
            await Setup();
            await RedisOpsV85.EnsureSchemaAsync();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var tx =
                await c.BeginTransactionAsync();

            // Paralel prefix duzenlemelerini seri hale getir.
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

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT prefix
                FROM koru_redis_storage_v84
                WHERE node_id=@node
                  AND department<>@dept
                  AND active=true
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("node", node);
                cmd.Parameters.AddWithValue(
                    "dept", department);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    string other = reader.GetString(0);

                    if (prefix.StartsWith(other,
                            StringComparison.Ordinal) ||
                        other.StartsWith(prefix,
                            StringComparison.Ordinal))
                        return Results.BadRequest(new
                        {
                            message = "Namespace overlap: " + other
                        });
                }
            }

            int oldBudget;
            string oldPrefix;

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT budget_mb,prefix,active
                FROM koru_redis_storage_v84
                WHERE department=@dept AND node_id=@node
                FOR UPDATE
                """, c, tx))
            {
                cmd.Parameters.AddWithValue(
                    "dept", department);
                cmd.Parameters.AddWithValue("node", node);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                    return Results.NotFound();

                oldBudget = reader.GetInt32(0);
                oldPrefix = reader.GetString(1);
                if (!reader.GetBoolean(2))
                    return Results.Conflict(new
                    {
                        message = "Plan pasif. Once geri yukleyin."
                    });
            }

            bool changed =
                oldBudget != input.BudgetMb ||
                oldPrefix != prefix;

            if (changed)
            {
                await using (var cmd = new NpgsqlCommand(
                    """
                    UPDATE koru_redis_storage_v84
                    SET budget_mb=@budget,prefix=@prefix,
                        updated_by=@actor,updated_at=now()
                    WHERE department=@dept AND node_id=@node
                    """, c, tx))
                {
                    cmd.Parameters.AddWithValue(
                        "budget", input.BudgetMb);
                    cmd.Parameters.AddWithValue(
                        "prefix", prefix);
                    cmd.Parameters.AddWithValue(
                        "actor", Actor(user));
                    cmd.Parameters.AddWithValue(
                        "dept", department);
                    cmd.Parameters.AddWithValue(
                        "node", node);

                    await cmd.ExecuteNonQueryAsync();
                }

                await using (var cmd = new NpgsqlCommand(
                    """
                    INSERT INTO koru_redis_storage_audit_v84
                    (actor,department,node_id,old_budget,
                     new_budget,old_prefix,new_prefix)
                    VALUES
                    (@actor,@dept,@node,@old,@new,
                     @oldPrefix,@newPrefix)
                    """, c, tx))
                {
                    cmd.Parameters.AddWithValue(
                        "actor", Actor(user));
                    cmd.Parameters.AddWithValue(
                        "dept", department);
                    cmd.Parameters.AddWithValue(
                        "node", node);
                    cmd.Parameters.AddWithValue(
                        "old", oldBudget);
                    cmd.Parameters.AddWithValue(
                        "new", input.BudgetMb);
                    cmd.Parameters.AddWithValue(
                        "oldPrefix", oldPrefix);
                    cmd.Parameters.AddWithValue(
                        "newPrefix", prefix);

                    await cmd.ExecuteNonQueryAsync();
                }
            }

            await tx.CommitAsync();

            return Results.Ok(new
            {
                changed,
                department,
                nodeId = node,
                budgetMb = input.BudgetMb,
                prefix
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V84 UPDATE] " + ex.GetType().Name);

            return Results.Problem(
                "Storage policy could not be saved.",
                statusCode: 503);
        }
    }
}
