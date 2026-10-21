"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

type Obj = Record<string, unknown>;

type RedisNode = {
  id: string;
  name: string;
  host: string;
  port: number | string;
  role: string;
};

type Snapshot = {
  id: string;
  time: number;
  connected: boolean;
  version: string;
  role: string;
  memory: number;
  maxMemory: number;
  rss: number;
  ops: number;
  clients: number;
  keys: number;
  hits: number;
  misses: number;
  hitRatio: number;
  evictions: number;
  expired: number;
  uptime: number;
  fragmentation: number;
  latency: number;
  cpu: number;
  raw: Obj;
};

type HistoryPoint = {
  time: number;
  ops: number;
  memory: number;
  clients: number;
  hitRatio: number;
};

type FleetState = Record<string, Snapshot>;
type FleetHistory = Record<string, HistoryPoint[]>;

const REFRESH_MS = 5000;
const MAX_HISTORY = 60;

const colors = {
  ink: "#172b40",
  secondary: "#64748b",
  accent: "#087e78",
  soft: "#e7f4f1",
  border: "#dce4e9",
  danger: "#bd3f46",
  warning: "#a36b16",
  good: "#167a59",
  bg: "#f6f9fb",
  white: "#ffffff"
};

function asObject(value: unknown): Obj {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value as Obj
      : {};
}

function asText(value: unknown, fallback = "—"): string {
  if (value === undefined || value === null || value === "")
    return fallback;
  return String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const result = Number(value.trim());
    return Number.isFinite(result) ? result : 0;
  }

  return 0;
}

function findValue(data: Obj, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null)
      return data[key];
  }
  return undefined;
}

function flattenPayload(value: unknown): Obj {
  const root = asObject(value);

  const inner = asObject(
    root.data ??
    root.metrics ??
    root.result ??
    root.info
  );

  return { ...inner, ...root };
}

function normalizeNodes(payload: unknown): RedisNode[] {
  const root = asObject(payload);

  const list = Array.isArray(payload)
    ? payload
    : root.nodes ?? root.data ?? root.items ?? [];

  if (!Array.isArray(list)) return [];

  return list.flatMap((item): RedisNode[] => {
    const n = asObject(item);
    if (typeof n.id !== "string" || !n.id) return [];

    return [{
      id: n.id,
      name: asText(n.name ?? n.displayName, n.id),
      host: asText(n.host, "—"),
      port: typeof n.port === "number" || typeof n.port === "string"
        ? n.port
        : "—",
      role: asText(n.role ?? n.type, "Redis")
    }];
  });
}

function normalizeSnapshot(
  id: string,
  payload: unknown
): Snapshot {
  const d = flattenPayload(payload);

  const hits = asNumber(findValue(
    d, "hits", "keyspace_hits", "keyspaceHits"
  ));

  const misses = asNumber(findValue(
    d, "misses", "keyspace_misses", "keyspaceMisses"
  ));

  const total = hits + misses;

  const memory = asNumber(findValue(
    d, "memoryBytes", "usedMemory", "used_memory", "memory"
  ));

  const rss = asNumber(findValue(
    d, "memoryRssBytes", "used_memory_rss", "memoryRss"
  ));

  const explicitRatio = findValue(
    d, "hitRatio", "hitRate", "cacheHitRatio"
  );

  const ratio = explicitRatio === undefined
    ? total > 0 ? hits / total * 100 : 0
    : asNumber(explicitRatio);

  const connectedValue = findValue(
    d, "connected", "isConnected"
  );

  return {
    id,
    time: Date.now(),
    connected: connectedValue === true ||
      connectedValue === "true",
    version: asText(findValue(
      d, "version", "redisVersion", "redis_version"
    )),
    role: asText(findValue(
      d, "role", "redisRole"
    )),
    memory,
    maxMemory: asNumber(findValue(
      d, "maxMemoryBytes", "maxmemory", "maxMemory"
    )),
    rss,
    ops: asNumber(findValue(
      d,
      "operationsPerSecond",
      "instantaneous_ops_per_sec",
      "opsPerSecond",
      "ops"
    )),
    clients: asNumber(findValue(
      d, "clients", "connected_clients", "connectedClients"
    )),
    keys: asNumber(findValue(
      d, "totalKeys", "dbSize", "keys", "keyCount"
    )),
    hits,
    misses,
    hitRatio: Math.max(0, Math.min(100, ratio)),
    evictions: asNumber(findValue(
      d, "evictions", "evicted_keys", "evictedKeys"
    )),
    expired: asNumber(findValue(
      d, "expired", "expired_keys", "expiredKeys"
    )),
    uptime: asNumber(findValue(
      d, "uptimeSeconds", "uptime_in_seconds", "uptime"
    )),
    fragmentation: asNumber(findValue(
      d, "fragmentation", "mem_fragmentation_ratio"
    )),
    latency: asNumber(findValue(
      d, "latencyMs", "pingMs", "latency"
    )),
    cpu: asNumber(findValue(
      d, "used_cpu_sys", "cpu"
    )),
    raw: d
  };
}

