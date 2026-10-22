using System.Security.Claims;
using Npgsql;

public sealed record V83PermissionInput(string Decision);

public sealed class V83ManagedUser
{
    public long Id { get; set; }
    public string Username { get; set; } = "";
    public string Department { get; set; } = "";
    public string[] Roles { get; set; } = [];
    public DateTime LastSeen { get; set; }
    public Dictionary<string, string> Permissions { get; set; } = new();
}

public static class RedisUserAccessV83
{
    private static readonly string[] Tools =
    {
        "monitor", "streams", "stream-write", "acl"
    };

    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static bool Initialized;

    private static string ConnectionString() =>
        Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";

    private static string? Subject(ClaimsPrincipal u) =>
        u.FindFirst("sub")?.Value
        ?? u.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    private static string Username(ClaimsPrincipal u)
    {
        string name = u.FindFirst("preferred_username")?.Value
            ?? u.Identity?.Name
            ?? "unknown";

        return name.Length > 160 ? name[..160] : name;
    }

    private static string Department(ClaimsPrincipal u) =>
        Auth.Has(u, "admin")
            ? "admin"
            : RedisDepartmentAccessV8.Department(u)
              ?? "unassigned";

    // V8.3'teki CS0103 hatasinin duzeltilmis hali.
    private static string RolesText(ClaimsPrincipal u)
    {
        string roles = string.Join(",",
            Auth.Roles(u)
                .Select(role => role.ToLowerInvariant())
                .Distinct()
                .OrderBy(role => role));

        return roles.Length > 512 ? roles[..512] : roles;
    }

