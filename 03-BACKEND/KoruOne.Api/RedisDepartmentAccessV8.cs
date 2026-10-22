using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Npgsql;

public sealed record RedisPolicyChange(bool Allowed);
public sealed record RedisPolicyRow(
    string Department, string Tool, bool Allowed,
    string UpdatedBy, DateTime UpdatedAt);

public static class RedisDepartmentAccessV8
{
    static readonly string[] Departments = {
        "network", "it", "hr", "marketing",
        "advertising", "redis"
    };

    static readonly string[] Tools = {
        "monitor", "streams", "stream-write", "acl"
    };

    static readonly SemaphoreSlim SetupLock = new(1, 1);
    static bool Ready;

    static string ConnectionString() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    static bool Admin(ClaimsPrincipal u) =>
        Auth.Has(u, "admin");

    static bool Network(ClaimsPrincipal u) =>
        Auth.Has(u, "network");

    public static string? Department(ClaimsPrincipal u)
    {
        var claim = u.FindFirst("department")?.Value
            .Trim().ToLowerInvariant();

        if (claim != null && Departments.Contains(claim))
            return claim;

        foreach (var role in new[] {
            "network", "it", "hr", "marketing",
            "advertising"
        })
            if (Auth.Has(u, role)) return role;

        if (Auth.Has(u, "redis-operator", "redis-viewer"))
            return "redis";

        return null;
    }

    static string? RouteTool(string path)
    {
        path = path.ToLowerInvariant();

        if (path == "/api/v5/redis/metrics" ||
            path == "/api/redis/metrics")
            return "monitor";

        if (path.StartsWith("/api/v7/redis/acl"))
            return "acl";

        if (path == "/api/v7/redis/diagnostics" ||
            path.StartsWith("/api/v7/redis/nodes"))
            return "monitor";

        if (path == "/api/v7/streams/overview")
            return "streams";

        if (path.StartsWith("/api/v7/streams/demo/"))
            return "stream-write";

        // Bilinmeyen Redis V7 endpoint'leri kapali.
        if (path.StartsWith("/api/v7/redis/") ||
            path.StartsWith("/api/v7/streams/"))
            return "unknown";

        return null;
    }

    static bool RoleEligible(
        ClaimsPrincipal u, string tool)
    {
        return tool switch {
            "monitor" => Auth.Has(
                u, "admin", "network",
                "redis-viewer", "redis-operator"),
            "streams" => Auth.Has(
                u, "admin", "redis-viewer",
                "redis-operator"),
            "stream-write" => Auth.Has(
                u, "admin", "redis-operator"),
            "acl" => Auth.Has(
                u, "admin", "redis-operator"),
            _ => false
        };
    }

    static async Task Setup()
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
                CREATE TABLE IF NOT EXISTS koru_redis_dept_policy (
                    department text NOT NULL,
                    tool text NOT NULL,
                    allowed boolean NOT NULL,
                    updated_by text NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (department, tool)
                );

                CREATE TABLE IF NOT EXISTS koru_redis_dept_audit (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    actor text NOT NULL,
                    department text NOT NULL,
                    tool text NOT NULL,
                    old_allowed boolean NOT NULL,
                    new_allowed boolean NOT NULL,
                    changed_at timestamptz NOT NULL DEFAULT now()
                );

                INSERT INTO koru_redis_dept_policy
                    (department, tool, allowed, updated_by)
                SELECT d.department, t.tool,
                    CASE
                      WHEN d.department = 'redis' THEN true
                      WHEN d.department = 'network'
                           AND t.tool = 'monitor' THEN true
                      ELSE false
                    END,
                    'system'
                FROM (
                    VALUES ('network'), ('it'), ('hr'),
                           ('marketing'), ('advertising'),
                           ('redis')
                ) AS d(department)
                CROSS JOIN (
                    VALUES ('monitor'), ('streams'),
                           ('stream-write'), ('acl')
                ) AS t(tool)
                ON CONFLICT (department, tool) DO NOTHING;
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

    static async Task<bool> Allowed(
        string department, string tool)
    {
        await Setup();

        await using var c =
            new NpgsqlConnection(ConnectionString());
        await c.OpenAsync();

        await using var cmd = new NpgsqlCommand(
            """
            SELECT allowed FROM koru_redis_dept_policy
            WHERE department=@d AND tool=@t
            """, c);

        cmd.Parameters.AddWithValue("d", department);
        cmd.Parameters.AddWithValue("t", tool);

        return await cmd.ExecuteScalarAsync() is true;
    }

    public static IApplicationBuilder UseRedisDepartmentGateV8(
        this IApplicationBuilder app)
    {
        return app.Use(async (ctx, next) =>
        {
            string? tool = RouteTool(
                ctx.Request.Path.Value ?? "");

            if (tool == null)
            {
                await next(ctx);
                return;
            }

            if (ctx.User.Identity?.IsAuthenticated != true)
            {
                ctx.Response.StatusCode = 401;
                return;
            }

            // Admin daima kurtarma/yonetim erisimine sahip.
            if (Admin(ctx.User))
            {
                await next(ctx);
                return;
            }

            string? dept = Department(ctx.User);

            if (dept == null ||
                !RoleEligible(ctx.User, tool))
            {
                ctx.Response.StatusCode = 403;
                return;
            }

            try
            {
                bool? personal =
                    await RedisUserAccessV83.OverrideAsync(
                        ctx.User, dept, tool);

                bool permitted =
                    personal ?? await Allowed(dept, tool);

                if (!permitted)
                {
                    ctx.Response.StatusCode = 403;
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    "[REDIS POLICY] " + ex.GetType().Name);

                // PostgreSQL erisilemezse varsayilan deny.
                ctx.Response.StatusCode = 503;
                return;
            }

            await next(ctx);
        });
    }

