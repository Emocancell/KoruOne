"use client";
import "./V5Analytics.css";

import { useCallback, useEffect, useState } from "react";

type TicketGroup = {
  label: string;
  count: number;
};

type SalaryGroup = {
  department: string;
  employees: number;
  averageSalary: number;
  totalSalary: number;
};

type Analytics = {
  ticketTotal: number;
  ticketsByStatus: TicketGroup[];
  salaryByDepartment: SalaryGroup[] | null;
  productCount: number;
  publishedAds: number;
};

export default function V5Analytics({
  token
}: {
  token: string;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch("/api/v5/analytics", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Dashboard HTTP ${response.status}`);
      }

      setData(await response.json());
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Veriler alınamadı."
      );
    }
  }, [token]);

  useEffect(() => {
    void load();

    const timer = setInterval(() => void load(), 10000);

    return () => clearInterval(timer);
  }, [load]);

  async function exportTickets() {
    setLoading(true);

    try {
      const response = await fetch(
        "/api/v5/reports/tickets.csv",
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`CSV HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "koru-ticket-raporu.csv";

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Rapor indirilemedi."
      );
    } finally {
      setLoading(false);
    }
  }

  const money = (amount: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0
    }).format(amount);

  const totalTickets = data?.ticketTotal ?? 0;

  const closedTickets = data?.ticketsByStatus
    .filter(x => x.label === "closed")
    .reduce((sum, x) => sum + x.count, 0) ?? 0;

  const openTickets = totalTickets - closedTickets;

  return (
    <section className="v5-analytics">
      <div className="v5-analytics-header">
        <div>
          <p className="muted">
            KORU ONE / DEPARTMENT INTELLIGENCE
          </p>

          <h2>Operasyon ve Performans Dashboard</h2>

          <p className="muted">
            PostgreSQL kaynaklı, yetkiye göre filtrelenmiş veriler.
          </p>
        </div>

        <div className="row">
          <button className="secondary" onClick={load}>
            Yenile
          </button>

          <button disabled={loading} onClick={exportTickets}>
            {loading ? "Hazırlanıyor..." : "CSV Dışa Aktar"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="error">{error}</p>
      )}

      {!data && <p>Dashboard yükleniyor...</p>}

      {data && (
        <>
          <div className="v5-analytics-grid">
            {[
              ["Toplam Ticket", totalTickets],
              ["Açık Ticket", openTickets],
              ["Kapalı Ticket", closedTickets],
              ["Toplam Ürün", data.productCount],
              ["Yayındaki Reklam", data.publishedAds]
            ].map(([label, value]) => (
              <div className="card v5-analytics-kpi" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Ticket Durum Dağılımı</h3>

            {data.ticketsByStatus.length === 0 && (
              <p className="muted">
                Bu kullanıcının görebildiği ticket bulunmuyor.
              </p>
            )}

            {data.ticketsByStatus.map(group => (
              <div className="v5-analytics-row" key={group.label}>
                <span>{group.label}</span>

                <div className="v5-analytics-track">
                  <div
                    className="v5-analytics-fill"
                    style={{
                      width: `${
                        totalTickets
                          ? (group.count / totalTickets) * 100
                          : 0
                      }%`
                    }}
                  />
                </div>

                <strong>{group.count}</strong>
              </div>
            ))}
          </div>

          {data.salaryByDepartment !== null && (
            <div className="card">
              <h3>Departman Bazında Ortalama Brüt Maaş</h3>

              <p className="muted">
                Bu grafik yalnızca İK ve Admin hesaplarına açıktır.
              </p>

              {data.salaryByDepartment.length === 0 && (
                <p>Personel kaydı bulunmuyor.</p>
              )}

              {data.salaryByDepartment.map(group => {
                const maximum = Math.max(
                  1,
                  ...data.salaryByDepartment!.map(
                    x => Number(x.averageSalary)
                  )
                );

                const percentage =
                  Number(group.averageSalary) / maximum * 100;

                return (
                  <div
                    className="v5-salary-group"
                    key={group.department}
                  >
                    <div className="v5-analytics-header">
                      <div>
                        <strong>{group.department}</strong>
                        <p className="muted">
                          {group.employees} personel
                        </p>
                      </div>

                      <strong>
                        {money(Number(group.averageSalary))}
                      </strong>
                    </div>

                    <div className="v5-analytics-track">
                      <div
                        className="v5-analytics-fill"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
