using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
var b=WebApplication.CreateBuilder(args);
b.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o=>{o.Authority=Environment.GetEnvironmentVariable("OIDC_AUTHORITY")??"http://localhost:8081/realms/koru";o.Audience="koru-control";o.RequireHttpsMetadata=!b.Environment.IsDevelopment();o.TokenValidationParameters=new TokenValidationParameters{RoleClaimType="roles"};});b.Services.AddAuthorization();
var app=b.Build();app.UseAuthentication();app.UseAuthorization();app.MapGet("/health",()=>Results.Ok(new{status="ok"}));
app.MapGet("/api/redis/info",async (ClaimsPrincipal u)=>{if(!u.Claims.Any(c=>(c.Type=="roles"||c.Type=="role"||c.Type==ClaimTypes.Role)&&new[]{"redis-viewer","redis-operator","admin"}.Contains(c.Value)))return Results.Forbid();var address=Environment.GetEnvironmentVariable("REDIS_URL")??"localhost:6379,password=change-me-local-cache";try{using var c=await ConnectionMultiplexer.ConnectAsync(address);var db=c.GetDatabase();var sw=System.Diagnostics.Stopwatch.StartNew();await db.PingAsync();return Results.Ok(new{connected=true,pingMs=sw.Elapsed.TotalMilliseconds,endpoint="redis-cache",operations="read-only; privileged workflows disabled"});}catch{return Results.Json(new{connected=false},statusCode:503);}}).RequireAuthorization();
app.Run();
