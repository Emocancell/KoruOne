"use client";

import { useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import "../style.css";

type Ticket = {
  id: number;
  title: string;
  department: string;
  status: string;
  createdBy: string;
};

type UserInfo = {
  name: string;
  roles: string[];
};

const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY || "";

const manager = typeof window !== "undefined" && authority
  ? new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    })
  : null;

export default function OperationsPage() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<UserInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("IT");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [closeNote, setCloseNote] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [historyId, setHistoryId] = useState<number | null>(null);

  const roles = user?.roles || [];

  const isAdmin = roles.includes("admin");
  const isNetwork = roles.includes("network");
  const isIT = roles.includes("it");

  const canManage = isAdmin || isNetwork || isIT;

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        "HTTP " + response.status + ": " + body.slice(0, 180)
      );
    }

    return response;
  }

  async function load() {
    if (!token) return;

    try {
      const [meResponse, ticketResponse] = await Promise.all([
        request("/api/me"),
        request("/api/tickets")
      ]);

      const me: UserInfo = await meResponse.json();
      const list: Ticket[] = await ticketResponse.json();

      setUser(me);
      setTickets(list);
      setError("");

      if (me.roles.includes("network") &&
          !me.roles.includes("admin")) {
        setDepartment("Network");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "API hatası");
    }
  }

  useEffect(() => {
    manager?.getUser()
      .then(u => {
        if (u && !u.expired && u.access_token) {
          setToken(u.access_token);
        }
      })
      .catch(() => setError("Oturum okunamadı."));
  }, []);

  useEffect(() => {
    if (token) void load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [token]);

  async function createTicket() {
    if (!title.trim()) {
      setError("Ticket başlığı gir.");
      return;
    }

    setBusy(true);
    try {
      await request("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          department
        })
      });

      setTitle("");
      setMessage("Ticket başarıyla oluşturuldu.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kayıt hatası");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: number, status: string) {
    if (!canManage) return;

    setBusy(true);

    try {
      await request(`/api/tickets/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });

      setMessage(`Ticket #${id} güncellendi.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem hatası");
    } finally {
      setBusy(false);
    }
  }


  async function confirmClose() {
    if (closingId === null) return;

    if (closeNote.trim().length < 5) {
      setError("En az 5 karakterlik çözüm notu yaz.");
      return;
    }

    setBusy(true);

    try {
      await request(`/api/tickets/${closingId}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "closed",
          note: closeNote.trim()
        })
      });

      setClosingId(null);
      setCloseNote("");
      setError("");
      setMessage("Ticket çözüm notuyla kapatıldı.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kapatma hatası");
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(id: number) {
    try {
      const response = await request(`/api/tickets/${id}/history`);
      setHistory(await response.json());
      setHistoryId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Geçmiş yüklenemedi.");
    }
  }

  async function exportTickets() {
    if (!canManage) return;

    try {
      const response = await request("/api/reports/tickets.csv");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = "koru-network-it-tickets.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rapor hatası");
    }
  }

  const open = tickets.filter(t => t.status === "open");
  const active = tickets.filter(t => t.status === "in_progress");
  const closed = tickets.filter(t => t.status === "closed");

  const visible = tickets.filter(t =>
    filter === "all" || t.status === filter
  );

  if (!token) {
    return (
      <main className="ops-container">
        <h1>Operasyon Merkezi</h1>
        <p>Önce kurumsal hesabınla giriş yap.</p>
        <a href="/">Ana sayfaya dön</a>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  return (
    <main className="ops-container">
      <div className="ops-heading">
        <div>
          <p className="muted">KORU ONE / OPERASYON MERKEZİ</p>
          <h1>Network & IT Service Desk</h1>
          <p className="muted">
            Arıza talepleri, iş takibi ve operasyonel raporlar.
          </p>
          <p>Oturum: <b>{user?.name || "Yükleniyor"}</b></p>
        </div>

        <div className="ops-actions">
          <a className="ops-button secondary" href="/">
            Ana Sayfa
          </a>
          <button onClick={() => void load()}>Yenile</button>
          {canManage &&
            <button className="secondary" onClick={exportTickets}>
              CSV İndir
            </button>
          }
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="ops-message" role="status">{message}</p>}

      {!canManage ? (
        <section className="card">
          <h2>Destek Talebi</h2>
          <p>Operasyon yönetimi için Network, IT veya Admin rolü gerekir.</p>
          <p>Diğer departmanlar destek taleplerini ana portalda açabilir.</p>
        </section>
      ) : (
        <>
          <div className="ops-kpis">
            <div className="card">
              <span>Toplam Ticket</span>
              <strong>{tickets.length}</strong>
            </div>
            <div className="card">
              <span>Açık</span>
              <strong>{open.length}</strong>
            </div>
            <div className="card">
              <span>İşlemde</span>
              <strong>{active.length}</strong>
            </div>
            <div className="card">
              <span>Çözülen</span>
              <strong>{closed.length}</strong>
            </div>
          </div>

          <section className="card">
            <h2>Yeni Operasyon Talebi</h2>
            <div className="ops-form">
              <input
                placeholder="Ticket başlığı"
                maxLength={200}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />

              <select
                value={department}
                disabled={!isAdmin && (isNetwork !== isIT)}
                onChange={e => setDepartment(e.target.value)}
              >
                <option value="IT">IT</option>
                <option value="Network">Network</option>
              </select>

              <button
                disabled={busy || !title.trim()}
                onClick={createTicket}
              >
                + Ticket Aç
              </button>
            </div>
          </section>

          <section className="card">
            <div className="ops-heading">
              <h2>Ticket Envanteri</h2>

              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
              >
                <option value="all">Tüm Ticket'lar</option>
                <option value="open">Açık</option>
                <option value="in_progress">İşlemde</option>
                <option value="closed">Kapalı</option>
              </select>
            </div>

            <div className="ops-table">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Başlık</th>
                    <th>Departman</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>

                <tbody>
                  {visible.map(t => (
                    <tr key={t.id}>
                      <td>#{t.id}</td>
                      <td>{t.title}</td>
                      <td>{t.department}</td>
                      <td>
                        <span className={"ops-status " + t.status}>
                          {t.status === "open" ? "Açık" :
                           t.status === "in_progress" ? "İşlemde" :
                           "Kapalı"}
                        </span>
                      </td>
                      <td>
                        <div className="ops-row-actions">
                          <button
                            className="secondary"
                            onClick={() => showHistory(t.id)}
                          >
                            Geçmiş
                          </button>
                          {t.status === "open" &&
                            <button
                              disabled={busy}
                              onClick={() =>
                                updateStatus(t.id, "in_progress")
                              }
                            >
                              İşleme Al
                            </button>
                          }

                          {t.status !== "closed" &&
                            <button
                              disabled={busy}
                              onClick={() =>
                                setClosingId(t.id)
                              }
                            >
                              Kapat
                            </button>
                          }

                          {t.status === "closed" &&
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                updateStatus(t.id, "open")
                              }
                            >
                              Yeniden Aç
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visible.length === 0 &&
                <p className="muted">Gösterilecek ticket bulunmuyor.</p>
              }
            </div>
          </section>
        </>
      )}

      {closingId !== null && (
        <div className="koru-modal-backdrop">
          <section className="card koru-modal" role="dialog"
                   aria-modal="true" aria-label="Ticket kapatma">
            <h2>Ticket #{closingId} — Çözüm Kaydı</h2>
            <p>Yapılan işlemleri yaz. Talebi açan kişiye bildirim gidecek.</p>
            <textarea
              rows={5}
              maxLength={2000}
              value={closeNote}
              onChange={e => setCloseNote(e.target.value)}
              placeholder="Örn. Switch portu kontrol edildi, bağlantı yenilendi..."
            />
            <div className="row">
              <button disabled={busy} onClick={confirmClose}>
                Çözümü Kaydet ve Kapat
              </button>
              <button className="secondary" onClick={() => {
                setClosingId(null);
                setCloseNote("");
              }}>Vazgeç</button>
            </div>
          </section>
        </div>
      )}

      {historyId !== null && (
        <section className="card">
          <div className="ops-heading">
            <h2>Ticket #{historyId} — İşlem Geçmişi</h2>
            <button className="secondary"
                    onClick={() => setHistoryId(null)}>×</button>
          </div>

          {history.length === 0 && <p>Henüz işlem geçmişi yok.</p>}
          {history.map(event => (
            <div className="koru-notice" key={event.id}>
              <div>
                <b>{event.oldStatus} → {event.newStatus}</b>
                <p>{event.note || "Durum değiştirildi."}</p>
                <small>{event.actor} · {
                  new Date(event.createdAt).toLocaleString("tr-TR")
                }</small>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
