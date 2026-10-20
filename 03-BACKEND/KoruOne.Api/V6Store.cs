using System.Security.Claims;
using System.Net.Mail;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;

public class PurchaseRequest
{
    public int Id { get; set; }
    public Guid RequestKey { get; set; }
    public int ProductId { get; set; }
    public string Kind { get; set; } = "purchase";
    public int Quantity { get; set; }
    public string BuyerName { get; set; } = "";
    public string BuyerEmail { get; set; } = "";
    public decimal? ProposedUnitPrice { get; set; }
    public decimal PriceAtRequest { get; set; }
    public string Status { get; set; } = "pending";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ResolvedAt { get; set; }
    public string ResolvedBy { get; set; } = "";
}

public record V6StoreRequest(
    Guid RequestKey,
    int ProductId,
    string Kind,
    int Quantity,
    string BuyerName,
    string BuyerEmail,
    decimal? ProposedUnitPrice
);

internal static class V6Store
{
    internal const string CatalogKey = "koru:v6:catalog:public";

    internal static IServiceCollection AddV6StoreRateLimit(
        this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = 429;

            options.AddPolicy("v6-store-public", context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    context.Connection.RemoteIpAddress?.ToString()
                        ?? "unknown",
                    _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 8,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    }
                )
            );
        });

        return services;
    }

    internal static async Task Invalidate(RedisConnection redis)
    {
        try
        {
            if (redis.Client?.IsConnected == true)
            {
                await redis.Client.GetDatabase()
                    .KeyDeleteAsync(CatalogKey);
            }
        }
        catch
        {
            // PostgreSQL kaynak sistemdir.
        }
    }

    internal static void MapV6Store(this WebApplication app)
    {
        var store = app.MapGroup("/api/v6/store");

        // Giriş yapmamış ziyaretçiler de ürünleri görebilir.
        store.MapGet("/products", async Task<IResult> (
            AppDb db, RedisConnection redis) =>
        {
            try
            {
                if (redis.Client?.IsConnected == true)
                {
                    var cached = await redis.Client.GetDatabase()
                        .StringGetAsync(CatalogKey);

                    if (cached.HasValue)
                    {
                        return Results.Content(
                            cached.ToString(),
                            "application/json");
                    }
                }
            }
            catch { }

            var products = await db.Products
                .AsNoTracking()
                .Where(p =>
                    p.IsPublished &&
                    p.Stock > p.ReservedCount)
                .OrderByDescending(p => p.Id)
                .Take(100)
                .Select(p => new
                {
                    id = p.Id,
                    name = p.Name,
                    price = p.Price,
                    discountPercent = p.DiscountPercent,
                    available = p.Stock - p.ReservedCount,
                    salePrice = p.Price *
                        (1m - p.DiscountPercent / 100m),
                    status = "Satışta"
                })
                .ToListAsync();

            var json = JsonSerializer.Serialize(products);

            try
            {
                if (redis.Client?.IsConnected == true)
                {
                    await redis.Client.GetDatabase()
                        .StringSetAsync(
                            CatalogKey,
                            json,
                            TimeSpan.FromSeconds(10));
                }
            }
            catch { }

            return Results.Content(json, "application/json");
        }).AllowAnonymous();

        // Satın alma veya teklif oluşturma.
        store.MapPost("/requests", async Task<IResult> (
            V6StoreRequest input,
            AppDb db,
            RedisConnection redis) =>
        {
            var kind = input.Kind?.Trim().ToLowerInvariant();
            var name = input.BuyerName?.Trim() ?? "";
            var email = input.BuyerEmail?.Trim() ?? "";

            if (
                input.RequestKey == Guid.Empty ||
                input.ProductId < 1 ||
                input.Quantity is < 1 or > 100 ||
                kind is not ("purchase" or "offer") ||
                name.Length is < 2 or > 100 ||
                email.Length is < 5 or > 254 ||
                !MailAddress.TryCreate(email, out _) ||
                (
                    kind == "offer" &&
                    (
                        input.ProposedUnitPrice is null or <= 0
                        or > 100000000m
                    )
                )
            )
            {
                return Results.BadRequest(new
                {
                    message = "Talep bilgileri geçersiz."
                });
            }

            // Aynı RequestKey ikinci kez rezervasyon oluşturamaz.
            var previous = await db.PurchaseRequests
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    r => r.RequestKey == input.RequestKey);

            if (previous != null)
            {
                if (
                    previous.ProductId != input.ProductId ||
                    previous.Kind != kind ||
                    previous.Quantity != input.Quantity
                )
                {
                    return Results.Conflict(new
                    {
                        message = "RequestKey başka bir talepte kullanılmış."
                    });
                }

                return Results.Ok(new
                {
                    previous.Id,
                    previous.Kind,
                    previous.Status,
                    repeated = true
                });
            }

            await using var transaction =
                await db.Database.BeginTransactionAsync();

            try
            {
                if (kind == "purchase")
                {
                    // Eşzamanlı işlemlerde stok eksiye düşmez.
                    var updated = await db.Database
                        .ExecuteSqlInterpolatedAsync($"""
                            UPDATE "Products"
                            SET "ReservedCount" =
                                "ReservedCount" + {input.Quantity}
                            WHERE "Id" = {input.ProductId}
                              AND "IsPublished" = true
                              AND "Stock" - "ReservedCount"
                                  >= {input.Quantity}
                            """);

                    if (updated != 1)
                    {
                        return Results.Conflict(new
                        {
                            message =
                                "Ürün yayında değil veya stok yetersiz."
                        });
                    }
                }

                var product = await db.Products
                    .AsNoTracking()
                    .FirstOrDefaultAsync(
                        p => p.Id == input.ProductId);

                if (
                    product == null ||
                    !product.IsPublished ||
                    (
                        kind == "offer" &&
                        product.Stock - product.ReservedCount
                            < input.Quantity
                    )
                )
                {
                    return Results.Conflict(new
                    {
                        message = "Ürün şu anda mevcut değil."
                    });
                }

                // Fiyat sunucuda hesaplanır;
                // ziyaretçi fiyatı değiştiremez.
                var unitPrice = Math.Round(
                    product.Price *
                    (1m - product.DiscountPercent / 100m),
                    2,
                    MidpointRounding.AwayFromZero
                );

                if (unitPrice < 0 || unitPrice > 100000000m)
                {
                    return Results.BadRequest(new
                    {
                        message = "Ürün fiyatı geçersiz."
                    });
                }

                var request = new PurchaseRequest
                {
                    RequestKey = input.RequestKey,
                    ProductId = input.ProductId,
                    Kind = kind!,
                    Quantity = input.Quantity,
                    BuyerName = name,
                    BuyerEmail = email,
                    PriceAtRequest = unitPrice,
                    ProposedUnitPrice = kind == "offer"
                        ? input.ProposedUnitPrice
                        : null,
                    Status = "pending"
                };

                db.PurchaseRequests.Add(request);

                db.Audits.Add(new Audit
                {
                    Actor = "external",
                    Action = "commerce.request.created",
                    Target = $"product:{input.ProductId}",
                    Details = $"kind={kind};quantity={input.Quantity}"
                });

                await db.SaveChangesAsync();
                await transaction.CommitAsync();

                await Invalidate(redis);

                return Results.Json(new
                {
                    request.Id,
                    request.Kind,
                    request.Status,
                    message = kind == "purchase"
                        ? "Ürün rezerve edildi. Yönetici onayı bekleniyor. Ödeme alınmadı."
                        : "Teklif alındı. Yönetici yanıtı bekleniyor."
                }, statusCode: 202);
            }
            catch (DbUpdateException ex) when (
                ex.InnerException is PostgresException pg &&
                pg.SqlState == "23505")
            {
                await transaction.RollbackAsync();

                return Results.Conflict(new
                {
                    message =
                        "Talep zaten oluşturulmuş. Aynı istek anahtarıyla durumunu kontrol edin."
                });
            }
        })
        .AllowAnonymous()
        .RequireRateLimiting("v6-store-public");

        // Pazarlama ve Admin Pro siparişleri görebilir.
        var manage = app.MapGroup("/api/v6/commerce")
            .RequireAuthorization();

        manage.MapGet("/requests", async Task<IResult> (
            AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            var requests = await db.PurchaseRequests
                .AsNoTracking()
                .OrderByDescending(r => r.Id)
                .Take(200)
                .ToListAsync();

            return Results.Ok(requests);
        });

        manage.MapGet("/products", async Task<IResult> (
            AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            var products = await db.Products
                .AsNoTracking()
                .OrderByDescending(p => p.Id)
                .Select(p => new
                {
                    p.Id,
                    p.Name,
                    p.Price,
                    p.Stock,
                    p.SoldCount,
                    p.ReservedCount,
                    p.IsPublished,
                    available = p.Stock - p.ReservedCount
                })
                .ToListAsync();

            return Results.Ok(products);
        });
    }
}
