"use client";

import { useCallback, useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";

type Group = {
  name: string;
  consumers: number;
  pending: number;
  lag: number | null;
  lastDeliveredId: string;
};

type Pending = {
  id: string;
  consumer: string;
  idleMs: number;
  deliveries: number;
};

type Consumer = {
  name: string;
  pending: number;
  idleMs: number;
};

type Event = {
  id: string;
  fields: Record<string, string>;
};

type Data = {
  connected: boolean;
  initialized: boolean;
  streamKey: string;
  length: number;
  groups: Group[];
  pending: Pending[];
  consumers: Consumer[];
  recent: Event[];
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dce5e9",
  padding: 22,
  borderRadius: 15
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit,minmax(200px,1fr))",
  gap: 14
};

export default function StreamsOperations() {
  const [token, setToken] = useState("");
  const [operator, setOperator] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [eventType, setEventType] =
    useState("ticket.created");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("OIDC ayarı eksik.");
      return;
    }

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    manager.getUser().then(async user => {
      if (!active) return;

      if (!user || user.expired || !user.access_token) {
        setError("Kurumsal giriş gerekli.");
        return;
      }

      setToken(user.access_token);

      const response = await fetch("/api/me", {
        headers: {
          Authorization: `Bearer ${user.access_token}`
        }
      });

      if (response.ok && active) {
        const me = await response.json();
        const roles: string[] = me.roles || [];

        setOperator(
          roles.includes("admin") ||
          roles.includes("redis-operator")
        );
      }
    }).catch(() => {
      if (active) setError("Oturum okunamadı.");
    });

    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(
        "/api/v7/streams/overview",
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        }
      );

      if (!response.ok)
        throw Error(`Streams HTTP ${response.status}`);

      setData(await response.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "Streams hatası");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();
    const timer = setInterval(
      () => void refresh(), 10000);

    return () => clearInterval(timer);
  }, [token, refresh]);

  async function execute(
    path: string,
    body: object = {}
  ) {
    if (!operator || !token || busy) return;

    setBusy(true);

    try {
      const response = await fetch(
        "/api/v7/streams/demo/" + path,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok)
        throw Error(`İşlem HTTP ${response.status}`);

      const result = await response.json();

      setMessage(
        `${path}: ${JSON.stringify(result)}`
      );

      setError("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "İşlem hatası");
    } finally {
      setBusy(false);
    }
  }

  const pending = data?.groups.reduce(
    (s, g) => s + g.pending, 0) ?? 0;

  const lag = data?.groups.reduce(
    (s, g) => s + (g.lag ?? 0), 0) ?? 0;

  return (
    <main style={{
      maxWidth: 1380,
      margin: "30px auto",
      padding: "0 22px 60px"
    }}>
      <p className="muted">
        KORU ONE / REDIS CONTROL PLANE
      </p>

      <h1>Redis Streams Operations</h1>

      <p className="muted">
        Event lifecycle, consumer group, pending ve ACK.
        Yalnızca izole laboratuvar stream'i kullanılır.
      </p>

      {error &&
        <p className="error" role="alert">{error}</p>}

      {message &&
        <p role="status">{message}</p>}

      <div style={grid}>
        {[
          ["Stream Entries", data?.length],
          ["Consumer Groups", data?.groups.length],
          ["Pending", data ? pending : undefined],
          ["Consumer Lag", data ? lag : undefined]
        ].map(([label, value]) => (
          <section key={String(label)} style={panel}>
            <small>{label}</small>
            <strong style={{
              display: "block",
              fontSize: 29,
              marginTop: 10
            }}>
              {value ?? "—"}
            </strong>
          </section>
        ))}
      </div>

      <section style={{...panel, marginTop: 22}}>
        <h2>Event Lifecycle Testi</h2>

        <p className="muted">
          {data?.streamKey ?? "koru:lab:events:v78"}
        </p>

        {operator ? (
          <div style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center"
          }}>
            <button disabled={busy}
              onClick={() =>
                void execute("initialize")}>
              1. Consumer Group
            </button>

            <input
              value={eventType}
              maxLength={36}
              onChange={e =>
                setEventType(e.target.value)}
            />

            <button disabled={busy || !eventType.trim()}
              onClick={() =>
                void execute("publish", {eventType})}>
              2. Event Üret
            </button>

            <button disabled={busy || !data?.initialized}
              onClick={() =>
                void execute("deliver", {count: 5})}>
              3. Consumer'a Teslim Et
            </button>

            <button className="secondary"
              onClick={() => void refresh()}>
              Yenile
            </button>
          </div>
        ) : (
          <p className="muted">
            Event yönetimi için Admin veya Redis Operator
            rolü gerekir.
          </p>
        )}
      </section>

      <section style={{...panel, marginTop: 22}}>
        <h2>Consumer Groups</h2>
        <div style={{overflowX:"auto"}}>
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Consumers</th>
                <th>Pending</th>
                <th>Lag</th>
              </tr>
            </thead>
            <tbody>
              {data?.groups.map(g => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{g.consumers}</td>
                  <td>{g.pending}</td>
                  <td>{g.lag ?? "Bilinmiyor"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{...panel, marginTop: 22}}>
        <h2>Pending Messages</h2>
        <div style={{overflowX:"auto"}}>
          <table>
            <thead>
              <tr>
                <th>Message ID</th>
                <th>Consumer</th>
                <th>Idle</th>
                <th>Deliveries</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {data?.pending.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.consumer}</td>
                  <td>{p.idleMs} ms</td>
                  <td>{p.deliveries}</td>
                  <td>
                    {operator &&
                      <button disabled={busy}
                        onClick={() =>
                          void execute(
                            "ack/" + encodeURIComponent(p.id)
                          )}>
                        ACK
                      </button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data?.pending.length &&
          <p className="muted">Bekleyen mesaj yok.</p>}
      </section>

      <div style={{...grid, marginTop: 22}}>
        <section style={panel}>
          <h2>Consumers</h2>
          {data?.consumers.map(c => (
            <p key={c.name}>
              <b>{c.name}</b>
              {" · "}Pending: {c.pending}
              {" · "}Idle: {c.idleMs} ms
            </p>
          ))}
          {!data?.consumers.length &&
            <p className="muted">Henüz consumer yok.</p>}
        </section>

        <section style={panel}>
          <h2>Recent Events</h2>
          {data?.recent.map(e => (
            <p key={e.id}>
              <b>{e.fields.event ?? "event"}</b>
              {" · "}{e.id}
            </p>
          ))}
          {!data?.recent.length &&
            <p className="muted">Henüz event yok.</p>}
        </section>
      </div>

      <p className="muted" style={{marginTop: 20}}>
        Demo yazma işlemleri yalnızca Development
        ortamında açıktır. ACK mesajı stream'den silmez.
      </p>
    </main>
  );
}