    public static void MapRedisDepartmentAccessV8(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/access",
            GetAccess).RequireAuthorization();

        app.MapPut(
            "/api/v8/redis/access/{department}/{tool}",
            UpdateAccess).RequireAuthorization();
    }

    static async Task<IResult> GetAccess(
        ClaimsPrincipal user)
    {
        if (!Admin(user) && !Network(user))
            return Results.Forbid();

        try
        {
            await Setup();

            var rows = new List<RedisPolicyRow>();
            var history = new List<object>();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT department, tool, allowed,
                       updated_by, updated_at
                FROM koru_redis_dept_policy
                ORDER BY department, tool
                """, c))
            await using (var r = await cmd.ExecuteReaderAsync())
            {
                while (await r.ReadAsync())
                    rows.Add(new RedisPolicyRow(
                        r.GetString(0), r.GetString(1),
                        r.GetBoolean(2), r.GetString(3),
                        r.GetDateTime(4)));
            }

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT actor, department, tool,
                       old_allowed, new_allowed, changed_at
                FROM koru_redis_dept_audit
                ORDER BY id DESC LIMIT 25
                """, c))
            await using (var r = await cmd.ExecuteReaderAsync())
            {
                while (await r.ReadAsync())
                    history.Add(new {
                        actor = r.GetString(0),
                        department = r.GetString(1),
                        tool = r.GetString(2),
                        previous = r.GetBoolean(3),
                        current = r.GetBoolean(4),
                        changedAt = r.GetDateTime(5)
                    });
            }

            return Results.Ok(new {
                isAdmin = Admin(user),
                isNetworkManager = Network(user),
                department = Department(user),
                rows, history,
                checkedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[REDIS ACCESS READ] " + ex.GetType().Name);

            return Results.Problem(
                "Redis yetki tablosu okunamadi.",
                statusCode: 503);
        }
    }

    static async Task<IResult> UpdateAccess(
        string department,
        string tool,
        RedisPolicyChange change,
        ClaimsPrincipal user)
    {
        department = department.ToLowerInvariant();
        tool = tool.ToLowerInvariant();

        if (!Departments.Contains(department) ||
            !Tools.Contains(tool))
            return Results.BadRequest(
                new { message = "Gecersiz izin hedefi." });

        bool admin = Admin(user);
        bool networkManager =
            Network(user) &&
            department == "network" &&
            tool == "monitor";

        if (!admin && !networkManager)
            return Results.Forbid();

        string actor = user.FindFirst(
            "preferred_username")?.Value
            ?? user.Identity?.Name
            ?? Auth.UserId(user);

        try
        {
            await Setup();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var tx =
                await c.BeginTransactionAsync();

            await using var read = new NpgsqlCommand(
                """
                SELECT allowed FROM koru_redis_dept_policy
                WHERE department=@d AND tool=@t
                FOR UPDATE
                """, c, tx);

            read.Parameters.AddWithValue("d", department);
            read.Parameters.AddWithValue("t", tool);

            var old = await read.ExecuteScalarAsync();
            if (old is not bool previous)
                return Results.NotFound();

            if (previous != change.Allowed)
            {
                await using var update = new NpgsqlCommand(
                    """
                    UPDATE koru_redis_dept_policy
                    SET allowed=@a, updated_by=@u,
                        updated_at=now()
                    WHERE department=@d AND tool=@t
                    """, c, tx);

                update.Parameters.AddWithValue(
                    "a", change.Allowed);
                update.Parameters.AddWithValue("u", actor);
                update.Parameters.AddWithValue(
                    "d", department);
                update.Parameters.AddWithValue("t", tool);

                await update.ExecuteNonQueryAsync();

                await using var audit = new NpgsqlCommand(
                    """
                    INSERT INTO koru_redis_dept_audit
                    (actor, department, tool,
                     old_allowed, new_allowed)
                    VALUES (@u,@d,@t,@old,@new)
                    """, c, tx);

                audit.Parameters.AddWithValue("u", actor);
                audit.Parameters.AddWithValue(
                    "d", department);
                audit.Parameters.AddWithValue("t", tool);
                audit.Parameters.AddWithValue(
                    "old", previous);
                audit.Parameters.AddWithValue(
                    "new", change.Allowed);

                await audit.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return Results.Ok(new {
                department, tool,
                allowed = change.Allowed,
                changed = previous != change.Allowed,
                actor
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[REDIS ACCESS UPDATE] " +
                ex.GetType().Name);

            return Results.Problem(
                "Yetki degisikligi kaydedilemedi.",
                statusCode: 503);
        }
    }
}
