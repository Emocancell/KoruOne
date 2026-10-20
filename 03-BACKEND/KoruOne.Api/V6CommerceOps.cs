using System.Security.Claims;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;

internal record V6Decision(string Action);
internal record V6Publication(bool Published);

internal static class V6CommerceOps
{
    internal static void MapV6CommerceOps(this WebApplication app)
    {
        var api = app.MapGroup("/api/v6/commerce")
                     .RequireAuthorization();

        // BEKLEYEN SATIŞ / TEKLİF KARARI
        api.MapPost("/requests/{id:int}/decision",
            async Task<IResult> (
                int id,
                V6Decision input,
                AppDb db,
                RedisConnection redis,
                ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            var action = input.Action?.Trim().ToLowerInvariant();

            if (action is not ("confirm" or "reject"))
                return Results.BadRequest(new {
                    message = "confirm veya reject gönderin."
                });

            // İstek önce okunur; karar transaction içinde
            // koşullu UPDATE ile yalnızca bir kez uygulanır.
            var order = await db.PurchaseRequests
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == id);

            if (order == null)
                return Results.NotFound();

            if (order.Status != "pending")
                return Results.Conflict(new {
                    message = "Bu talep daha önce sonuçlandırılmış."
                });

            string nextStatus = action == "reject"
                ? "rejected"
                : order.Kind == "offer"
                    ? "offer-accepted"
                    : "confirmed";

            var actor = Auth.UserId(user);

            await using var tx =
                await db.Database.BeginTransactionAsync();

            // Aynı talebi iki yönetici aynı anda işleyemez.
            var claimed = await db.Database
                .ExecuteSqlInterpolatedAsync($"""
                    UPDATE "PurchaseRequests"
                    SET "Status" = {nextStatus},
                        "ResolvedAt" = now(),
                        "ResolvedBy" = {actor}
                    WHERE "Id" = {id}
                      AND "Status" = 'pending'
                    """);

            if (claimed != 1)
            {
                await tx.RollbackAsync();

                return Results.Conflict(new {
                    message = "Talep başka bir yönetici tarafından işlendi."
                });
            }

            if (order.Kind == "purchase")
            {
                int changed;

                if (action == "confirm")
                {
                    // Rezerve stok kesin satışa dönüşür.
                    changed = await db.Database
                        .ExecuteSqlInterpolatedAsync($"""
                            UPDATE "Products"
                            SET "Stock" =
                                    "Stock" - {order.Quantity},
                                "ReservedCount" =
                                    "ReservedCount" - {order.Quantity},
                                "SoldCount" =
                                    "SoldCount" + {order.Quantity}
                            WHERE "Id" = {order.ProductId}
                              AND "ReservedCount" >= {order.Quantity}
                              AND "Stock" >= {order.Quantity}
                            """);
                }
                else
                {
                    // Reddedilen talebin rezervasyonu kaldırılır.
                    changed = await db.Database
                        .ExecuteSqlInterpolatedAsync($"""
                            UPDATE "Products"
                            SET "ReservedCount" =
                                    "ReservedCount" - {order.Quantity}
                            WHERE "Id" = {order.ProductId}
                              AND "ReservedCount" >= {order.Quantity}
                            """);
                }

                if (changed != 1)
                {
                    await tx.RollbackAsync();

                    return Results.Conflict(new {
                        message =
                            "Stok tutarsızlığı tespit edildi. İşlem iptal."
                    });
                }

                if (action == "confirm")
                {
                    db.ProductSales.Add(new ProductSale {
                        ProductId = order.ProductId,
                        Quantity = order.Quantity,
                        UnitPrice = order.PriceAtRequest,
                        Actor = actor,
                        SoldAt = DateTime.UtcNow
                    });
                }
            }

            db.Audits.Add(new Audit {
                Actor = actor,
                Action = "commerce.request.decision",
                Target = $"purchase-request:{id}",
                Details =
                    $"kind={order.Kind};status={nextStatus};" +
                    $"product={order.ProductId};quantity={order.Quantity}"
            });

            await db.SaveChangesAsync();
            await tx.CommitAsync();

            // PostgreSQL kaynak sistem; Redis cache'dir.
            await V6Store.Invalidate(redis);
            await Cache.Clear(redis);

            return Results.Ok(new {
                id,
                kind = order.Kind,
                status = nextStatus,
                productId = order.ProductId,
                quantity = order.Quantity
            });
        });