    private static async Task SetupAsync()
    {
        if (Initialized) return;

        await Gate.WaitAsync();

        try
        {
            if (Initialized) return;

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                CREATE TABLE IF NOT EXISTS koru_redis_users_v83
                (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    subject text NOT NULL UNIQUE,
                    username text NOT NULL,
                    department text NOT NULL,
                    roles text NOT NULL,
                    last_seen timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS koru_redis_user_permissions_v83
                (
                    user_id bigint NOT NULL REFERENCES
                        koru_redis_users_v83(id) ON DELETE CASCADE,
                    tool text NOT NULL CHECK
                        (tool IN ('monitor','streams','stream-write','acl')),
                    decision text NOT NULL CHECK
                        (decision IN ('allow','deny')),
                    updated_by text NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (user_id,tool)
                );

                CREATE TABLE IF NOT EXISTS koru_redis_user_audit_v83
                (
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    actor text NOT NULL,
                    target_username text NOT NULL,
                    department text NOT NULL,
                    tool text NOT NULL,
                    previous_decision text NOT NULL,
                    new_decision text NOT NULL,
                    changed_at timestamptz NOT NULL DEFAULT now()
                );
                """, c);

            await cmd.ExecuteNonQueryAsync();
            Initialized = true;
        }
        finally
        {
            Gate.Release();
        }
    }

    public static async Task<bool?> OverrideAsync(
        ClaimsPrincipal user, string department, string tool)
    {
        string? subject = Subject(user);
        if (string.IsNullOrWhiteSpace(subject))
            return null;

        await SetupAsync();

        await using var c =
            new NpgsqlConnection(ConnectionString());
        await c.OpenAsync();

        await using var cmd = new NpgsqlCommand(
            """
            SELECT p.decision
            FROM koru_redis_user_permissions_v83 p
            JOIN koru_redis_users_v83 u ON u.id=p.user_id
            WHERE u.subject=@subject
              AND u.department=@department
              AND p.tool=@tool
            """, c);

        cmd.Parameters.AddWithValue("subject", subject);
        cmd.Parameters.AddWithValue("department", department);
        cmd.Parameters.AddWithValue("tool", tool);

        object? result = await cmd.ExecuteScalarAsync();

        return result switch
        {
            "allow" => true,
            "deny" => false,
            _ => null
        };
    }

    public static void MapRedisUserAccessV83(
        this WebApplication app)
    {
        app.MapGet(
            "/api/v8/redis/users/self",
            RegisterSelf).RequireAuthorization();

        app.MapGet(
            "/api/v8/redis/users",
            ListUsers).RequireAuthorization();

        app.MapPut(
            "/api/v8/redis/users/{id:long}/permissions/{tool}",
            UpdatePermission).RequireAuthorization();
    }

    private static async Task<IResult> RegisterSelf(
        ClaimsPrincipal user)
    {
        string? subject = Subject(user);

        if (string.IsNullOrWhiteSpace(subject))
            return Results.BadRequest();

        try
        {
            await SetupAsync();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var cmd = new NpgsqlCommand(
                """
                INSERT INTO koru_redis_users_v83
                    (subject,username,department,roles)
                VALUES (@s,@u,@d,@r)
                ON CONFLICT (subject) DO UPDATE SET
                    username=excluded.username,
                    department=excluded.department,
                    roles=excluded.roles,
                    last_seen=now()
                WHERE koru_redis_users_v83.username
                        IS DISTINCT FROM excluded.username
                   OR koru_redis_users_v83.department
                        IS DISTINCT FROM excluded.department
                   OR koru_redis_users_v83.roles
                        IS DISTINCT FROM excluded.roles
                   OR koru_redis_users_v83.last_seen
                        < now() - interval '5 minutes'
                """, c);

            cmd.Parameters.AddWithValue("s", subject);
            cmd.Parameters.AddWithValue("u", Username(user));
            cmd.Parameters.AddWithValue("d", Department(user));
            cmd.Parameters.AddWithValue("r", RolesText(user));

            await cmd.ExecuteNonQueryAsync();

            return Results.Ok(new
            {
                registered = true,
                username = Username(user),
                department = Department(user)
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V83 SELF] " + ex.GetType().Name);

            return Results.Problem(
                "Kullanici kaydi basarisiz.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> ListUsers(
        ClaimsPrincipal user)
    {
        bool admin = Auth.Has(user, "admin");
        bool network = Auth.Has(user, "network");

        if (!admin && !network)
            return Results.Forbid();

        try
        {
            await SetupAsync();

            var users = new Dictionary<long, V83ManagedUser>();
            var audit = new List<object>();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT u.id,u.username,u.department,u.roles,
                       u.last_seen,p.tool,p.decision
                FROM koru_redis_users_v83 u
                LEFT JOIN koru_redis_user_permissions_v83 p
                    ON p.user_id=u.id
                WHERE @admin OR u.department='network'
                ORDER BY u.department,u.username
                """, c))
            {
                cmd.Parameters.AddWithValue("admin", admin);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    long id = reader.GetInt64(0);

                    if (!users.TryGetValue(id, out var item))
                    {
                        item = new V83ManagedUser
                        {
                            Id = id,
                            Username = reader.GetString(1),
                            Department = reader.GetString(2),
                            Roles = reader.GetString(3).Split(
                                ',', StringSplitOptions.RemoveEmptyEntries),
                            LastSeen = reader.GetDateTime(4)
                        };

                        users.Add(id, item);
                    }

                    if (!reader.IsDBNull(5))
                        item.Permissions[reader.GetString(5)] =
                            reader.GetString(6);
                }
            }

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT actor,target_username,department,
                       tool,previous_decision,new_decision,
                       changed_at
                FROM koru_redis_user_audit_v83
                WHERE @admin OR department='network'
                ORDER BY id DESC LIMIT 40
                """, c))
            {
                cmd.Parameters.AddWithValue("admin", admin);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    audit.Add(new
                    {
                        actor = reader.GetString(0),
                        username = reader.GetString(1),
                        department = reader.GetString(2),
                        tool = reader.GetString(3),
                        previous = reader.GetString(4),
                        current = reader.GetString(5),
                        changedAt = reader.GetDateTime(6)
                    });
                }
            }

            return Results.Ok(new
            {
                isAdmin = admin,
                users = users.Values.ToArray(),
                audit
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V83 USERS] " + ex.GetType().Name);

            return Results.Problem(
                "Kullanici envanteri okunamadi.",
                statusCode: 503);
        }
    }

    private static async Task<IResult> UpdatePermission(
        long id, string tool,
        V83PermissionInput input,
        ClaimsPrincipal user)
    {
        bool admin = Auth.Has(user, "admin");
        bool network = Auth.Has(user, "network");

        if (!admin && !network)
            return Results.Forbid();

        tool = tool.ToLowerInvariant();
        string decision = (input.Decision ?? "")
            .ToLowerInvariant();

        if (!Tools.Contains(tool) ||
            !new[] { "inherit", "allow", "deny" }
                .Contains(decision))
            return Results.BadRequest();

        try
        {
            await SetupAsync();

            await using var c =
                new NpgsqlConnection(ConnectionString());
            await c.OpenAsync();

            await using var tx =
                await c.BeginTransactionAsync();

            string username;
            string department;
            string roles;

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT username,department,roles
                FROM koru_redis_users_v83
                WHERE id=@id FOR UPDATE
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("id", id);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                    return Results.NotFound();

                username = reader.GetString(0);
                department = reader.GetString(1);
                roles = reader.GetString(2);
            }

            if (roles.Split(',').Contains("admin"))
                return Results.Forbid();

            if (!admin &&
                !(network &&
                  department == "network" &&
                  tool == "monitor"))
                return Results.Forbid();

            string previous;

            await using (var cmd = new NpgsqlCommand(
                """
                SELECT decision
                FROM koru_redis_user_permissions_v83
                WHERE user_id=@id AND tool=@tool
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("tool", tool);

