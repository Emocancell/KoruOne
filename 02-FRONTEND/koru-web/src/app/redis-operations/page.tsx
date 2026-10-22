"use client";

import {
  useCallback, useEffect, useRef, useState
} from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

type Node = {
  id: string;
  connected: boolean;
  usedMemory: number;
  maxMemory: number;
  clients: number;
  blockedClients: number;
  opsPerSecond: number;
  pingMs: number;
  error: string | null;
};

type Alert = {
  key: string;
  nodeId: string;
  severity: string;
  title: string;
  detail: string;
  acknowledgedBy: string | null;
  lastSeen: string;
};

type Slow = {
  nodeId: string;
  id: number;
  time: string;
  command: string;
  durationUs: number;
};

type Operations = {
  nodes: Node[];
  alerts: Alert[];
  slowlogs: Slow[];
  canAcknowledge: boolean;
  checkedAt: string;
};

const surface: React.CSSProperties = {
  background: "white",
  border: "1px solid #dfe8ed",
  padding: 22,
  borderRadius: 15
};

const labels: Record<string, string> = {
  "redis-cache": "Redis Cache",
  "redis-streams": "Redis Streams"
};

function fmt(n: number) {
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(n);
}

function mb(n: number) {
  return `${fmt(n / 1048576)} MB`;
}

