"use client";

import { useEffect, useState } from "react";

type Notice = {
  id: number;
  ticketId: number;
  message: string;
  createdAt: string;
};

export default function TicketInbox({ token }: { token: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!token) return;

    let active = true;

    async function refresh() {
      try {
        const response = await fetch("/api/ticket-notices", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store"
        });

        if (response.ok && active)
          setNotices(await response.json());
      } catch {}
    }

    void refresh();
    const interval = setInterval(refresh, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [token]);

  async function dismiss(id: number) {
    try {
      const response = await fetch(
        `/api/ticket-notices/${id}/dismiss`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) return;

      setNotices(previous => previous.filter(x => x.id !== id));
    } catch {}
  }

  if (!notices.length) return null;

  return (
    <section className="card koru-notifications">
      <h2>Bildirimler ({notices.length})</h2>

      {notices.map(notice => (
        <div className="koru-notice" key={notice.id}>
          <div>
            <b>Ticket #{notice.ticketId}</b>
            <p>{notice.message}</p>
            <small>
              {new Date(notice.createdAt).toLocaleString("tr-TR")}
            </small>
          </div>

          <button
            className="secondary"
            title="Bildirimi gizle"
            onClick={() => dismiss(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}
