"use client";

import {
  useCallback, useEffect, useMemo, useState
} from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

type Range = "1h" | "24h" | "7d";
type Metric = "memoryBytes" | "opsPerSecond" | "latencyMs";

type Snapshot = {
  nodeId: string;
  sampleAt: string;
  connected: boolean;
  memoryBytes: number;
  maxMemoryBytes: number;
  clients: number;
  opsPerSecond: number;
  latencyMs: number;
  hitRatio: number;
};

type Point = {
  nodeId: string;
  time: string;
  memoryBytes: number;
  opsPerSecond: number;
  latencyMs: number;
  connected: boolean;
};

type Alert = {
  nodeId: string;
  ruleId: string;
  severity: string;
  title: string;
  detail: string;
  status: "open" | "acknowledged" | "resolved";
  firstSeen: string;
  lastSeen: string;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
};

type Event = {
  nodeId: string;
  ruleId: string;
  action: string;
  actor: string;
  happenedAt: string;
};

type Monitoring = {
  range: Range;
  latest: Snapshot[];
  points: Point[];
  alerts: Alert[];
  events: Event[];
  visibleNodes: string[];
  canAcknowledge: boolean;
  workerIntervalSeconds: number;
  checkedAt: string;
};

const names: Record<string, string> = {
  "redis-cache": "Redis Cache",
  "redis-streams": "Redis Streams"
};

const colors = {
  ink: "#203b4c",
  muted: "#728694",
  green: "#147d68",
  border: "#dfe8ed",
  danger: "#b9484e",
  amber: "#ad7425"
};