        // ÜRÜN YAYIN DURUMU
        api.MapPut("/products/{id:int}/publication",
            async Task<IResult> (
                int id,
                V6Publication input,
                AppDb db,
                RedisConnection redis,
                ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            var product = await db.Products.FindAsync(id);

            if (product == null)
                return Results.NotFound();

            product.IsPublished = input.Published;

            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "product.publication",
                Target = $"product:{id}",
                Details = input.Published
                    ? "published" : "unpublished"
            });

            await db.SaveChangesAsync();
            await V6Store.Invalidate(redis);

            return Results.Ok(new {
                product.Id,
                product.IsPublished,
                status = product.Stock == 0 && product.SoldCount > 0
                    ? "Satıldı"
                    : !product.IsPublished ? "Yayında Değil"
                    : product.Stock <= product.ReservedCount
                        ? "Stok Yok / Rezerve"
                        : "Satışta"
            });
        });

        // SATIŞ GEÇMİŞİ
        api.MapGet("/sales", async Task<IResult> (
            AppDb db,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            return Results.Ok(await db.ProductSales
                .AsNoTracking()
                .OrderByDescending(x => x.Id)
                .Take(200)
                .ToListAsync());
        });

        // CANLI TİCARİ DASHBOARD
        api.MapGet("/summary", async Task<IResult> (
            AppDb db,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            return Results.Ok(new {
                pending = await db.PurchaseRequests
                    .CountAsync(x => x.Status == "pending"),
                confirmed = await db.PurchaseRequests
                    .CountAsync(x => x.Status == "confirmed"),
                offers = await db.PurchaseRequests
                    .CountAsync(x => x.Kind == "offer"
                        && x.Status == "pending"),
                soldUnits = await db.ProductSales
                    .SumAsync(x => (int?)x.Quantity) ?? 0,
                totalRevenue = await db.ProductSales
                    .SumAsync(x =>
                        (decimal?)(x.Quantity * x.UnitPrice)) ?? 0m,
                listedProducts = await db.Products
                    .CountAsync(x => x.IsPublished &&
                        x.Stock > x.ReservedCount)
            });
        });

        // SATIŞ VE TEKLİF CSV
        api.MapGet("/requests.csv", async Task<IResult> (
            AppDb db,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            var orders = await db.PurchaseRequests
                .AsNoTracking()
                .OrderByDescending(x => x.Id)
                .Take(10000)
                .ToListAsync();

            static string Q(string? text)
            {
                var v = (text ?? "")
                    .Replace("\r", " ")
                    .Replace("\n", " ");

                // Excel formül enjeksiyonuna karşı koruma
                if (v.Length > 0 && "=+-@\t".Contains(v[0]))
                    v = "'" + v;

                return "\"" + v.Replace("\"", "\"\"") + "\"";
            }

            var lines = new List<string> {
                "ID,UrunID,Tur,Adet,Alici,Email," +
                "BirimFiyat,TeklifFiyati,Durum,Tarih"
            };

            foreach (var o in orders)
            {
                lines.Add(string.Join(",", new [] {
                    o.Id.ToString(),
                    o.ProductId.ToString(),
                    Q(o.Kind),
                    o.Quantity.ToString(),
                    Q(o.BuyerName),
                    Q(o.BuyerEmail),
                    o.PriceAtRequest.ToString(
                        CultureInfo.InvariantCulture),
                    o.ProposedUnitPrice?.ToString(
                        CultureInfo.InvariantCulture) ?? "",
                    Q(o.Status),
                    Q(o.CreatedAt.ToString("O"))
                }));
            }

            return Results.File(
                Encoding.UTF8.GetBytes(
                    "\uFEFF" + string.Join("\r\n", lines)),
                "text/csv",
                "koru-siparis-teklif.csv"
            );
        });
    }
}
