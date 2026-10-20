using System.Security.Claims;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

public static class EnterpriseModule
{
    public static void MapEnterprise(this RouteGroupBuilder api)
    {
        api.MapPatch("/tickets/{id:int}/status", async (
            int id, TicketTransition input, AppDb db,
            RedisConnection redis, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "network", "it"))
                return Results.Forbid();

            if (!new[] {"open","in_progress","closed"}.Contains(input.Status))
                return Results.BadRequest(new { message = "Geçersiz durum." });

            var note = input.Note?.Trim() ?? "";

            if (note.Length > 2000 ||
                (input.Status == "closed" && note.Length < 5))
                return Results.BadRequest(new {
                    message = "Kapatmak için en az 5 karakterlik çözüm notu yazın."
                });

            var ticket = await db.Tickets.FindAsync(id);
            if (ticket == null) return Results.NotFound();

            if (ticket.Status == input.Status)
                return Results.Conflict(new {
                    message = "Ticket zaten bu durumda."
                });

            var old = ticket.Status;
            ticket.Status = input.Status;

            db.TicketEvents.Add(new TicketEvent {
                TicketId = id,
                Actor = Auth.UserId(user),
                OldStatus = old,
                NewStatus = input.Status,
                Note = note,
                CreatedAt = DateTime.UtcNow
            });

            if (input.Status == "closed") {
                db.TicketNotices.Add(new TicketNotice {
                    TicketId = id,
                    RecipientId = ticket.CreatedBy,
                    Message = $"#{id} numaralı talep kapatıldı. Çözüm: {note}",
                    CreatedAt = DateTime.UtcNow
                });
            }

            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "ticket.status",
                Target = $"ticket:{id}",
                Details = $"{old} -> {input.Status}"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);

            return Results.Ok(new { ticket.Id, ticket.Status });
        });

        api.MapGet("/tickets/{id:int}/history", async (
            int id, AppDb db, ClaimsPrincipal user) =>
        {
            var ticket = await db.Tickets.FindAsync(id);
            if (ticket == null) return Results.NotFound();

            if (ticket.CreatedBy != Auth.UserId(user) &&
                !Auth.Has(user, "admin", "network", "it"))
                return Results.Forbid();

            return Results.Ok(await db.TicketEvents
                .AsNoTracking()
                .Where(x => x.TicketId == id)
                .OrderByDescending(x => x.Id)
                .ToListAsync());
        });

        api.MapGet("/ticket-notices", async (
            AppDb db, ClaimsPrincipal user) =>
            Results.Ok(await db.TicketNotices
                .AsNoTracking()
                .Where(x => x.RecipientId == Auth.UserId(user)
                    && x.DismissedAt == null)
                .OrderByDescending(x => x.Id)
                .Take(30)
                .ToListAsync())
        );

        api.MapPost("/ticket-notices/{id:int}/dismiss", async (
            int id, AppDb db, ClaimsPrincipal user) =>
        {
            var notice = await db.TicketNotices.FindAsync(id);
            if (notice == null || notice.RecipientId != Auth.UserId(user))
                return Results.NotFound();

            notice.DismissedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return Results.Ok(new { dismissed = true });
        });

        api.MapPut("/products/{id:int}/discount", async (
            int id, DiscountUpdate input, AppDb db,
            RedisConnection redis, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "admin", "marketing"))
                return Results.Forbid();

            if (input.Percent < 0 || input.Percent > 90)
                return Results.BadRequest(new {
                    message = "İndirim %0 ile %90 arasında olmalı."
                });

            var product = await db.Products.FindAsync(id);
            if (product == null) return Results.NotFound();

            product.DiscountPercent = input.Percent;

            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "product.discount",
                Target = $"product:{id}",
                Details = $"discount={input.Percent}"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);
            return Results.Ok(product);
        });

        api.MapGet("/advertisements/manage", async (
            AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "advertising", "admin"))
                return Results.Forbid();

            return Results.Ok(await db.Advertisements
                .AsNoTracking()
                .OrderByDescending(x => x.Id)
                .ToListAsync());
        });

        api.MapPut("/advertisements/{id:int}/unpublish", async (
            int id, AppDb db, RedisConnection redis,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "advertising", "admin"))
                return Results.Forbid();

            var ad = await db.Advertisements.FindAsync(id);
            if (ad == null) return Results.NotFound();

            ad.Published = false;
            db.Audits.Add(new Audit {
                Actor = Auth.UserId(user),
                Action = "advertisement.unpublish",
                Target = $"advertisement:{id}",
                Details = "Yayından kaldırıldı; silinmedi"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);
            return Results.Ok(ad);
        });
    }
}

public record TicketTransition(string Status, string? Note = null);
public record DiscountUpdate(decimal Percent);

public class TicketEvent {
    public int Id { get; set; }
    public int TicketId { get; set; }
    public string Actor { get; set; } = "";
    public string OldStatus { get; set; } = "";
    public string NewStatus { get; set; } = "";
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class TicketNotice {
    public int Id { get; set; }
    public int TicketId { get; set; }
    public string RecipientId { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DismissedAt { get; set; }
}
