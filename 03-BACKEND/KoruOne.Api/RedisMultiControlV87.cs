using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Npgsql;
using StackExchange.Redis;

public sealed record V87Create(string Id, int Port, int MemoryMb);
public sealed record V87Login(string Username, string Password);
public sealed record V87Dept(string Department);
public sealed record V87Memory(int MemoryMb);
public sealed record V87Key(string Name);
public sealed record V87Set(string Name, string Value, int TtlSeconds);
public sealed record V87Remove(string Confirmation);
public sealed record V87Rotate(string Username);
public sealed record V87Node(string Id, int Port, int MemoryMb, string[] Departments);
public sealed record V87Session(string Subject, string Node, string Username, string Password, DateTime Expires);

public static class RedisMultiControlV87
{
    private static readonly ConcurrentDictionary<string,V87Session> Sessions = new();
    private static readonly ConcurrentDictionary<string,ConnectionMultiplexer> SessionConnections = new();
    private static readonly SemaphoreSlim AuditLock = new(1,1);
    private static bool AuditReady;
    private static readonly string[] DepartmentNames = ["hr", "marketing", "it", "network", "advertising", "redis"];
    private static string Db => Environment.GetEnvironmentVariable("DATABASE_URL")
        ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";
    private static string Home => Environment.GetEnvironmentVariable("KORU_REDIS_HOME")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local/share/koru-one/redis-managed");
    private static string Subject(ClaimsPrincipal u) => Auth.UserId(u);
    private static string Actor(ClaimsPrincipal u) => u.FindFirst("preferred_username")?.Value ?? u.Identity?.Name ?? Subject(u);
    private static bool Admin(ClaimsPrincipal u) => Auth.Has(u, "admin");
    private static bool Operator(ClaimsPrincipal u) =>
        Auth.Has(u,"redis-operator","redis");
    private static bool Viewer(ClaimsPrincipal u) =>
        Auth.Has(u,"redis-viewer","redis-observer");
    private static bool Allow(ClaimsPrincipal u,string dept) =>
        Admin(u) || Operator(u) ||
        (dept=="network" && Auth.Has(u,"network")) ||
        (dept=="it" && Auth.Has(u,"it"));
    private static bool MaySee(ClaimsPrincipal u, V87Node node) =>
        Admin(u) || Operator(u) || Viewer(u) ||
        node.Departments.Any(d=>Allow(u,d));
    private static bool LocalAdmin(WebApplication app) => app.Environment.IsDevelopment() && Environment.GetEnvironmentVariable("KORU_ALLOW_LOCAL_DOCKER_ADMIN") == "1";
    private static JsonDocument RegistryDocument() => JsonDocument.Parse(File.Exists(Path.Combine(Home, "registry.json"))
        ? File.ReadAllText(Path.Combine(Home,"registry.json")) : "{}");
    private static List<V87Node> Nodes()
    {
        using var doc = RegistryDocument();
        var result = new List<V87Node>();
        foreach (var pair in doc.RootElement.EnumerateObject())
        {
            var e = pair.Value;
            result.Add(new V87Node(pair.Name, e.GetProperty("port").GetInt32(),
                e.GetProperty("memoryMb").GetInt32(),
                e.GetProperty("departments").EnumerateArray().Select(x=>x.GetString() ?? "").ToArray()));
        }
        return result.OrderBy(x=>x.Port).ToList();
    }
    private static V87Node? Node(string id) => Nodes().FirstOrDefault(n=>n.Id == id);
    private static string? AdminPassword(string id)
    {
        var path=Path.Combine(Home,"secrets.json");
        if (!File.Exists(path)) return null;
        using var j = JsonDocument.Parse(File.ReadAllText(path));
        return j.RootElement.TryGetProperty(id,out var n) && n.TryGetProperty("koru_admin",out var p) ? p.GetString() : null;
    }
    private static ConfigurationOptions Config(V87Node node, string username, string password)
    {
        var o = new ConfigurationOptions
        {
            User = username, Password = password,
            AbortOnConnectFail = false, ConnectTimeout = 8000,
            AsyncTimeout = 8000, AllowAdmin = username == "koru_admin"
        };
        o.EndPoints.Add("127.0.0.1",node.Port);
        return o;
    }
    private static async Task<ConnectionMultiplexer> Connect(V87Node node,string username,string password) =>
        await ConnectionMultiplexer.ConnectAsync(Config(node,username,password));

