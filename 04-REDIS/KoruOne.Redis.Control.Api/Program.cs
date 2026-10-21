using System.Diagnostics;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority =
            Environment.GetEnvironmentVariable("OIDC_AUTHORITY")
            ?? "http://localhost:8081/realms/koru";

        options.Audience = "koru-control";
        options.RequireHttpsMetadata =
            !builder.Environment.IsDevelopment();

        options.TokenValidationParameters =
            new TokenValidationParameters
            {
                RoleClaimType = "roles"
            };
    });

builder.Services.AddAuthorization();


// KORU_V751_CONTROL_AUTH
builder.Services.PostConfigure<
    Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>(
    Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults
        .AuthenticationScheme,
    options =>
    {
        var authority = Environment.GetEnvironmentVariable(
            "OIDC_AUTHORITY");

        if (string.IsNullOrWhiteSpace(authority))
            throw new InvalidOperationException(
                "OIDC_AUTHORITY gerekli.");

        options.Authority = authority;

        options.MetadataAddress =
            Environment.GetEnvironmentVariable(
                "OIDC_METADATA_ADDRESS")
            ?? "http://127.0.0.1:8081/auth/realms/koru/.well-known/openid-configuration";

        options.BackchannelHttpHandler =
            new KoruOidcBackchannelHandler(authority);

        options.RequireHttpsMetadata =
            !builder.Environment.IsDevelopment();

        options.TokenValidationParameters.ValidateIssuer = true;
        options.TokenValidationParameters.ValidateAudience = true;
        options.TokenValidationParameters.ValidateLifetime = true;

        // Iki audience yalnizca gelistirme ortami icin.
        // Uretimde ayri koru-control audience zorunlu.
        options.TokenValidationParameters.ValidAudiences =
            builder.Environment.IsDevelopment()
                ? new[] { "koru-control", "koru-api" }
                : new[] { "koru-control" };

        options.Events ??=
            new Microsoft.AspNetCore.Authentication.JwtBearer
                .JwtBearerEvents();

        options.Events.OnAuthenticationFailed = context =>
        {
            Console.Error.WriteLine(
                "[REDIS JWT AUTH ERROR] " +
                context.Exception.GetType().Name + ": " +
                context.Exception.Message);

            return Task.CompletedTask;
        };
    });

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();

var nodes = new[]
{
    new RedisNode(
        "cache",
        "Redis Cache",
        "127.0.0.1",
        6379,
        "REDIS_CACHE_PASSWORD",
        "change-me-local-cache"
    ),
    new RedisNode(
        "streams",
        "Redis Streams",
        "127.0.0.1",
        6380,
        "REDIS_STREAMS_PASSWORD",
        "change-me-local-streams"
    )
};

app.MapGet("/health", () =>
    Results.Ok(new
    {
        status = "ok",
        service = "KoruOne Redis Control",
        version = "7.1"
    }));

var api = app.MapGroup("/api/redis")
    .RequireAuthorization();

api.MapGet("/nodes", async (ClaimsPrincipal user) =>
{
    if (!CanRead(user))
        return Results.Forbid();

    var results = await Task.WhenAll(
        nodes.Select(ReadMetrics));

    return Results.Ok(new
    {
        total = results.Length,
        connected = results.Count(x => x.Connected),
        nodes = results.Select(x => x.Data)
    });
});

api.MapGet("/nodes/{id}/metrics",
    async (string id, ClaimsPrincipal user) =>
{
    if (!CanRead(user))
        return Results.Forbid();

    var node = nodes.FirstOrDefault(
        x => x.Id.Equals(
            id,
            StringComparison.OrdinalIgnoreCase));

    if (node is null)
        return Results.NotFound();

    var metrics = await ReadMetrics(node);

    return metrics.Connected
        ? Results.Ok(metrics.Data)
        : Results.Json(metrics.Data, statusCode: 503);
});