const surface: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${colors.border}`,
  borderRadius: 15,
  padding: 21,
  boxShadow: "0 3px 18px rgba(22,48,63,.035)"
};

const format = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(value);

const mb = (value: number) =>
  `${format(value / 1048576)} MB`;

const dateLabel = (value: string) =>
  new Date(value).toLocaleString("tr-TR");

function SeriesChart({
  points, metric
}: {
  points: Point[];
  metric: Metric;
}) {
  const ordered = [...points]
    .filter(p => p.connected)
    .sort((a, b) =>
      new Date(a.time).getTime() -
      new Date(b.time).getTime());

  if (ordered.length < 2)
    return (
      <div style={{
        height: 230,
        display: "grid",
        placeItems: "center",
        color: colors.muted,
        background: "#f7fafb",
        borderRadius: 10
      }}>
        Grafik için en az iki ölçüm gerekiyor.
      </div>
    );

  const values = ordered.map(p => p[metric]);

  const max = Math.max(...values, 1);

  const coordinates = values.map((value, i) => {
    const x = 18 + i / (values.length - 1) * 762;
    const y = 218 - value / max * 182;

    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const last = values[values.length - 1];

  return (
    <div>
      <svg
        viewBox="0 0 800 245"
        preserveAspectRatio="none"
        width="100%"
        height="250"
        role="img"
        aria-label="Redis geçmiş performans grafiği"
        style={{
          background: "#f7fafb",
          borderRadius: 11
        }}
      >
        {[36, 127, 218].map(y => (
          <line
            key={y}
            x1="18" x2="780" y1={y} y2={y}
            stroke="#dae5e9"
            strokeDasharray="4 6"
          />
        ))}
        <polyline
          points={coordinates}
          fill="none"
          stroke="#16836d"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        color: colors.muted,
        fontSize: 12,
        marginTop: 12
      }}>
        <span>{dateLabel(ordered[0].time)}</span>
        <strong>
          Son değer:{" "}
          {metric === "memoryBytes"
            ? mb(last)
            : metric === "latencyMs"
              ? `${format(last)} ms`
              : `${format(last)} ops/sn`}
        </strong>
        <span>
          {dateLabel(
            ordered[ordered.length - 1].time)}
        </span>
      </div>
    </div>
  );
}

export default function RedisMonitoringPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Monitoring | null>(null);

  const [range, setRange] = useState<Range>("1h");
  const [node, setNode] = useState("redis-cache");
  const [metric, setMetric] =
    useState<Metric>("opsPerSecond");

  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [auto, setAuto] = useState(true);

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
        setError("Kurumsal oturum gerekli.");
        return;
      }

      setToken(user.access_token);
    }).catch(() => {
      if (active) setError("Oturum okunamadı.");
    });

    return () => {active = false;};
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(
        `/api/v8/redis/monitoring?range=${range}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        }
      );

      if (!response.ok)
        throw Error(
          `Monitoring API: HTTP ${response.status}`);

      const result =
        await response.json() as Monitoring;

      setData(result);

      setNode(previous =>
        result.visibleNodes.includes(previous)
          ? previous
          : (result.visibleNodes[0] ?? "")
      );

      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "Monitoring history okunamadı.");
    }
  }, [token, range]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    if (!auto) return;

    const timer = window.setInterval(
      () => void refresh(), 30000
    );

    return () => window.clearInterval(timer);
  }, [token, auto, refresh]);

  const selectedPoints = useMemo(() =>
    (data?.points ?? []).filter(p => p.nodeId === node),
    [data, node]
  );

  const active = (data?.alerts ?? []).filter(
    a => a.status !== "resolved"
  );

  const unacknowledged = active.filter(
    a => a.status === "open"
  ).length;

  const connected = (data?.latest ?? []).filter(
    n => n.connected
  ).length;

  const lastSample = data?.latest.length
    ? data.latest.reduce(
        (latest, item) =>
          new Date(item.sampleAt).getTime() >
          new Date(latest).getTime()
            ? item.sampleAt : latest,
        data.latest[0].sampleAt
      )
    : null;

  async function acknowledge(alert: Alert) {
    if (!data?.canAcknowledge ||
        alert.status !== "open" || busy)
      return;

    const key = `${alert.nodeId}:${alert.ruleId}`;
    setBusy(key);
    setError("");

    try {
      const response = await fetch(
        `/api/v8/redis/monitoring/alerts/` +
        `${alert.nodeId}/${alert.ruleId}/ack`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok)
        throw Error(
          `Alarm onayı HTTP ${response.status}`);

      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "Alarm onaylanamadı.");
    } finally {
      setBusy("");
    }
  }

  const kpis = [
    {
      label: "Connected Nodes",
      value: data
        ? `${connected}/${data.visibleNodes.length}`
        : "—",
      note: "Son ölçülen durum"
    },
    {
      label: "Active Alerts",
      value: data ? active.length : "—",
      note: "Open + Acknowledged"
    },
    {
      label: "Awaiting ACK",
      value: data ? unacknowledged : "—",
      note: "Onay bekleyen alarmlar"
    },
    {
      label: "Metric Samples",
      value: data ? data.points.length : "—",
      note: `${range} grafik veri noktası`
    }
  ];

  return (
    <main style={{
      maxWidth: 1510,
      margin: "30px auto",
      padding: "0 22px 80px",
      color: colors.ink
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 18
      }}>
        <div>
          <p style={{
            color: colors.green,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1.2
          }}>
            KORU ONE / REDIS / MONITORING ENGINE
          </p>

          <h1 style={{
            margin: "8px 0",
            fontSize: "clamp(27px,3vw,37px)"
          }}>
            Monitoring & Alert Intelligence
          </h1>

          <p style={{
            color: colors.muted,
            fontSize: 13
          }}>
            Kalıcı Redis metrikleri, otomatik alarm
            değerlendirmesi ve operasyon geçmişi.
          </p>
        </div>

        <div style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap"
        }}>
          <Link href="/redis-operations">
            Slowlog ↗
          </Link>
          <button onClick={() => setAuto(!auto)}>
            Auto {auto ? "ON" : "OFF"}
          </button>
          <button onClick={() => void refresh()}>
            Yenile
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" style={{
          borderRadius: 10,
          background: "#fff0f0",
          color: colors.danger,
          padding: 14
        }}>
          {error}
        </p>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(190px,1fr))",
        gap: 14,
        margin: "25px 0"
      }}>
        {kpis.map(k => (
          <section key={k.label} style={surface}>
            <small style={{color: colors.muted}}>
              {k.label}
            </small>
            <strong style={{
              display: "block",
              fontSize: 30,
              marginTop: 12
            }}>
              {k.value}
            </strong>
            <p style={{
              color: colors.muted,
              fontSize: 12
            }}>
              {k.note}
            </p>
          </section>
        ))}
      </div>

      <section style={surface}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center"
        }}>
          <div>
            <h2 style={{margin: 0, fontSize: 20}}>
              Historical Performance
            </h2>
            <p style={{
              fontSize: 12,
              color: colors.muted
            }}>
              PostgreSQL tabanlı Redis zaman serisi
            </p>
          </div>

          <div style={{
            display: "flex",
            gap: 7,
            flexWrap: "wrap"
          }}>
            {(["1h","24h","7d"] as Range[])
              .map(value => (
                <button
                  type="button"
                  key={value}
                  className={
                    range === value ? "" : "secondary"
                  }
                  onClick={() => setRange(value)}
                >
                  {value}
                </button>
              ))}
          </div>
        </div>

        <div style={{
          display: "flex",
          gap: 11,
          flexWrap: "wrap",
          margin: "20px 0"
        }}>
          <select
            value={node}
            onChange={e => setNode(e.target.value)}
            style={{
              padding: 11,
              border: `1px solid ${colors.border}`,
              borderRadius: 9
            }}
          >
            {data?.visibleNodes.map(n => (
              <option key={n} value={n}>
                {names[n] ?? n}
              </option>
            ))}
          </select>

          <select
            value={metric}
            onChange={e =>
              setMetric(e.target.value as Metric)}
            style={{
              padding: 11,
              border: `1px solid ${colors.border}`,
              borderRadius: 9
            }}
          >
            <option value="opsPerSecond">
              Operations/sec
            </option>
            <option value="memoryBytes">
              Memory Usage
            </option>
            <option value="latencyMs">
              Ping Latency
            </option>
          </select>
        </div>

        <SeriesChart
          points={selectedPoints}
          metric={metric}
        />

        <p style={{
          color: colors.muted,
          fontSize: 12,
          marginTop: 16
        }}>
          Son kaydedilen örnek:{" "}
          {lastSample ? dateLabel(lastSample) : "Henüz yok"}
          {" · "}
          Ölçüm sıklığı: 60 saniye.
        </p>
      </section>

      <section style={{
        ...surface,
        marginTop: 21
      }}>
        <h2>Redis Fleet · Latest Measurements</h2>

        <div style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(280px,1fr))",
          gap: 13,
          marginTop: 18
        }}>
          {data?.latest.map(snapshot => (
            <div
              key={snapshot.nodeId}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 17
              }}
            >
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 9
              }}>
                <strong>{names[snapshot.nodeId]}</strong>
                <span style={{
                  color: snapshot.connected
                    ? colors.green : colors.danger,
                  fontSize: 11,
                  fontWeight: 800
                }}>
                  {snapshot.connected
                    ? "CONNECTED" : "OFFLINE"}
                </span>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 17,
                marginTop: 19,
                fontSize: 13
              }}>
                <div>
                  <small>Memory</small>
                  <strong style={{display:"block"}}>
                    {snapshot.connected
                      ? mb(snapshot.memoryBytes) : "—"}
                  </strong>
                </div>
                <div>
                  <small>OPS/sec</small>
                  <strong style={{display:"block"}}>
                    {snapshot.connected
                      ? format(snapshot.opsPerSecond) : "—"}
                  </strong>
                </div>
                <div>
                  <small>Latency</small>
                  <strong style={{display:"block"}}>
                    {snapshot.connected
                      ? `${format(snapshot.latencyMs)} ms`
                      : "—"}
                  </strong>
                </div>
                <div>
                  <small>Clients</small>
                  <strong style={{display:"block"}}>
                    {snapshot.connected
                      ? snapshot.clients : "—"}
                  </strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{
        ...surface,
        marginTop: 21
      }}>
        <h2>Alert Lifecycle</h2>
        <p style={{
          color: colors.muted,
          fontSize: 12
        }}>
          OPEN → ACKNOWLEDGED → RESOLVED.
          Sorun ortadan kalkınca Worker alarmı
          otomatik çözüldü olarak işaretler.
        </p>

        <div style={{overflowX:"auto", marginTop: 18}}>
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Node</th>
                <th>Rule</th>
                <th>Status</th>
                <th>Son Görülme</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {data?.alerts.map(alert => (
                <tr
                  key={`${alert.nodeId}:${alert.ruleId}`}
                >
                  <td style={{
                    color: alert.severity === "critical"
                      ? colors.danger : colors.amber,
                    fontWeight: 800
                  }}>
                    {alert.severity.toUpperCase()}
                  </td>
                  <td>{names[alert.nodeId]}</td>
                  <td>
                    <strong>{alert.title}</strong>
                    <div style={{
                      color: colors.muted,
                      fontSize: 11,
                      marginTop: 5
                    }}>
                      {alert.detail}
                    </div>
                  </td>
                  <td>
                    <strong style={{
                      color: alert.status === "resolved"
                        ? colors.green
                        : alert.status === "open"
                          ? colors.danger
                          : colors.amber
                    }}>
                      {alert.status.toUpperCase()}
                    </strong>
                    {alert.acknowledgedBy && (
                      <div style={{
                        fontSize: 11,
                        color: colors.muted
                      }}>
                        {alert.acknowledgedBy}
                      </div>
                    )}
                  </td>
                  <td>{dateLabel(alert.lastSeen)}</td>
                  <td>
                    {alert.status === "open" &&
                     data?.canAcknowledge && (
                      <button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void acknowledge(alert)}
                      >
                        {busy ===
                          `${alert.nodeId}:${alert.ruleId}`
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

        {data && data.alerts.length === 0 && (
          <p style={{color: colors.green}}>
            Henüz kayıtlı alarm yok.
          </p>
        )}
      </section>

      <section style={{
        ...surface,
        marginTop: 21
      }}>
        <h2>Security & Operations Event History</h2>

        <p style={{
          color: colors.muted,
          fontSize: 12
        }}>
          Son 50 alarm tetiklenme, onaylanma
          ve çözülme olayı.
        </p>

        <div style={{overflowX:"auto", marginTop: 18}}>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Redis Node</th>
                <th>Rule</th>
                <th>Actor</th>
                <th>Time</th>
              </tr>
            </thead>

            <tbody>
              {data?.events.map((event,i) => (
                <tr key={i}>
                  <td>
                    <strong>{event.action}</strong>
                  </td>
                  <td>{names[event.nodeId]}</td>
                  <td>{event.ruleId}</td>
                  <td>{event.actor}</td>
                  <td>{dateLabel(event.happenedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.events.length === 0 && (
          <p style={{color: colors.muted}}>
            Henüz alarm yaşam döngüsü olayı oluşmadı.
          </p>
        )}
      </section>

      <p style={{
        fontSize: 12,
        color: colors.muted,
        lineHeight: 1.7,
        marginTop: 23
      }}>
        İzleme .NET backend çalışırken otomatik devam eder.
        Backend durursa Worker da durur. Grafikler kurulum
        öncesine ait verileri içermez; 7 günlük geçmiş
        zamanla birikir. Bu sürümde harici bildirim
        gönderimi bulunmaz.
      </p>
    </main>
  );
}