                previous = await cmd.ExecuteScalarAsync()
                    as string ?? "inherit";
            }

            if (previous == decision)
            {
                await tx.CommitAsync();
                return Results.Ok(new {changed=false});
            }

            string actor = Username(user);

            if (decision == "inherit")
            {
                await using var cmd = new NpgsqlCommand(
                    """
                    DELETE FROM koru_redis_user_permissions_v83
                    WHERE user_id=@id AND tool=@tool
                    """, c, tx);

                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("tool", tool);
                await cmd.ExecuteNonQueryAsync();
            }
            else
            {
                await using var cmd = new NpgsqlCommand(
                    """
                    INSERT INTO koru_redis_user_permissions_v83
                        (user_id,tool,decision,updated_by)
                    VALUES (@id,@tool,@decision,@actor)
                    ON CONFLICT (user_id,tool) DO UPDATE SET
                        decision=excluded.decision,
                        updated_by=excluded.updated_by,
                        updated_at=now()
                    """, c, tx);

                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("tool", tool);
                cmd.Parameters.AddWithValue("decision", decision);
                cmd.Parameters.AddWithValue("actor", actor);
                await cmd.ExecuteNonQueryAsync();
            }

            await using (var cmd = new NpgsqlCommand(
                """
                INSERT INTO koru_redis_user_audit_v83
                    (actor,target_username,department,tool,
                     previous_decision,new_decision)
                VALUES (@actor,@username,@department,@tool,
                        @previous,@decision)
                """, c, tx))
            {
                cmd.Parameters.AddWithValue("actor", actor);
                cmd.Parameters.AddWithValue("username", username);
                cmd.Parameters.AddWithValue("department", department);
                cmd.Parameters.AddWithValue("tool", tool);
                cmd.Parameters.AddWithValue("previous", previous);
                cmd.Parameters.AddWithValue("decision", decision);
                await cmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return Results.Ok(new
            {
                changed = true,
                username,
                tool,
                decision
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "[V83 UPDATE] " + ex.GetType().Name);

            return Results.Problem(
                "Kullanici politikasi kaydedilemedi.",
                statusCode: 503);
        }
    }
}
