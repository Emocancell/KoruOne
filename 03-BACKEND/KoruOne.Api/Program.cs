using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);
var pg = Environment.GetEnvironmentVariable("DATABASE_URL") ?? "Host=localhost;Port=5432;Database=koruone;Username=koruone;Password=change-me-local-only";
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(pg));
builder.Services.AddCors(o => o.AddPolicy("web", p => p.WithOrigins(Environment.GetEnvironmentVariable("WEB_ORIGIN") ?? "http://localhost:3000").AllowAnyHeader().AllowAnyMethod()));
var authority = Environment.GetEnvironmentVariable("OIDC_AUTHORITY") ?? "http://localhost:8081/realms/koru";
var audience = Environment.GetEnvironmentVariable("OIDC_AUDIENCE") ?? "koru-api";
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o => { o.Authority = authority; o.Audience = audience; o.MetadataAddress = Environment.GetEnvironmentVariable("OIDC_METADATA_ADDRESS") ?? "http://127.0.0.1:8081/auth/realms/koru/.well-known/openid-configuration"; o.RequireHttpsMetadata = !builder.Environment.IsDevelopment(); o.BackchannelHttpHandler = new KoruOidcBackchannelHandler(authority); o.TokenValidationParameters = new TokenValidationParameters { ValidateAudience = true, RoleClaimType = "roles" }; });
builder.Services.AddAuthorization();
builder.Services.AddSingleton<RedisConnection>(_ => new RedisConnection(Environment.GetEnvironmentVariable("REDIS_URL") ?? "localhost:6379,password=change-me-local-cache,abortConnect=false"));
builder.Services.AddV6StoreRateLimit();
var app = builder.Build();
app.UseRouting();
app.UseRateLimiter();
app.UseCors("web");app.UseAuthentication();app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new { status = "ok", app = "KORU ONE" }));
var api = app.MapGroup("/api").RequireAuthorization();
api.MapGet("/me", (ClaimsPrincipal u) => Results.Ok(new { name = u.Identity?.Name ?? u.FindFirstValue("preferred_username"), roles = Auth.Roles(u) }));
api.MapGet("/dashboard", V5Visibility.Dashboard);
api.MapGet("/departments", async (AppDb db) => Results.Ok(await db.Departments.AsNoTracking().ToListAsync()));
api.MapPost("/departments", async (AppDb db, RedisConnection redis, ClaimsPrincipal u, DepartmentInput input) => {
 if(!Auth.Has(u,"admin","network")) return Results.Forbid();if(string.IsNullOrWhiteSpace(input.Name))return Results.BadRequest();
 var entity=new Department{Name=input.Name.Trim()};db.Departments.Add(entity);await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Created($"/api/departments/{entity.Id}",entity);
});
api.MapGet("/tickets", V5Visibility.Tickets);

api.MapGet("/tickets/mine", async (
    AppDb db, ClaimsPrincipal user) =>
{
    var userId = Auth.UserId(user);

    return Results.Ok(await db.Tickets
        .AsNoTracking()
        .Where(t => t.CreatedBy == userId)
        .OrderByDescending(t => t.Id)
        .Take(200)
        .Select(t => new {
            t.Id,
            t.Title,
            t.Department,
            t.Status
        })
        .ToListAsync());
});

api.MapPost("/tickets",async (AppDb db,RedisConnection redis,ClaimsPrincipal u,TicketInput input)=>{
 if(string.IsNullOrWhiteSpace(input.Title))return Results.BadRequest();var entity=new Ticket{Title=input.Title.Trim(),Department=input.Department,CreatedBy=Auth.UserId(u),Status="open"};db.Tickets.Add(entity);await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Created($"/api/tickets/{entity.Id}",entity);
});
api.MapGet("/employees", async (AppDb db, ClaimsPrincipal u) =>
{
    if (!Auth.Has(u, "hr", "admin"))
        return Results.Forbid();

    return Results.Ok(await db.Employees.AsNoTracking()
        .Select(e => new { e.Id, e.Name, e.Department })
        .ToListAsync());
});
api.MapGet("/hr/salaries",async (AppDb db,ClaimsPrincipal u)=> Auth.Has(u,"admin","hr")?Results.Ok(await db.Employees.AsNoTracking().ToListAsync()):Results.Forbid());
api.MapPut("/hr/salaries/{id:int}",async (int id,SalaryInput input,AppDb db,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"hr"))return Results.Forbid();if(input.Amount<0)return Results.BadRequest();var e=await db.Employees.FindAsync(id);if(e==null)return Results.NotFound();e.Salary=input.Amount;db.Audits.Add(new Audit{Actor=u.Identity?.Name??"hr",Action="salary.change",Target=$"employee:{id}",Details=$"changed; old/new values redacted"});await db.SaveChangesAsync();return Results.Ok(new {id,updated=true});
});
api.MapGet("/products",async (AppDb db)=>Results.Ok(await db.Products.AsNoTracking().ToListAsync()));
api.MapPost("/products",async (ProductInput input,AppDb db,RedisConnection redis,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"marketing","admin"))return Results.Forbid();if(input.Price<0||string.IsNullOrWhiteSpace(input.Name))return Results.BadRequest();var e=new Product{Name=input.Name,Price=input.Price};db.Products.Add(e);await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Created($"/api/products/{e.Id}",e);
});
api.MapPut("/products/{id:int}/price",async (int id,PriceInput input,AppDb db,RedisConnection redis,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"marketing","admin"))return Results.Forbid();if(input.Price<0)return Results.BadRequest();var e=await db.Products.FindAsync(id);if(e==null)return Results.NotFound();e.Price=input.Price;db.Audits.Add(new Audit{Actor=u.Identity?.Name??"marketing",Action="product.price",Target=$"product:{id}",Details="price updated"});await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Ok(e);
});
api.MapGet("/advertisements",async (AppDb db)=>Results.Ok(await db.Advertisements.AsNoTracking().Where(a=>a.Published).ToListAsync()));
api.MapPost("/advertisements",async (AdInput input,AppDb db,RedisConnection redis,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"advertising","admin"))return Results.Forbid();var e=new Advertisement{Title=input.Title,Content=input.Content,Published=false};db.Advertisements.Add(e);await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Created($"/api/advertisements/{e.Id}",e);
});
api.MapPut("/advertisements/{id:int}/publish",async (int id,AppDb db,RedisConnection redis,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"advertising","admin"))return Results.Forbid();var e=await db.Advertisements.FindAsync(id);if(e==null)return Results.NotFound();e.Published=true;await db.SaveChangesAsync();await Cache.Clear(redis);return Results.Ok(e);
});
api.MapGet("/reports/tickets.csv",async (AppDb db,ClaimsPrincipal u)=>{
 if(!Auth.Has(u,"admin","it","network"))return Results.Forbid();var items=await db.Tickets.AsNoTracking().OrderByDescending(t=>t.Id).Take(10000).ToListAsync();static string Q(string? s)=>"\""+(s??"").Replace("\"","\"\"").Replace("\r"," ").Replace("\n"," ")+"\"";var csv="Id,Title,Department,Status\r\n"+string.Join("\r\n",items.Select(x=>$"{x.Id},{Q(x.Title)},{Q(x.Department)},{Q(x.Status)}"));return Results.File(System.Text.Encoding.UTF8.GetBytes("\uFEFF"+csv),"text/csv","tickets.csv");
});
app.MapHrModule();
api.MapEnterprise();
app.MapStockModule();