function compact(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(value);
}

function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  );

  return `${compact(value / Math.pow(1024, exponent))} ${units[exponent]}`;
}

function percent(value: number): string {
  return `${compact(value)}%`;
}

function statusLabel(value: boolean): string {
  return value ? "CONNECTED" : "DISCONNECTED";
}

const cardStyle: React.CSSProperties = {
  background: colors.white,
  border: `1px solid ${colors.border}`,
  borderRadius: 15,
  padding: 19,
  minWidth: 0,
  boxShadow: "0 2px 10px rgba(20,45,65,.03)"
};

function Sparkline({
  values,
  color = colors.accent
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2) {
    return (
      <div style={{
        height: 92,
        display: "grid",
        placeItems: "center",
        color: colors.secondary,
        fontSize: 13
      }}>
        Grafik için veri birikiyor...
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  const points = values.map((v, i) => {
    const x = 5 + i / (values.length - 1) * 290;
    const y = 82 - ((v - min) / range) * 72;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg
      viewBox="0 0 300 92"
      preserveAspectRatio="none"
      width="100%"
      height="92"
      role="img"
      aria-label="Son örneklerin çizgi grafiği"
    >
      <line
        x1="0" y1="87" x2="300" y2="87"
        stroke={colors.border}
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricCard({
  title,
  value,
  detail,
  values,
  color
}: {
  title: string;
  value: string;
  detail?: string;
  values?: number[];
  color?: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={{
        color: colors.secondary,
        fontSize: 13,
        marginBottom: 11
      }}>
        {title}
      </div>

      <div style={{
        color: colors.ink,
        fontSize: 26,
        fontWeight: 750,
        letterSpacing: "-.7px"
      }}>
        {value}
      </div>

      {detail && (
        <p style={{
          margin: "7px 0 0",
          fontSize: 12,
          color: colors.secondary
        }}>
          {detail}
        </p>
      )}

      {values && (
        <div style={{ marginTop: 12 }}>
          <Sparkline values={values} color={color} />
        </div>
      )}
    </div>
  );
}

function AlertLine({
  severity,
  children
}: {
  severity: "warning" | "critical";
  children: React.ReactNode;
}) {
  const color = severity === "critical"
    ? colors.danger
    : colors.warning;

  return (
    <div style={{
      padding: "11px 13px",
      marginBottom: 9,
      borderLeft: `3px solid ${color}`,
      background: severity === "critical"
        ? "#fff2f2"
        : "#fff9ed",
      borderRadius: 8,
      fontSize: 13,
      color: colors.ink
    }}>
      <strong style={{ color }}>
        {severity === "critical" ? "KRİTİK" : "UYARI"}
      </strong>
      {" · "}
      {children}
    </div>
  );
}

export default function RedisFleetPage() {
  const [token, setToken] = useState("");
  const [nodes, setNodes] = useState<RedisNode[]>([]);
  const [snapshots, setSnapshots] = useState<FleetState>({});
  const [history, setHistory] = useState<FleetHistory>({});
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("OIDC authority bulunamadi.");
      return;
    }

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    manager.getUser()
      .then(user => {
        if (!active) return;
        if (!user || user.expired || !user.access_token) {
          setError("Lutfen kurumsal hesabinla giris yap.");
          return;
        }
        setToken(user.access_token);
      })
      .catch(() => {
        if (active) setError("Oturum bilgisi okunamadi.");
      });

    return () => { active = false; };
  }, []);

  const request = useCallback(async (path: string) => {
    const response = await fetch(
      "/api/v7/redis" + path,
      {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `${path}: HTTP ${response.status}`
      );
    }

    return response.json() as Promise<unknown>;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || inFlight.current) return;

    inFlight.current = true;
    setBusy(true);

    try {
      const nodePayload = await request("/nodes");
      const list = normalizeNodes(nodePayload);

      setNodes(list);

      setSelected(previous =>
        list.some(n => n.id === previous)
          ? previous
          : (list[0]?.id ?? "")
      );

      const results = await Promise.allSettled(
        list.map(n =>
          request(`/nodes/${encodeURIComponent(n.id)}/metrics`)
        )
      );

      const next: FleetState = {};
      const points: Record<string, HistoryPoint> = {};
      const failures: string[] = [];

      results.forEach((result, index) => {
        const node = list[index];

        if (result.status === "fulfilled") {
          const snapshot = normalizeSnapshot(
            node.id,
            result.value
          );

          next[node.id] = snapshot;

          points[node.id] = {
            time: snapshot.time,
            ops: snapshot.ops,
            memory: snapshot.memory,
            clients: snapshot.clients,
            hitRatio: snapshot.hitRatio
          };
        } else {
          failures.push(node.name);

          next[node.id] = normalizeSnapshot(
            node.id,
            { connected: false }
          );
        }
      });

      setSnapshots(next);

      setHistory(previous => {
        const updated = { ...previous };

        for (const [id, point] of Object.entries(points)) {
          updated[id] = [
            ...(updated[id] ?? []),
            point
          ].slice(-MAX_HISTORY);
        }

        return updated;
      });

      setLastUpdate(new Date());

      if (failures.length) {
        setError(
          `Metrikleri okunamayan node: ${failures.join(", ")}`
        );
      } else {
        setError("");
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Redis Control API hatasi."
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [token, request]);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  useEffect(() => {
    if (!token || !autoRefresh) return;

    const timer = setInterval(
      () => void refresh(),
      REFRESH_MS
    );

    return () => clearInterval(timer);
  }, [token, autoRefresh, refresh]);

  const selectedNode = nodes.find(n => n.id === selected);
  const current = snapshots[selected];
  const samples = history[selected] ?? [];

  const connectedNodes = nodes.filter(
    n => snapshots[n.id]?.connected
  ).length;

  const totalMemory = nodes.reduce(
    (sum, n) => sum + (snapshots[n.id]?.memory ?? 0),
    0
  );

  const totalOps = nodes.reduce(
    (sum, n) => sum + (snapshots[n.id]?.ops ?? 0),
    0
  );

  const totalClients = nodes.reduce(
    (sum, n) => sum + (snapshots[n.id]?.clients ?? 0),
    0
  );

  const alerts = useMemo(() => {
    const result: {
      severity: "warning" | "critical";
      message: string;
    }[] = [];

    for (const node of nodes) {
      const s = snapshots[node.id];
      if (!s) continue;

      if (!s.connected) {
        result.push({
          severity: "critical",
          message: `${node.name}: Redis baglantisi yok veya metrik okunamiyor.`
        });
        continue;
      }

      if (s.maxMemory > 0) {
        const usage = s.memory / s.maxMemory * 100;

        if (usage >= 90) {
          result.push({
            severity: "critical",
            message: `${node.name}: Bellek kullanimi ${compact(usage)}%.`
          });
        } else if (usage >= 75) {
          result.push({
            severity: "warning",
            message: `${node.name}: Bellek kullanimi ${compact(usage)}%.`
          });
        }
      }

      if (s.evictions > 0) {
        result.push({
          severity: "warning",
          message: `${node.name}: Redis acilisindan beri ${compact(s.evictions)} eviction.`
        });
      }

      if (s.latency >= 100) {
        result.push({
          severity: "warning",
          message: `${node.name}: Son olcum latency ${compact(s.latency)} ms.`
        });
      }
    }

    return result;
  }, [nodes, snapshots]);

  function exportReport() {
    const report = {
      product: "KORU ONE Redis Fleet Intelligence",
      generatedAt: new Date().toISOString(),
      note: "Anlik monitoring raporu; secret/key degerleri dahil degildir.",
      nodes: nodes.map(node => {
        const s = snapshots[node.id];

        return {
          id: node.id,
          name: node.name,
          host: node.host,
          port: node.port,
          connected: s?.connected ?? false,
          version: s?.version ?? "unknown",
          role: s?.role ?? "unknown",
          memoryBytes: s?.memory ?? 0,
          maxMemoryBytes: s?.maxMemory ?? 0,
          ops: s?.ops ?? 0,
          clients: s?.clients ?? 0,
          keys: s?.keys ?? 0,
          hitRatio: s?.hitRatio ?? 0,
          evictions: s?.evictions ?? 0
        };
      })
    };

    const blob = new Blob(
      [JSON.stringify(report, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "koru-redis-fleet-report.json";
    link.click();

    URL.revokeObjectURL(url);
  }

  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14
  };

  const button: React.CSSProperties = {
    borderRadius: 9,
    padding: "10px 15px",
    cursor: "pointer",
    border: `1px solid ${colors.border}`,
    background: colors.white,
    color: colors.ink,
    fontWeight: 600
  };

  return (
    <main style={{
      maxWidth: 1420,
      margin: "0 auto",
      padding: "30px 22px 70px",
      color: colors.ink
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 15,
        marginBottom: 25
      }}>
        <div>
          <p style={{
            color: colors.accent,
            fontSize: 12,
            fontWeight: 750,
            letterSpacing: 1.1
          }}>
            KORU ONE / REDIS CONTROL PLANE
          </p>

          <h1 style={{
            fontSize: "clamp(25px, 3vw, 37px)",
            letterSpacing: "-1px",
            margin: "8px 0"
          }}>
            Redis Fleet Intelligence
          </h1>

          <p style={{
            color: colors.secondary,
            margin: 0
          }}>
            Multi-node monitoring, operasyonel görünürlük
            ve merkezi sağlık analizi
          </p>
        </div>

        <div style={{
          display: "flex",
          gap: 9,
          flexWrap: "wrap"
        }}>
          <Link href="/redis-diagnostics"
            style={button}>
            Redis Diagnostics
          </Link>

          <Link href="/redis-intelligence"
            style={button}>
            Redis Intelligence
          </Link>

          <button
            style={button}
            onClick={() => setAutoRefresh(x => !x)}
          >
            Auto Refresh: {autoRefresh ? "ON" : "OFF"}
          </button>

          <button
            style={button}
            onClick={() => void refresh()}
            disabled={busy}
          >
            {busy ? "Okunuyor..." : "Yenile"}
          </button>

          <button
            style={button}
            onClick={exportReport}
            disabled={!nodes.length}
          >
            JSON Rapor
          </button>
        </div>
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 20,
        fontSize: 13,
        color: colors.secondary
      }}>
        <span style={{
          padding: "6px 11px",
          borderRadius: 99,
          background: colors.soft,
          color: colors.good,
          fontWeight: 750
        }}>
          READ ONLY CONTROL
        </span>

        <span>Refresh: {REFRESH_MS / 1000} saniye</span>

        <span>
          Son veri: {lastUpdate
            ? lastUpdate.toLocaleTimeString("tr-TR")
            : "Bekleniyor"}
        </span>
      </div>

      {error && (
        <div style={{
          ...cardStyle,
          borderColor: "#e6adad",
          marginBottom: 17,
          background: "#fff8f8"
        }}>
          <strong style={{ color: colors.danger }}>
            Control API Uyarısı
          </strong>
          <p style={{ marginBottom: 0 }}>{error}</p>
          <p style={{
            fontSize: 12,
            color: colors.secondary
          }}>
            HTTP 401/403 durumunda Keycloak token audience
            ve rol yetkilerini kontrol edin.
          </p>
        </div>
      )}

      <section style={{
        ...grid,
        marginBottom: 24
      }}>
        <MetricCard
          title="Toplam Redis Node"
          value={compact(nodes.length)}
          detail="Control API envanteri"
        />

        <MetricCard
          title="Bağlı Node"
          value={`${connectedNodes}/${nodes.length}`}
          detail="Son metrik kontrolüne göre"
        />

        <MetricCard
          title="Toplam Redis Memory"
          value={bytes(totalMemory)}
          detail="Bağlı node bellek toplamı"
        />

        <MetricCard
          title="Toplam Operations / sec"
          value={compact(totalOps)}
          detail="Node anlık OPS toplamı"
        />

        <MetricCard
          title="Toplam Client"
          value={compact(totalClients)}
          detail="Redis bağlantı sayısı"
        />
      </section>

      <section style={{
        ...cardStyle,
        marginBottom: 23
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 17
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              Redis Node Inventory
            </h2>
            <p style={{
              color: colors.secondary,
              fontSize: 13,
              marginBottom: 0
            }}>
              Node seçerek gerçek zamanlı analizini incele.
            </p>
          </div>
          <span style={{
            fontSize: 12,
            color: colors.secondary
          }}>
            {nodes.length} kayıt
          </span>
        </div>

        <div style={grid}>
          {nodes.map(node => {
            const s = snapshots[node.id];
            const active = selected === node.id;

            return (
              <button
                key={node.id}
                onClick={() => setSelected(node.id)}
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  borderRadius: 13,
                  padding: 17,
                  background: active
                    ? colors.soft
                    : colors.bg,
                  border: active
                    ? `2px solid ${colors.accent}`
                    : `1px solid ${colors.border}`,
                  color: colors.ink
                }}
              >
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 10
                }}>
                  <span style={{
                    color: colors.secondary,
                    fontSize: 12
                  }}>
                    NODE · {node.id}
                  </span>
                  <span style={{
                    color: s?.connected
                      ? colors.good
                      : colors.danger,
                    fontSize: 11,
                    fontWeight: 750
                  }}>
                    {s
                      ? statusLabel(s.connected)
                      : "LOADING"}
                  </span>
                </div>

                <strong style={{ fontSize: 19 }}>
                  {node.name}
                </strong>

                <p style={{
                  color: colors.secondary,
                  fontSize: 13
                }}>
                  {node.host}:{node.port}
                </p>

                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  marginTop: 16
                }}>
                  <span>RAM: {bytes(s?.memory ?? 0)}</span>
                  <span>OPS: {compact(s?.ops ?? 0)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {!nodes.length && (
          <p style={{ color: colors.secondary }}>
            Henüz Redis node envanteri alınamadı.
          </p>
        )}
      </section>

      <section style={{
        ...cardStyle,
        marginBottom: 23
      }}>
        <h2 style={{
          marginTop: 0,
          fontSize: 20
        }}>
          Health & Alerts
        </h2>

        <p style={{
          color: colors.secondary,
          fontSize: 13
        }}>
          Bağlantı, bellek kapasitesi, latency
          ve birikmiş eviction göstergeleri.
        </p>

        {alerts.length === 0 ? (
          <p style={{
            color: colors.good,
            fontWeight: 600
          }}>
            {nodes.length && connectedNodes === nodes.length
              ? "Tanımlı eşikleri aşan uyarı bulunamadı."
              : "Sağlık analizi için node verileri bekleniyor."}
          </p>
        ) : alerts.map((a, index) => (
          <AlertLine
            key={`${index}-${a.message}`}
            severity={a.severity}
          >
            {a.message}
          </AlertLine>
        ))}

        <p style={{
          fontSize: 12,
          color: colors.secondary,
          marginBottom: 0
        }}>
          Bu uyarılar tarayıcıda hesaplanır; henüz
          kalıcı alarm veya bildirim servisi değildir.
        </p>
      </section>

      {selectedNode && current && (
        <>
          <section style={{
            marginBottom: 22
          }}>
            <h2 style={{ fontSize: 22 }}>
              {selectedNode.name} · Node Detail
            </h2>

            <p style={{
              color: colors.secondary,
              fontSize: 13
            }}>
              {selectedNode.host}:{selectedNode.port}
              {" · "}
              Redis {current.version}
              {" · "}
              Role: {current.role}
            </p>

            <div style={grid}>
              <MetricCard
                title="Used Memory"
                value={bytes(current.memory)}
                detail={
                  current.maxMemory
                    ? `Limit: ${bytes(current.maxMemory)}`
                    : "Maxmemory limiti tanımlı değil / bilinmiyor"
                }
                values={samples.map(s => s.memory)}
              />

              <MetricCard
                title="Operations / sec"
                value={compact(current.ops)}
                detail="Sunucu anlık işlemleri"
                values={samples.map(s => s.ops)}
              />

              <MetricCard
                title="Connected Clients"
                value={compact(current.clients)}
                values={samples.map(s => s.clients)}
              />

              <MetricCard
                title="Cache HIT Ratio"
                value={percent(current.hitRatio)}
                detail={`${compact(current.hits)} HIT · ${compact(current.misses)} MISS`}
                values={samples.map(s => s.hitRatio)}
              />

              <MetricCard
                title="Total Keys"
                value={compact(current.keys)}
                detail="API'den gelen keyspace toplamı"
              />

              <MetricCard
                title="Used Memory RSS"
                value={bytes(current.rss)}
              />

              <MetricCard
                title="Evicted Keys"
                value={compact(current.evictions)}
                detail="Redis başlangıcından itibaren toplam"
              />

              <MetricCard
                title="Expired Keys"
                value={compact(current.expired)}
                detail="Redis başlangıcından itibaren toplam"
              />

              <MetricCard
                title="Uptime"
                value={`${compact(current.uptime / 3600)} saat`}
              />

              <MetricCard
                title="Latency"
                value={`${compact(current.latency)} ms`}
                detail="API ölçümü sağlıyorsa görüntülenir"
              />

              <MetricCard
                title="Fragmentation Ratio"
                value={compact(current.fragmentation)}
                detail="INFO memory alanı mevcutsa"
              />

              <MetricCard
                title="CPU Used Sys"
                value={compact(current.cpu)}
                detail="Kümülatif CPU saniyesi; kullanım yüzdesi değil"
              />
            </div>
          </section>

          <section style={{
            ...cardStyle,
            marginBottom: 23
          }}>
            <h2 style={{
              marginTop: 0,
              fontSize: 20
            }}>
              Node Metrics Inspector
            </h2>

            <p style={{
              color: colors.secondary,
              fontSize: 13
            }}>
              Control API'nin döndürdüğü metrik alanları.
              Redis key değerleri sorgulanmaz.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 9
            }}>
              {Object.entries(current.raw)
                .filter(([key, value]) =>
                  !/password|secret|token|credential|connectionstring/i
                    .test(key) &&
                  (
                    value === null ||
                    ["number", "string", "boolean"]
                      .includes(typeof value)
                  )
                )
                .map(([key, value]) => (
                  <div key={key} style={{
                    padding: "10px 12px",
                    background: colors.bg,
                    borderRadius: 8,
                    overflowWrap: "anywhere"
                  }}>
                    <div style={{
                      fontSize: 11,
                      color: colors.secondary
                    }}>
                      {key}
                    </div>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 650,
                      marginTop: 5
                    }}>
                      {asText(value)}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </>
      )}

      <section style={{
        ...cardStyle,
        background: colors.bg
      }}>
        <h2 style={{
          marginTop: 0,
          fontSize: 18
        }}>
          Operation Safety
        </h2>

        <p style={{
          color: colors.secondary,
          fontSize: 13,
          marginBottom: 0
        }}>
          Fleet Intelligence salt okunurdur. FLUSHALL,
          CONFIG SET, node detach, failover, restart,
          upgrade ve restore işlemleri bu ekrandan
          gerçekleştirilemez. Bunlar ileride ayrı
          RBAC, onay, audit ve rollback kontrolleriyle
          uygulanacaktır.
        </p>
      </section>
    </main>
  );
}