    private static async Task EnsureAudit()
    {
        if (AuditReady) return;
        await AuditLock.WaitAsync();
        try
        {
            if (AuditReady) return;
            await using var c = new NpgsqlConnection(Db);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
                CREATE TABLE IF NOT EXISTS koru_redis_multi_audit_v87 (
                  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  at timestamptz NOT NULL DEFAULT now(),
                  actor text NOT NULL, subject text NOT NULL,
                  node text NOT NULL, department text NOT NULL,
                  action text NOT NULL, outcome text NOT NULL
                );
                CREATE INDEX IF NOT EXISTS koru_redis_multi_audit_v87_at
                  ON koru_redis_multi_audit_v87(at DESC);
                """,c);
            await cmd.ExecuteNonQueryAsync();
            AuditReady = true;
        }
        finally { AuditLock.Release(); }
    }
    private static async Task Audit(ClaimsPrincipal u,string node,string dept,string action,string outcome)
    {
        try
        {
            await EnsureAudit();
            await using var c = new NpgsqlConnection(Db);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
              INSERT INTO koru_redis_multi_audit_v87(actor,subject,node,department,action,outcome)
              VALUES(@a,@s,@n,@d,@o,@r)
              """,c);
            cmd.Parameters.AddWithValue("a", Actor(u));
            cmd.Parameters.AddWithValue("s", Subject(u));
            cmd.Parameters.AddWithValue("n", node);
            cmd.Parameters.AddWithValue("d", dept);
            cmd.Parameters.AddWithValue("o", action);
            cmd.Parameters.AddWithValue("r", outcome);
            await cmd.ExecuteNonQueryAsync();
        }
        catch(Exception e) { Console.Error.WriteLine("[V87 AUDIT] " + e.GetType().Name); }
    }
    private static bool SafeNode(string s) => Regex.IsMatch(s, @"^redis(0[1-9]|[1-9][0-9])$");
    private static bool SafeKey(string s) => !string.IsNullOrWhiteSpace(s) && s.Length <= 120 && Regex.IsMatch(s,@"^[a-zA-Z0-9:_./-]+$");
    private static bool GoodRole(ClaimsPrincipal user) =>
        Admin(user) || Operator(user) || Viewer(user) ||
        Auth.Has(user,"network","it");
    private static string Script(WebApplication app) => Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..","..","05-PLATFORM","redis-managed","koru_redisctl.py"));
    private static async Task<(bool ok,JsonElement result,string? error)> Control(WebApplication app, params string[] args)
    {
        if (!LocalAdmin(app)) return (false,default,"Local provisioning disabled. Set KORU_ALLOW_LOCAL_DOCKER_ADMIN=1 for development only.");
        var info = new ProcessStartInfo("python3") { RedirectStandardOutput=true, RedirectStandardError=true, UseShellExecute=false };
        info.ArgumentList.Add(Script(app));
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("python3 unavailable");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync(timeout.Token);
            string output = await stdout;
            _ = await stderr; // Never return unchecked stderr to frontend.
            using var doc = JsonDocument.Parse(output);
            bool ok = doc.RootElement.GetProperty("ok").GetBoolean() && process.ExitCode == 0;
            return ok
                ? (true, doc.RootElement.GetProperty("result").Clone(), null)
                : (false, default, doc.RootElement.GetProperty("error").GetString());
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree:true); } catch { }
            return (false,default,"Local Redis operation timed out");
        }
    }
    private static bool CanLogin(
        ClaimsPrincipal user,V87Node node,string username)
    {
        if (!GoodRole(user) || !MaySee(user,node))
            return false;

        if (string.IsNullOrWhiteSpace(username) ||
            !Regex.IsMatch(username,@"^[a-zA-Z0-9_-]{1,48}$"))
            return false;

        // Admin, Redis Operator ve Viewer:
        // Bu node'da gercekten tanimli ACL hesaplari.
        if (Admin(user) || Operator(user) || Viewer(user))
            return username=="koru_admin" ||
                node.Departments.Contains(username);

        // Departman rolleri farkli ACL hesaplarina gecemez.
        if (Auth.Has(user,"network") &&
            username=="network" &&
            node.Departments.Contains("network"))
            return true;

        if (Auth.Has(user,"it") &&
            username=="it" &&
            node.Departments.Contains("it"))
            return true;

        return false;
    }

    private static bool ReadOnly(ClaimsPrincipal user) =>
        Viewer(user) && !Admin(user) && !Operator(user);

    private static bool TrySession(
        HttpContext ctx, ClaimsPrincipal user,
        string id, out V87Session? result)
    {
        result=null;
        var token=ctx.Request.Headers[
            "X-Koru-Redis-Session"].ToString();

        if(string.IsNullOrWhiteSpace(token) ||
           !Sessions.TryGetValue(token,out var session))
            return false;

        if(session.Node!=id) return false;

        var node=Node(id);

        bool allowed=node!=null &&
            session.Expires>DateTime.UtcNow &&
            session.Subject==Subject(user) &&
            CanLogin(user,node,session.Username);

        string? current=null;

        if(allowed)
        {
            if(session.Username=="koru_admin")
                current=AdminPassword(id);
            else
            {
                var file=Path.Combine(Home,"secrets.json");
                if(File.Exists(file))
                {
                    using var doc=JsonDocument.Parse(
                        File.ReadAllText(file));

                    if(doc.RootElement.TryGetProperty(id,out var credentials) &&
                       credentials.TryGetProperty(
                           session.Username,out var value))
                        current=value.GetString();
                }
            }
        }

        if(current==null ||
           !CryptographicOperations.FixedTimeEquals(
             System.Text.Encoding.UTF8.GetBytes(current),
             System.Text.Encoding.UTF8.GetBytes(session.Password)))
            allowed=false;

        if(!allowed)
        {
            Sessions.TryRemove(token,out _);
            result=null;
            return false;
        }

        result=session;
        return true;
    }

    private static string? ScopedKey(string user,string name)
    {
        if(!SafeKey(name)) return null;

        if(user=="koru_admin")
            return name.StartsWith("koru:",StringComparison.Ordinal)
                ? name : "koru:redis:"+name;

        string prefix="koru:"+user+":";

        if(name.StartsWith("koru:",StringComparison.Ordinal))
            return name.StartsWith(prefix,StringComparison.Ordinal)
                ? name : null;

        return prefix+name;
    }

    public static void MapRedisMultiControlV87(this WebApplication app)
    {
        var group = app.MapGroup("/api/v8/redis/multi").RequireAuthorization();
        group.MapGet("/nodes",async (
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(!GoodRole(user)) return Results.Forbid();

            var entries=new List<object>();

            foreach(var node in Nodes().Where(n=>MaySee(user,n)))
            {
                if(!TrySession(ctx,user,node.Id,out _))
                {
                    entries.Add(new {
                        id=node.Id,unlocked=false,
                        port=0,memoryMb=0,
                        departments=Admin(user)
                            ? node.Departments
                            : Array.Empty<string>(),
                        connected=false,usedBytes=0L,
                        keyCount=0L,hits=0L,misses=0L
                    });
                    continue;
                }

                bool connected=false;
                long used=0,keys=0,hits=0,misses=0;

                try
                {
                    using var conn=await Connect(
                        node,"koru_admin",AdminPassword(node.Id)!);

                    var server=conn.GetServer(
                        "127.0.0.1",node.Port);

                    var info=(await server.InfoAsync())
                        .SelectMany(x=>x)
                        .GroupBy(x=>x.Key)
                        .ToDictionary(
                            x=>x.Key,x=>x.Last().Value);

                    long M(string k) =>
                        info.TryGetValue(k,out var v) &&
                        long.TryParse(v,out var n) ? n : 0;

                    used=M("used_memory");
                    hits=M("keyspace_hits");
                    misses=M("keyspace_misses");
                    keys=await server.DatabaseSizeAsync(0);
                    connected=true;
                }
                catch(Exception ex)
                {
                    Console.Error.WriteLine(
                        "[V88 NODE] "+node.Id+" "+
                        ex.GetType().Name);
                }

                entries.Add(new {
                    id=node.Id,unlocked=true,
                    port=node.Port,memoryMb=node.MemoryMb,
                    departments=node.Departments,
                    connected,usedBytes=used,
                    keyCount=keys,hits,misses
                });
            }

            return Results.Ok(new {
                nodes=entries,
                canProvision=Admin(user)&&LocalAdmin(app),
                measuredAt=DateTime.UtcNow
            });
        });
        group.MapGet("/audit",async (ClaimsPrincipal u) =>
        {
            if (!Admin(u)) return Results.Forbid();
            await EnsureAudit();
            await using var c=new NpgsqlConnection(Db); await c.OpenAsync();
            await using var cmd=new NpgsqlCommand("SELECT at,actor,node,department,action,outcome FROM koru_redis_multi_audit_v87 ORDER BY id DESC LIMIT 75",c);
            await using var reader=await cmd.ExecuteReaderAsync();
            var a=new List<object>();
            while(await reader.ReadAsync()) a.Add(new {at=reader.GetDateTime(0),actor=reader.GetString(1),node=reader.GetString(2),department=reader.GetString(3),action=reader.GetString(4),outcome=reader.GetString(5)});
            return Results.Ok(a);
        });
        group.MapPost("/nodes/{id}/login",async (
            string id,V87Login input,ClaimsPrincipal user) =>
        {
            var node=Node(id);

            bool eligible=node!=null &&
                CanLogin(user,node,input.Username);

            if(!eligible ||
               string.IsNullOrWhiteSpace(input.Password) ||
               input.Password.Length>200)
            {
                await Audit(
                    user,id,input.Username,"login","denied");
                return Results.Forbid();
            }

            try
            {
                using var conn=await Connect(
                    node!,input.Username,input.Password);

                await conn.GetDatabase().PingAsync();

                var session=Convert.ToHexString(
                    RandomNumberGenerator.GetBytes(32));

                Sessions[session]=new V87Session(
                    Subject(user),id,
                    input.Username,input.Password,
                    DateTime.UtcNow.AddMinutes(10));

                await Audit(
                    user,id,input.Username,"login","success");

                return Results.Ok(new {
                    session,
                    department=input.Username,
                    expiresInSeconds=600
                });
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V88 LOGIN] "+ex.GetType().Name);

                await Audit(
                    user,id,input.Username,"login","failed");

                return Results.Json(new {
                    message="Redis ACL kullanıcı adı veya şifresi hatalı"
                },statusCode:401);
            }
        });
        group.MapGet("/nodes/{id}/keys",async (string id,ClaimsPrincipal u,HttpContext ctx) =>
        {
            if(!TrySession(ctx,u,id,out var session)) return Results.Unauthorized();
            var n=Node(id)!;
            string prefix=session!.Username=="koru_admin" ? "koru:*" : $"koru:{session.Username}:*";
            try
            {
                // Listing uses controlled admin connection; credentials are never returned.
                using var conn=await Connect(n,"koru_admin",AdminPassword(id)!);
                var s=conn.GetServer("127.0.0.1",n.Port);
                var keys=s.Keys(database:0,pattern:prefix,pageSize:50).Take(60).Select(x=>x.ToString()).ToArray();
                await Audit(u,id,session.Username,"keys.list","success");
                return Results.Ok(new { keys, limit=60 });
            }
            catch { return Results.Problem("Key listing unavailable",statusCode:503); }
        });
        // Redis key islemleri yalnizca dogrulanmis ACL oturumu
        // ve yetkili namespace uzerinden calisir.
        group.MapPost("/nodes/{id}/key/meta",async (
            string id,V87Key input,
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            var key=ScopedKey(session!.Username,input.Name);

            if(key==null)
                return Results.BadRequest(new {
                    message="Key namespace denied"
                });

            try
            {
                using var connection=await Connect(
                    Node(id)!,"koru_admin",AdminPassword(id)!);

                var db=connection.GetDatabase();
                var exists=await db.KeyExistsAsync(key);

                if(!exists)
                    return Results.Ok(new {
                        exists=false,
                        type="NONE",
                        ttlSeconds=(long?)null,
                        persistent=false
                    });

                var type=await db.KeyTypeAsync(key);
                var ttl=await db.KeyTimeToLiveAsync(key);

                await Audit(user,id,session.Username,
                    "key.inspect","success");

                return Results.Ok(new {
                    exists=true,
                    type=type.ToString().ToUpperInvariant(),
                    ttlSeconds=ttl.HasValue
                        ? (long?)Math.Ceiling(ttl.Value.TotalSeconds)
                        : null,
                    persistent=!ttl.HasValue
                });
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V892 META] "+ex.GetType().Name);
                return Results.Problem(
                    "Key metadata unavailable",
                    statusCode:503);
            }
        });

        group.MapPost("/nodes/{id}/key/read",async (
            string id,V87Key input,
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            string? key=ScopedKey(
                session!.Username,input.Name);

            if(key==null)
                return Results.BadRequest(
                    new {message="Key namespace denied"});

            try
            {
                using var conn=await Connect(
                    Node(id)!,"koru_admin",AdminPassword(id)!);

                var value=await conn.GetDatabase()
                    .StringGetAsync(key);

                await Audit(
                    user,id,session.Username,"key.read",
                    value.HasValue?"success":"not-found");

                return Results.Ok(new {
                    key,exists=value.HasValue,
                    value=value.HasValue?value.ToString():null
                });
            }
            catch(RedisServerException ex)
                when(ex.Message.StartsWith("WRONGTYPE"))
            {
                return Results.BadRequest(
                    new {message="Key tipi STRING degil"});
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V88 READ] "+ex.GetType().Name);
                return Results.Problem(
                    "Redis read unavailable",statusCode:503);
            }
        });

        // KORU_V895_DEPARTMENT_QUOTA
        // KORU_V896_STRICT_ACL_STORAGE_SCOPE
        group.MapGet("/nodes/{id}/department-capacity",async (
            string id,ClaimsPrincipal user,HttpContext ctx) =>
        {
            var node=Node(id);

            if(node==null)
                return Results.NotFound();

            if(!MaySee(user,node))
                return Results.Forbid();

            // Keycloak admin olmak, baska ACL hesaplarinin
            // storage verilerini gorme yetkisi vermez.
            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            var account=session!.Username;

            // Mevcut koru_admin key'leri varsayilan olarak
            // koru:redis:* namespace'inde tutuluyor.
            var measureDept=account=="koru_admin"
                ? "redis" : account;

            try
            {
                using var conn=await Connect(
                    node,"koru_admin",AdminPassword(id)!);

                var db=conn.GetDatabase();
                var server=conn.GetServer(
                    "127.0.0.1",node.Port);

                var measurement=await RedisDeptQuotaV895
                    .MeasureAsync(db,server,measureDept);

                // Admin'in ozel departman kotasi yok.
                // Diger ACL hesaplari yalnizca kendi kotalarini gorur.
                var accountQuota=account=="koru_admin"
                    ? 0
                    : RedisDeptQuotaV895.Quota(id,account);

                return Results.Ok(new {
                    node=id,
                    account,
                    memoryMb=node.MemoryMb,
                    assignedMb=accountQuota,
                    departments=new[] {
                        new {
                            department=account,
                            quotaMb=accountQuota,
                            usedBytes=measurement.Used,
                            sampledKeys=measurement.Keys,
                            complete=measurement.Complete
                        }
                    }
                });
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V896 STORAGE] "+ex.GetType().Name);

                return Results.Problem(
                    "Account storage measurement unavailable",
                    statusCode:503);
            }
        });

        group.MapPut(
            "/nodes/{id}/department-capacity/{department}",
            async (string id,string department,
                V87Memory input,ClaimsPrincipal user) =>
        {
            if(!Admin(user))return Results.Forbid();

            var node=Node(id);

            if(node==null ||
               !node.Departments.Contains(department))
                return Results.BadRequest(new {
                    message="Redis veya departman atamasi bulunamadi"
                });

            var error=await RedisDeptQuotaV895.SaveAsync(
                id,department,input.MemoryMb,
                node.MemoryMb,node.Departments);

            if(error!=null)
                return Results.BadRequest(new {message=error});

            await Audit(user,id,department,
                "department.quota.update","success");

            return Results.Ok(new {
                updated=true,department,
                quotaMb=input.MemoryMb
            });
        });

        group.MapPost("/nodes/{id}/key/set",async (
            string id,V87Set input,
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(ReadOnly(user)) return Results.Forbid();
            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            string? key=ScopedKey(
                session!.Username,input.Name);

            if(key==null ||
               input.Value==null ||
               input.Value.Length>4096 ||
               input.TtlSeconds<0 ||
               input.TtlSeconds>86400)
                return Results.BadRequest(new {
                    message="Invalid key, TTL or value"
                });

            try
            {
                using var conn=await Connect(
                    Node(id)!,"koru_admin",AdminPassword(id)!);

                var server=conn.GetServer(
                    "127.0.0.1",Node(id)!.Port);

                var written=await RedisDeptQuotaV895.WriteAsync(
                    id,key,input.Value,input.TtlSeconds,
                    conn.GetDatabase(),server);

                if(!written)
                {
                    await Audit(user,id,session.Username,
                        "key.set","quota-exceeded");

                    return Results.Conflict(new {
                        message="Departman RAM kotasi asiliyor."
                    });
                }

                await Audit(
                    user,id,session.Username,"key.set","success");

                return Results.Ok(new {
                    written=true,key
                });
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V88 WRITE] "+ex.GetType().Name);

                await Audit(
                    user,id,session.Username,"key.set","failed");

                return Results.Problem(
                    "Redis write unavailable",statusCode:503);
            }
        });

        group.MapPost("/nodes/{id}/key/delete",async (
            string id,V87Key input,
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(ReadOnly(user)) return Results.Forbid();
            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            string? key=ScopedKey(
                session!.Username,input.Name);

            if(key==null)
                return Results.BadRequest(new {
                    message="Key namespace denied"
                });

            try
            {
                using var conn=await Connect(
                    Node(id)!,"koru_admin",AdminPassword(id)!);

                bool removed=await conn.GetDatabase()
                    .KeyDeleteAsync(key);

                await Audit(
                    user,id,session.Username,"key.delete",
                    removed?"success":"not-found");

                return Results.Ok(new {removed});
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V88 DELETE] "+ex.GetType().Name);

                await Audit(
                    user,id,session.Username,"key.delete","failed");

                return Results.Problem(
                    "Redis delete unavailable",statusCode:503);
            }
        });
        group.MapPost("/nodes/{id}/key/persist",async (
            string id,V87Key input,
            ClaimsPrincipal user,HttpContext ctx) =>
        {
            if(ReadOnly(user)) return Results.Forbid();

            if(!TrySession(ctx,user,id,out var session))
                return Results.Unauthorized();

            string? key=ScopedKey(
                session!.Username,input.Name);

            if(key==null)
                return Results.BadRequest(
                    new {message="Key namespace denied"});

            try
            {
                using var conn=await Connect(
                    Node(id)!,"koru_admin",AdminPassword(id)!);

                var db=conn.GetDatabase();
                bool exists=await db.KeyExistsAsync(key);
                if(!exists)
                    return Results.NotFound(
                        new {message="Key bulunamadi veya suresi doldu"});

                bool changed=await db.KeyPersistAsync(key);

                await Audit(
                    user,id,session.Username,"key.persist",
                    changed?"success":"already-persistent");

                return Results.Ok(new {
                    key,
                    persistent=true,
                    changed
                });
            }
            catch(Exception ex)
            {
                Console.Error.WriteLine(
                    "[V891 PERSIST] "+ex.GetType().Name);
                return Results.Problem(
                    "Redis persist unavailable",statusCode:503);
            }
        });

        group.MapPost("/nodes",async (V87Create input,ClaimsPrincipal u) =>
        {
            if (!Admin(u)) return Results.Forbid();
            if(!SafeNode(input.Id) || input.Port <3001 || input.Port>3099 || input.MemoryMb<32 || input.MemoryMb>16384) return Results.BadRequest();
            var r=await Control(app,"create",input.Id,input.Port.ToString(CultureInfo.InvariantCulture),input.MemoryMb.ToString(CultureInfo.InvariantCulture));
            await Audit(u,input.Id,"-","node.create",r.ok?"success":"failed");
            return r.ok ? Results.Ok(r.result) : Results.BadRequest(new {message=r.error});
        });
        group.MapPost("/nodes/{id}/assign",async (string id,V87Dept input,ClaimsPrincipal u) =>
        {
            if(!Admin(u)) return Results.Forbid();
            if(!SafeNode(id)||!DepartmentNames.Contains(input.Department))return Results.BadRequest();
            var r=await Control(app,"assign",id,input.Department);
            await Audit(u,id,input.Department,"department.assign",r.ok?"success":"failed");
            return r.ok?Results.Ok(r.result):Results.BadRequest(new {message=r.error});
        });
        group.MapPost("/nodes/{id}/unassign",async (string id,V87Dept input,ClaimsPrincipal u) =>
        {
            if(!Admin(u)) return Results.Forbid();
            if(!SafeNode(id)||!DepartmentNames.Contains(input.Department))return Results.BadRequest();
            var r=await Control(app,"unassign",id,input.Department);
            await Audit(u,id,input.Department,"department.unassign",r.ok?"success":"failed");
            return r.ok?Results.Ok(r.result):Results.BadRequest(new {message=r.error});
        });
        group.MapPost("/nodes/{id}/rotate",async (string id,V87Rotate input,ClaimsPrincipal u) =>
        {
            if(!Admin(u)) return Results.Forbid();
            if(!SafeNode(id)|| !(input.Username=="koru_admin"||DepartmentNames.Contains(input.Username)))return Results.BadRequest();
            var r=await Control(app,"rotate",id,input.Username);
            await Audit(u,id,input.Username,"password.rotate",r.ok?"success":"failed");
            return r.ok?Results.Ok(r.result):Results.BadRequest(new {message=r.error});
        });
        group.MapPost("/nodes/{id}/resize",async (string id,V87Memory input,ClaimsPrincipal u) =>
        {
            if(!Admin(u))return Results.Forbid();
            if(!SafeNode(id)||input.MemoryMb<32||input.MemoryMb>16384)return Results.BadRequest();
            var resizeNode=Node(id);
            if(resizeNode==null)return Results.NotFound();

            if(RedisDeptQuotaV895.Allocated(
                id,resizeNode.Departments)>input.MemoryMb)
                return Results.BadRequest(new {
                    message="Once departman kotalarini azaltin."
                });

            var r=await Control(app,"resize",id,input.MemoryMb.ToString(CultureInfo.InvariantCulture));
            await Audit(u,id,"-","node.resize",r.ok?"success":"failed");
            return r.ok?Results.Ok(r.result):Results.BadRequest(new {message=r.error});
        });
        group.MapPost("/nodes/{id}/delete",async (string id,V87Remove input,ClaimsPrincipal u) =>
        {
            if(!Admin(u))return Results.Forbid();
            if(!SafeNode(id)||input.Confirmation!="DELETE "+id)return Results.BadRequest();
            var r=await Control(app,"delete",id,input.Confirmation);
            await Audit(u,id,"-","node.delete",r.ok?"success":"failed");
            return r.ok?Results.Ok(r.result):Results.BadRequest(new {message=r.error});
        });
    }
}
