using System.Security.Claims;
using Npgsql;

public sealed record V82AssignmentInput(bool Assigned);

public static class RedisNodeRegistryV82
{
    private static readonly string[] Nodes =
    {
        "redis-cache",
        "redis-streams"
    };

    private static readonly string[] Departments =
    {
        "network",
        "it",
        "hr",
        "marketing",
        "advertising",
        "redis"
    };

    private static readonly SemaphoreSlim SchemaLock = new(1, 1);
    private static bool Ready;

    private static bool Admin(ClaimsPrincipal user) =>
        Auth.Has(user, "admin");

    private static string? Department(ClaimsPrincipal user) =>
        RedisDepartmentAccessV8.Department(user);

    private static string ConnectionString() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    private static async Task EnsureSchemaAsync()
    {
        if (Ready) return;

        await SchemaLock.WaitAsync();
        try
        {
            if (Ready) return;

            await using var connection =
                new NpgsqlConnection(ConnectionString());

            await connection.OpenAsync();

            const string sql = """
                CREATE TABLE IF NOT EXISTS
                    koru_redis_node_registry
                (
                    department text NOT NULL,
                    node_id text NOT NULL,
                    assigned boolean NOT NULL,
                    updated_by text NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (department, node_id)
                );

                CREATE TABLE IF NOT EXISTS
                    koru_redis_node_registry_audit
                (
                    id bigint GENERATED ALWAYS AS IDENTITY
                        PRIMARY KEY,
                    actor text NOT NULL,
                    department text NOT NULL,
                    node_id text NOT NULL,
                    previous boolean NOT NULL,
                    current boolean NOT NULL,
                    changed_at timestamptz NOT NULL DEFAULT now()
                );

                INSERT INTO koru_redis_node_registry
                    (department, node_id, assigned, updated_by)
                SELECT d.department, n.node_id,
                    d.department IN ('network', 'redis'),
                    'system'
                FROM (
                    VALUES ('network'), ('it'), ('hr'),
                           ('marketing'), ('advertising'),
                           ('redis')
                ) d(department)
                CROSS JOIN (
                    VALUES ('redis-cache'), ('redis-streams')
                ) n(node_id)
                ON CONFLICT (department, node_id)
                DO NOTHING;
                """;

            await using var command =
                new NpgsqlCommand(sql, connection);

            await command.ExecuteNonQueryAsync();

            Ready = true;
        }
        finally
        {
            SchemaLock.Release();
        }
    }

    public static async Task<HashSet<string>> VisibleNodesAsync(
        ClaimsPrincipal user)
    {
        if (Admin(user))
            return Nodes.ToHashSet(
                StringComparer.OrdinalIgnoreCase);

        var department = Department(user);

        if (string.IsNullOrWhiteSpace(department))
            return new HashSet<string>(
                StringComparer.OrdinalIgnoreCase);

        await EnsureSchemaAsync();

        var result = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

        await using var connection =
            new NpgsqlConnection(ConnectionString());

        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            """
            SELECT node_id
            FROM koru_redis_node_registry
            WHERE department=@department
              AND assigned=true
            """, connection);

        command.Parameters.AddWithValue(
            "department", department);

        await using var reader =
            await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
            result.Add(reader.GetString(0));

