using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

public record StockQuantity(int Quantity);

public class ProductSale
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public string Actor { get; set; } = "";
    public DateTime SoldAt { get; set; } = DateTime.UtcNow;
}

public static class StockModule
{
    public static void MapStockModule(this WebApplication app)
    {
        var stock = app.MapGroup("/api/v4/products")
                       .RequireAuthorization();

        stock.MapGet("", async (
            AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "marketing", "admin"))
                return Results.Forbid();

            return Results.Ok(await db.Products
                .AsNoTracking()
                .OrderBy(p => p.Id)
                .ToListAsync());
        });

        stock.MapPost("/{id:int}/stock", async (
            int id, StockQuantity input,
            AppDb db, RedisConnection redis,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "marketing", "admin"))
                return Results.Forbid();

            if (input.Quantity < 1 || input.Quantity > 100000)
                return Results.BadRequest(new {
                    message = "Geçersiz stok miktarı."
                });

            var affected = await db.Database
                .ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Products"
                    SET "Stock" = "Stock" + {input.Quantity}
                    WHERE "Id" = {id}
                    """);

            if (affected == 0)
                return Results.NotFound();

            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "product.stock.add",
                Target = $"product:{id}",
                Details = $"quantity={input.Quantity}"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);

            return Results.Ok(new { updated = true });
        });

        stock.MapPost("/{id:int}/sell", async (
            int id, StockQuantity input,
            AppDb db, RedisConnection redis,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "marketing", "admin"))
                return Results.Forbid();

            if (input.Quantity < 1 || input.Quantity > 100000)
                return Results.BadRequest(new {
                    message = "Geçersiz satış miktarı."
                });

            await using var transaction =
                await db.Database.BeginTransactionAsync();

            var affected = await db.Database
                .ExecuteSqlInterpolatedAsync($"""
                    UPDATE "Products"
                    SET "Stock" = "Stock" - {input.Quantity},
                        "SoldCount" = "SoldCount" + {input.Quantity}
                    WHERE "Id" = {id}
                      AND "Stock" - "ReservedCount" >= {input.Quantity}
                    """);

            if (affected == 0)
            {
                await transaction.RollbackAsync();

                return Results.Conflict(new {
                    message = "Ürün bulunamadı veya stok yetersiz."
                });
            }

            var product = await db.Products
                .AsNoTracking()
                .SingleAsync(p => p.Id == id);

            var sale = new ProductSale {
                ProductId = id,
                Quantity = input.Quantity,
                UnitPrice = product.Price *
                    (1 - product.DiscountPercent / 100m),
                Actor = Auth.UserId(user)
            };

            db.ProductSales.Add(sale);

            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "product.sold",
                Target = $"product:{id}",
                Details = $"quantity={input.Quantity}"
            });

            await db.SaveChangesAsync();
            await transaction.CommitAsync();

            await Cache.Clear(redis);

            return Results.Ok(new {
                sale.Id,
                sale.ProductId,
                sale.Quantity,
                sale.UnitPrice,
                product.Stock,
                status = product.Stock == 0 ? "sold-out" : "available"
            });
        });

        stock.MapGet("/sales", async (
            AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "marketing", "admin"))
                return Results.Forbid();

            return Results.Ok(await db.ProductSales
                .AsNoTracking()
                .OrderByDescending(s => s.Id)
                .Take(200)
                .ToListAsync());
        });
    }
}