function Trend({points}: {points: number[]}) {
  if (points.length < 2)
    return <p style={{
      color: "#8294a1",
      fontSize: 12
    }}>Grafik örnekleri birikiyor...</p>;

  const max = Math.max(...points, 1);

  const coordinates = points.map((n,i) => {
    const x = 5 + i / (points.length-1) * 290;
    const y = 78 - n / max * 68;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg
      width="100%"
      height="94"
      viewBox="0 0 300 90"
      preserveAspectRatio="none"
      aria-label="Son ölçümlerin çizgi grafiği"
      role="img"
    >
      <line x1="0" y1="83" x2="300" y2="83"
        stroke="#dbe6e9"/>
      <polyline
        points={coordinates}
        fill="none"
        stroke="#13806b"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function RedisOperationsPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<"alerts" | "slowlog">("alerts");
  const [auto, setAuto] = useState(true);

  const [history, setHistory] = useState<
    Record<string, number[]>
  >({});

  const fetching = useRef(false);

  useEffect(() => {
    let active = true;

    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("Keycloak yapılandırması eksik.");
      return;
    }

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    manager.getUser().then(user => {
      if (!active) return;

      if (!user || user.expired || !user.access_token) {
        setError("Kurumsal giriş gerekli.");
        return;
      }

      setToken(user.access_token);
    }).catch(() => {
      if (active) setError("Oturum okunamadı.");
    });

    return () => {active = false;};
  }, []);

  const refresh = useCallback(async () => {
    if (!token || fetching.current) return;

    fetching.current = true;

    try {
      const response = await fetch(
        "/api/v8/redis/operations",
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        }
      );

      if (!response.ok)
        throw Error(`Operations HTTP ${response.status}`);

      const result = await response.json() as Operations;

      setData(result);

      setHistory(previous => {
        const next = {...previous};

        for (const node of result.nodes) {
          if (!node.connected) continue;

          next[node.id] = [
            ...(next[node.id] ?? []),
            node.opsPerSecond
          ].slice(-36);
        }

        return next;
      });

      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "Redis operations okunamadı.");
    } finally {
      fetching.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    if (!auto) return;

    const timer = window.setInterval(
      () => void refresh(), 20000
    );

    return () => window.clearInterval(timer);
  }, [token, auto, refresh]);

  async function acknowledge(key: string) {
    if (!data?.canAcknowledge || busy) return;

    setBusy(key);

    try {
      const response = await fetch(
        `/api/v8/redis/operations/alerts/` +
        `${encodeURIComponent(key)}/ack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok)
        throw Error(`ACK HTTP ${response.status}`);

      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "ACK işlemi başarısız.");
    } finally {
      setBusy("");
    }
  }

  const nodes = (data?.nodes ?? []).filter(n =>
    filter === "all" || n.id === filter
  );

  const alerts = (data?.alerts ?? []).filter(a =>
    filter === "all" || a.nodeId === filter
  );

  const slow = (data?.slowlogs ?? []).filter(s =>
    filter === "all" || s.nodeId === filter
  );

  const activeNodes = data?.nodes.filter(
    n => n.connected
  ).length ?? 0;

  const unresolved = data?.alerts.filter(
    a => !a.acknowledgedBy
  ).length ?? 0;

  return (
    <main style={{
      maxWidth: 1510,
      margin: "30px auto",
      padding: "0 22px 70px",
      color: "#1b3948"
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <p style={{
            color: "#0f806d",
            fontSize: 12,
            letterSpacing: 1,
            fontWeight: 800
          }}>
            KORU ONE / REDIS / OPERATIONS
          </p>

          <h1 style={{margin: "9px 0", fontSize: 33}}>
            Alerts & Slowlog Center
          </h1>

          <p style={{color: "#718492", fontSize: 13}}>
            Canlı Redis sağlık kontrolleri,
            alarm onayları ve yavaş komut analizi.
          </p>
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexWrap: "wrap"
        }}>
          <Link href="/redis-storage">Storage ↗</Link>
          <button onClick={() => setAuto(x => !x)}>
            Auto {auto ? "ON" : "OFF"}
          </button>
          <button onClick={() => void refresh()}>
            Yenile
          </button>
        </div>
      </div>

      {error && <p role="alert" style={{
        background: "#fff1f1",
        color: "#a33842",
        padding: 14,
        borderRadius: 10
      }}>{error}</p>}

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(180px,1fr))",
        gap: 13,
        margin: "24px 0"
      }}>
        {[
          ["Connected Nodes",
           data ? `${activeNodes}/${data.nodes.length}` : "—"],
          ["Active Alerts", data?.alerts.length ?? "—"],
          ["Unacknowledged", data ? unresolved : "—"],
          ["Slowlog Entries", data?.slowlogs.length ?? "—"]
        ].map(([name,value]) => (
          <section style={surface} key={name}>
            <small style={{color: "#718492"}}>{name}</small>
            <strong style={{
              fontSize: 30,
              display: "block",
              marginTop: 11
            }}>
              {value}
            </strong>
          </section>
        ))}
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 20,
        alignItems: "center"
      }}>
        <label htmlFor="node-filter">Redis instance</label>
        <select
          id="node-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            padding: 11,
            borderRadius: 9,
            border: "1px solid #d6e3e7",
            background: "white"
          }}
        >
          <option value="all">Tüm erişilebilir node'lar</option>
          {data?.nodes.map(n => (
            <option key={n.id} value={n.id}>
              {labels[n.id] ?? n.id}
            </option>
          ))}
        </select>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(290px,1fr))",
        gap: 15
      }}>
        {nodes.map(node => {
          const memoryPercent = node.maxMemory > 0
            ? node.usedMemory / node.maxMemory * 100
            : 0;

          return (
            <section key={node.id} style={surface}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10
              }}>
                <h2 style={{fontSize: 20, margin: 0}}>
                  {labels[node.id] ?? node.id}
                </h2>
                <span style={{
                  color: node.connected
                    ? "#167c59" : "#ba4247",
                  fontSize: 12,
                  fontWeight: 750
                }}>
                  {node.connected ? "CONNECTED" : "OFFLINE"}
                </span>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 15,
                marginTop: 21,
                fontSize: 13
              }}>
                <div>
                  <small>Memory</small>
                  <strong style={{display:"block"}}>
                    {node.connected
                      ? mb(node.usedMemory)
                      : "—"}
                  </strong>
                </div>
                <div>
                  <small>Latency</small>
                  <strong style={{display:"block"}}>
                    {node.connected
                      ? `${fmt(node.pingMs)} ms`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <small>Clients</small>
                  <strong style={{display:"block"}}>
                    {node.connected ? node.clients : "—"}
                  </strong>
                </div>
                <div>
                  <small>OPS/sec</small>
                  <strong style={{display:"block"}}>
                    {node.connected
                      ? node.opsPerSecond : "—"}
                  </strong>
                </div>
              </div>

              {node.maxMemory > 0 && (
                <div style={{marginTop: 16}}>
                  <div style={{
                    display:"flex",
                    justifyContent:"space-between",
                    fontSize:12,
                    color:"#718492"
                  }}>
                    <span>Physical memory</span>
                    <span>{fmt(memoryPercent)}%</span>
                  </div>

                  <div style={{
                    height: 9,
                    background: "#e9eff2",
                    borderRadius: 15,
                    overflow: "hidden",
                    marginTop: 9
                  }}>
                    <div style={{
                      background: memoryPercent >= 95
                        ? "#c64850" : "#17816c",
                      height: "100%",
                      width:
                        `${Math.min(100,memoryPercent)}%`
                    }}/>
                  </div>
                </div>
              )}

              <div style={{marginTop: 15}}>
                <small style={{color:"#718492"}}>
                  Operations/sec · Recent samples
                </small>
                <Trend points={history[node.id] ?? []}/>
              </div>
            </section>
          );
        })}
      </div>

      <section style={{...surface, marginTop: 22}}>
        <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 21
        }}>
          <button
            onClick={() => setTab("alerts")}
            className={tab === "alerts" ? "" : "secondary"}
          >
            Alerts ({alerts.length})
          </button>

          <button
            onClick={() => setTab("slowlog")}
            className={tab === "slowlog" ? "" : "secondary"}
          >
            Slowlog ({slow.length})
          </button>
        </div>

        {tab === "alerts" ? (
          <>
            <h2>Live Alerts</h2>
            <p style={{
              fontSize: 12,
              color: "#718492"
            }}>
              Memory ≥80% uyarı, ≥95% kritik;
              blocked clients &gt;5 ve
              yüksek operasyon yükü izlenir.
            </p>

            <div style={{overflowX: "auto"}}>
              <table>
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Node</th>
                    <th>Alert</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(alert => (
                    <tr key={alert.key}>
                      <td style={{
                        color: alert.severity === "critical"
                          ? "#b93b47" : "#aa752b",
                        fontWeight: 800
                      }}>
                        {alert.severity.toUpperCase()}
                      </td>
                      <td>{labels[alert.nodeId]}</td>
                      <td>
                        <strong>{alert.title}</strong>
                        <div style={{
                          fontSize: 12,
                          color: "#718492",
                          marginTop: 5
                        }}>
                          {alert.detail}
                        </div>
                      </td>
                      <td>
                        {alert.acknowledgedBy
                          ? `ACK · ${alert.acknowledgedBy}`
                          : "OPEN"}
                      </td>
                      <td>
                        {data?.canAcknowledge &&
                         !alert.acknowledgedBy && (
                          <button
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void acknowledge(alert.key)}
                          >
                            {busy === alert.key
                              ? "Kaydediliyor"
                              : "Acknowledge"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {alerts.length === 0 && (
              <p style={{color:"#167957"}}>
                Mevcut eşiklerle aktif alarm bulunmuyor.
              </p>
            )}
          </>
        ) : (
          <>
            <h2>Redis Slowlog</h2>
            <p style={{
              fontSize: 12,
              color: "#718492"
            }}>
              Komut adı ve süre gösterilir.
              Argümanlar, key değerleri, istemci adresi
              ve kimlik bilgileri görüntülenmez.
            </p>

            <div style={{overflowX:"auto"}}>
              <table>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Time</th>
                    <th>Command</th>
                    <th>Duration</th>
                    <th>Log ID</th>
                  </tr>
                </thead>
                <tbody>
                  {slow.map(s => (
                    <tr key={`${s.nodeId}:${s.id}`}>
                      <td>{labels[s.nodeId]}</td>
                      <td>
                        {new Date(s.time)
                          .toLocaleString("tr-TR")}
                      </td>
                      <td><code>{s.command}</code></td>
                      <td>
                        {fmt(s.durationUs / 1000)} ms
                      </td>
                      <td>{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {slow.length === 0 && (
              <p style={{color:"#718492"}}>
                Slowlog kaydı yok veya bu hesaba
                Slowlog okuma yetkisi verilmemiş.
              </p>
            )}
          </>
        )}
      </section>

      <p style={{
        color: "#718492",
        fontSize: 12,
        lineHeight: 1.7,
        marginTop: 20
      }}>
        Alarmlar bu sayfa yenilendiğinde değerlendirilir;
        sürekli çalışan bir arka plan izleyicisi henüz yoktur.
        Acknowledge alarmı çözmez, yalnızca görüldü
        olarak işaretler. Grafik geçmişi bu tarayıcı
        oturumu boyunca tutulur.
      </p>
    </main>
  );
}