        return result;
    }

    public static IApplicationBuilder
        UseRedisNodeRegistryGateV82(
            this IApplicationBuilder app)
    {
        return app.Use(async (ctx, next) =>
        {
            string path = (
                ctx.Request.Path.Value ?? ""
            ).ToLowerInvariant();

            string? node = null;

            if (path == "/api/v5/redis/metrics" ||
                path == "/api/redis/metrics")
            {
                node = "redis-cache";
            }
            else if (path.StartsWith(
                "/api/v7/streams/",
                StringComparison.Ordinal))
            {
                node = "redis-streams";
            }
            else
            {
                var parts = path.Split(
                    '/', StringSplitOptions.RemoveEmptyEntries);

                if (parts.Length >= 6 &&
                    parts[0] == "api" &&
                    parts[1] == "v7" &&
                    parts[2] == "redis" &&
                    parts[3] == "nodes" &&
                    parts[5] == "metrics")
                {
                    node = parts[4];
                }

                if (parts.Length >= 5 &&
                    parts[0] == "api" &&
                    parts[1] == "v7" &&
                    parts[2] == "redis" &&
                    (parts[3] == "acl" ||
                     parts[3] == "acl-pro"))
                {
                    node = parts[4] switch
                    {
                        "cache" => "redis-cache",
                        "streams" => "redis-streams",
                        _ => "invalid-node"
                    };
                }
            }

            if (node == null)
            {
                await next(ctx);
                return;
            }

            if (ctx.User.Identity?.IsAuthenticated != true)
            {
                ctx.Response.StatusCode = 401;
                return;
            }

            if (!Nodes.Contains(node))
            {
                ctx.Response.StatusCode = 404;
                return;
            }

            if (Admin(ctx.User))
            {
                await next(ctx);
                return;
            }

            try
            {
                var visible = await VisibleNodesAsync(ctx.User);

                if (!visible.Contains(node))
                {
                    ctx.Response.StatusCode = 403;
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    "[NODE GATE] " + ex.GetType().Name);

                // Registry okunamazsa erisim verme.
                ctx.Response.StatusCode = 503;
                return;
            }

            await next(ctx);
        });
    }

    public static void MapRedisNodeRegistryV82(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/registry",
            GetRegistry
        ).RequireAuthorization();

        app.MapPut(
            "/api/v8/redis/registry/{department}/{node}",
            UpdateRegistry
        ).RequireAuthorization();
    }

    private static async Task<IResult> GetRegistry(
        ClaimsPrincipal user)
    {
        if (!Auth.Has(
            user, "admin", "network",
            "redis-viewer", "redis-operator"))
            return Results.Forbid();

        try
        {
            await EnsureSchemaAsync();

            bool admin = Admin(user);
            string department = Department(user) ?? "";

            var rows = new List<object>();
            var audit = new List<object>();

            await using var connection =
                new NpgsqlConnection(ConnectionString());

            await connection.OpenAsync();

            await using (var command = new NpgsqlCommand(
                """
                SELECT department, node_id, assigned,
                       updated_by, updated_at
                FROM koru_redis_node_registry
                WHERE @admin OR department=@department
                ORDER BY department, node_id
                """, connection))
            {
                command.Parameters.AddWithValue("admin", admin);
                command.Parameters.AddWithValue(
                    "department", department);

                await using var reader =
                    await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                    rows.Add(new
                    {
                        department = reader.GetString(0),
                        nodeId = reader.GetString(1),
                        assigned = reader.GetBoolean(2),
                        updatedBy = reader.GetString(3),
                        updatedAt = reader.GetDateTime(4)
                    });
            }

            await using (var command = new NpgsqlCommand(
                """
                SELECT actor, department, node_id,
                       previous, current, changed_at
                FROM koru_redis_node_registry_audit
                WHERE @admin OR department=@department
                ORDER BY id DESC
                LIMIT 30
                """, connection))
            {
                command.Parameters.AddWithValue("admin", admin);
                command.Parameters.AddWithValue(
                    "department", department);

                await using var reader =
                    await command.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                    audit.Add(new
                    {
                        actor = reader.GetString(0),
                        department = reader.GetString(1),
                        nodeId = reader.GetString(2),
                        previous = reader.GetBoolean(3),
                        current = reader.GetBoolean(4),
                        changedAt = reader.GetDateTime(5)
                    });
            }

            return Results.Ok(new
            {
                isAdmin = admin,
                department = admin ? "all" : department,
                rows,
                audit,
                checkedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[NODE REGISTRY READ] " +
                ex.GetType().Name);

            return Results.Problem(
                "Redis node envanteri okunamadi.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> UpdateRegistry(
        string department,
        string node,
        V82AssignmentInput input,
        ClaimsPrincipal user)
    {
        if (!Admin(user))
            return Results.Forbid();

        department = department.ToLowerInvariant();
        node = node.ToLowerInvariant();

        if (!Departments.Contains(department) ||
            !Nodes.Contains(node))
            return Results.BadRequest(
                new { message = "Bilinmeyen node veya departman." });

        string actor =
            user.FindFirst("preferred_username")?.Value
            ?? user.Identity?.Name
            ?? Auth.UserId(user);

        try
        {
            await EnsureSchemaAsync();

            await using var connection =
                new NpgsqlConnection(ConnectionString());

            await connection.OpenAsync();

            await using var tx =
                await connection.BeginTransactionAsync();

            await using var read = new NpgsqlCommand(
                """
                SELECT assigned
                FROM koru_redis_node_registry
                WHERE department=@department
                  AND node_id=@node
                FOR UPDATE
                """, connection, tx);

            read.Parameters.AddWithValue(
                "department", department);
            read.Parameters.AddWithValue("node", node);

            var existing = await read.ExecuteScalarAsync();

            if (existing is not bool previous)
                return Results.NotFound();

            if (previous != input.Assigned)
            {
                await using var update = new NpgsqlCommand(
                    """
                    UPDATE koru_redis_node_registry
                    SET assigned=@assigned,
                        updated_by=@actor,
                        updated_at=now()
                    WHERE department=@department
                      AND node_id=@node
                    """, connection, tx);

                update.Parameters.AddWithValue(
                    "assigned", input.Assigned);
                update.Parameters.AddWithValue("actor", actor);
                update.Parameters.AddWithValue(
                    "department", department);
                update.Parameters.AddWithValue("node", node);

                await update.ExecuteNonQueryAsync();

                await using var log = new NpgsqlCommand(
                    """
                    INSERT INTO koru_redis_node_registry_audit
                    (actor, department, node_id,
                     previous, current)
                    VALUES (@actor,@department,@node,
                            @previous,@current)
                    """, connection, tx);

                log.Parameters.AddWithValue("actor", actor);
                log.Parameters.AddWithValue(
                    "department", department);
                log.Parameters.AddWithValue("node", node);
                log.Parameters.AddWithValue(
                    "previous", previous);
                log.Parameters.AddWithValue(
                    "current", input.Assigned);

                await log.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return Results.Ok(new
            {
                department,
                nodeId = node,
                assigned = input.Assigned,
                changed = previous != input.Assigned,
                actor
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[NODE REGISTRY UPDATE] " +
                ex.GetType().Name);

            return Results.Problem(
                "Node atamasi kaydedilemedi.",
                statusCode: 503);
        }
    }
}