api.MapGet("/info", async (ClaimsPrincipal user) =>
{
    if (!CanRead(user))
        return Results.Forbid();

    var result = await ReadMetrics(nodes[0]);

    return result.Connected
        ? Results.Ok(result.Data)
        : Results.Json(result.Data, statusCode: 503);
});

app.Run();

static bool CanRead(ClaimsPrincipal user)
{
    var allowed = new[]
    {
        "admin",
        "redis-viewer",
        "redis-operator"
    };

    return user.Claims
        .Where(c =>
            c.Type == "roles" ||
            c.Type == "role" ||
            c.Type == ClaimTypes.Role ||
            c.Type == "realm_access")
        .SelectMany(c =>
            c.Value.Replace("[", "")
                .Replace("]", "")
                .Replace("\"", "")
                .Split(new[] { ',', ' ', ':' },
                    StringSplitOptions.RemoveEmptyEntries))
        .Any(role => allowed.Contains(role,
            StringComparer.OrdinalIgnoreCase));
}

static async Task<RedisMetricsResult> ReadMetrics(RedisNode node)
{
    try
    {
        var config = new ConfigurationOptions
        {
            AbortOnConnectFail = false,
            ConnectTimeout = 3000,
            AsyncTimeout = 3000,
            ConnectRetry = 0,
            Password =
                Environment.GetEnvironmentVariable(
                    node.PasswordEnv)
                ?? node.DevPassword
        };

        config.EndPoints.Add(node.Host, node.Port);

        using var redis =
            await ConnectionMultiplexer.ConnectAsync(config);

        var db = redis.GetDatabase();
        var server = redis.GetServer(node.Host, node.Port);

        var watch = Stopwatch.StartNew();
        await db.PingAsync();
        watch.Stop();

        var info = (await server.InfoAsync())
            .SelectMany(section => section)
            .GroupBy(item => item.Key)
            .ToDictionary(
                group => group.Key,
                group => group.First().Value,
                StringComparer.OrdinalIgnoreCase);

        string Get(string key) =>
            info.TryGetValue(key, out var value)
                ? value
                : "unknown";

        long Num(string key) =>
            long.TryParse(Get(key), out var value)
                ? value
                : 0;

        var hits = Num("keyspace_hits");
        var misses = Num("keyspace_misses");

        return new RedisMetricsResult(true, new
        {
            id = node.Id,
            name = node.Name,
            connected = true,
            status = "healthy",
            version = Get("redis_version"),
            role = Get("role"),
            pingMs = Math.Round(
                watch.Elapsed.TotalMilliseconds, 2),
            memory = new
            {
                usedBytes = Num("used_memory"),
                usedHuman = Get("used_memory_human"),
                maxBytes = Num("maxmemory"),
                maxHuman = Get("maxmemory_human")
            },
            performance = new
            {
                opsPerSecond =
                    Num("instantaneous_ops_per_sec"),
                connectedClients =
                    Num("connected_clients"),
                keyspaceHits = hits,
                keyspaceMisses = misses,
                hitRatePercent = hits + misses == 0
                    ? (double?)null
                    : Math.Round(
                        100.0 * hits / (hits + misses), 2)
            },
            replication = new
            {
                role = Get("role"),
                connectedReplicas =
                    Num("connected_slaves"),
                linkStatus = Get("master_link_status")
            },
            keyspace = new
            {
                database0Keys =
                    await server.DatabaseSizeAsync(0)
            },
            timestamp = DateTimeOffset.UtcNow
        });
    }
    catch
    {
        return new RedisMetricsResult(false, new
        {
            id = node.Id,
            name = node.Name,
            connected = false,
            status = "unavailable"
        });
    }
}

record RedisNode(
    string Id,
    string Name,
    string Host,
    int Port,
    string PasswordEnv,
    string DevPassword
);


record RedisMetricsResult(
    bool Connected,
    object Data
);