app.MapGet("/api/v5/analytics", V5Visibility.Analytics)
   .RequireAuthorization();

app.MapGet("/api/v5/reports/tickets.csv", V5Visibility.TicketsCsv)
   .RequireAuthorization();

app.MapGet("/api/v5/redis/metrics", V5Visibility.RedisMetrics)
   .RequireAuthorization();

app.MapRedisFleetReadOnly();
app.MapV6Store();
app.MapV6CommerceOps();
app.MapRedisDiagnostics();
app.MapRedisV78();
app.MapRedisAclProV79();
app.Run();

record DepartmentInput(string Name);record TicketInput(string Title,string Department);record StatusInput(string Status);record SalaryInput(decimal Amount);record ProductInput(string Name,decimal Price);record PriceInput(decimal Price);record AdInput(string Title,string Content);
static class Auth {public static string UserId(ClaimsPrincipal u)=>u.FindFirstValue("sub")??u.Identity?.Name??"unknown"; public static string[] Roles(ClaimsPrincipal u)=>u.Claims.Where(c=>c.Type=="roles"||c.Type==ClaimTypes.Role||c.Type=="role").Select(c=>c.Value).ToArray();public static bool Has(ClaimsPrincipal u,params string[] roles)=>Roles(u).Any(x=>roles.Contains(x,StringComparer.OrdinalIgnoreCase));}
static class Cache {public static async Task Clear(RedisConnection r){try{if(r.Client?.IsConnected==true)await r.Client!.GetDatabase().KeyDeleteAsync(new RedisKey[]{"koru:dashboard:summary:admin","koru:dashboard:summary:hr","koru:dashboard:summary:general","koru:v6:catalog:public"});}catch{}}}
class AppDb(DbContextOptions<AppDb> options):DbContext(options){public DbSet<Department> Departments=>Set<Department>();public DbSet<Employee> Employees=>Set<Employee>();public DbSet<Ticket> Tickets=>Set<Ticket>();public DbSet<Product> Products=>Set<Product>();public DbSet<ProductSale> ProductSales=>Set<ProductSale>();public DbSet<Advertisement> Advertisements=>Set<Advertisement>();public DbSet<Audit> Audits=>Set<Audit>();public DbSet<TicketEvent> TicketEvents=>Set<TicketEvent>();public DbSet<TicketNotice> TicketNotices=>Set<TicketNotice>();

    public DbSet<PurchaseRequest> PurchaseRequests
        => Set<PurchaseRequest>();

}
class Department {public int Id{get;set;}public string Name{get;set;}="";}
class Employee {public int Id{get;set;}public string Name{get;set;}="";public string Department{get;set;}="";public decimal Salary{get;set;}}
class Ticket {public int Id{get;set;}public string Title{get;set;}="";public string Department{get;set;}="";public string CreatedBy{get;set;}="";public string Status{get;set;}="open";}
class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Price { get; set; }
    public decimal DiscountPercent { get; set; }
    public int Stock { get; set; }
    public int SoldCount { get; set; }


    public int ReservedCount { get; set; }
    public bool IsPublished { get; set; } = true;

}
class Advertisement {public int Id{get;set;}public string Title{get;set;}="";public string Content{get;set;}="";public bool Published{get;set;}}
class Audit {public int Id{get;set;}public string Actor{get;set;}="";public string Action{get;set;}="";public string Target{get;set;}="";public string Details{get;set;}="";public DateTime CreatedAt{get;set;}=DateTime.UtcNow;}

sealed class RedisConnection : IDisposable { public IConnectionMultiplexer? Client {get;} public RedisConnection(string connection){try{Client=ConnectionMultiplexer.Connect(connection);}catch(Exception ex){Console.Error.WriteLine($"Redis temporarily unavailable: {ex.GetType().Name}");}} public void Dispose()=>Client?.Dispose();}
