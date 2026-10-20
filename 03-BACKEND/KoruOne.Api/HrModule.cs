using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;

static class HrModule
{
    public static void MapHrModule(this WebApplication app)
    {
        var hr = app.MapGroup("/api/hr").RequireAuthorization();

        hr.MapGet("/employees", async (AppDb db, ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "hr", "admin"))
                return Results.Forbid();

            var employees = await db.Employees
                .AsNoTracking()
                .OrderBy(e => e.Name)
                .ToListAsync();

            return Results.Ok(employees);
        });

        hr.MapPost("/employees", async (
            EmployeeCreate input,
            AppDb db,
            RedisConnection redis,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "hr", "admin"))
                return Results.Forbid();

            if (string.IsNullOrWhiteSpace(input.Name)
                || input.Name.Length > 150
                || string.IsNullOrWhiteSpace(input.Department)
                || input.Department.Length > 100
                || input.Salary < 0
                || input.Salary > 100000000)
                return Results.BadRequest(new {
                    message = "Personel bilgileri geçersiz."
                });

            var employee = new Employee
            {
                Name = input.Name.Trim(),
                Department = input.Department.Trim(),
                Salary = input.Salary
            };

            db.Employees.Add(employee);
            await db.SaveChangesAsync();

            db.Audits.Add(new Audit
            {
                Actor = Auth.UserId(user),
                Action = "employee.create",
                Target = $"employee:{employee.Id}",
                Details = "Personel oluşturuldu"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);

            return Results.Created(
                $"/api/hr/employees/{employee.Id}",
                employee
            );
        });

        hr.MapPut("/employees/{id:int}/salary", async (
            int id,
            SalaryUpdate input,
            AppDb db,
            RedisConnection redis,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "hr", "admin"))
                return Results.Forbid();

            if (input.Amount < 0 || input.Amount > 100000000)
                return Results.BadRequest();

            var employee = await db.Employees.FindAsync(id);

            if (employee == null)
                return Results.NotFound();

            employee.Salary = input.Amount;

            db.Audits.Add(new Audit
            {
                Actor = Auth.UserId(user),
                Action = "salary.update",
                Target = $"employee:{id}",
                Details = "Maaş güncellendi; tutar gizlendi"
            });

            await db.SaveChangesAsync();
            await Cache.Clear(redis);

            return Results.Ok(new { updated = true });
        });

        hr.MapGet("/employees.csv", async (
            AppDb db,
            ClaimsPrincipal user) =>
        {
            if (!Auth.Has(user, "hr", "admin"))
                return Results.Forbid();

            var employees = await db.Employees
                .AsNoTracking()
                .OrderBy(e => e.Name)
                .ToListAsync();

            static string Csv(string value)
            {
                value = value.Replace("\r", " ")
                             .Replace("\n", " ");

                if (value.Length > 0 &&
                    "=+-@\t".Contains(value[0]))
                    value = "'" + value;

                return "\"" + value.Replace("\"", "\"\"") + "\"";
            }

            var lines = new List<string>
            {
                "ID,Personel,Departman,Brut Maas"
            };

            foreach (var e in employees)
                lines.Add(
                    $"{e.Id},{Csv(e.Name)},{Csv(e.Department)}," +
                    e.Salary.ToString(
                        System.Globalization.CultureInfo.InvariantCulture)
                );

            var data = Encoding.UTF8.GetBytes(
                "\uFEFF" + string.Join("\r\n", lines)
            );

            return Results.File(
                data, "text/csv", "koru-ik-personel.csv"
            );
        });
    }
}

record EmployeeCreate(
    string Name,
    string Department,
    decimal Salary
);

record SalaryUpdate(decimal Amount);
