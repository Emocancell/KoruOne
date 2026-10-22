"use client";

import {
  useCallback,
  useEffect,
  useState
} from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";
import styles from "./registry.module.css";

type Assignment = {
  department: string;
  nodeId: string;
  assigned: boolean;
  updatedBy: string;
  updatedAt: string;
};

type Audit = {
  actor: string;
  department: string;
  nodeId: string;
  previous: boolean;
  current: boolean;
  changedAt: string;
};

type Registry = {
  isAdmin: boolean;
  department: string;
  rows: Assignment[];
  audit: Audit[];
  checkedAt: string;
};

type Metrics = {
  connected: boolean;
  version: string;
  memoryBytes: number;
  operationsPerSecond: number;
  clients: number;
  totalKeys: number;
  latencyMs: number;
};

const nodes = [
  {
    id: "redis-cache",
    label: "Redis Cache",
    subtitle: "Application caching",
    port: 6379
  },
  {
    id: "redis-streams",
    label: "Redis Streams",
    subtitle: "Events and consumers",
    port: 6380
  }
];

const departmentNames: Record<string, string> = {
  network: "Network",
  it: "IT",
  hr: "İnsan Kaynakları",
  marketing: "Pazarlama",
  advertising: "Reklam",
  redis: "Redis Operations"
};

function memory(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2)
    return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export default function RedisRegistryPage() {
  const [token, setToken] = useState("");
  const [registry, setRegistry] =
    useState<Registry | null>(null);

  const [metrics, setMetrics] =
    useState<Record<string, Metrics>>({});

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("Keycloak ayarları eksik.");
      setLoading(false);
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
        setLoading(false);
        return;
      }

      setToken(user.access_token);
    }).catch(() => {
      if (active) {
        setError("Oturum okunamadı.");
        setLoading(false);
      }
    });

    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(
        "/api/v8/redis/registry",
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        }
      );

      if (!response.ok)
        throw Error(
          `Registry API HTTP ${response.status}`
        );

      const result =
        await response.json() as Registry;

      setRegistry(result);

      const visible = nodes.filter(node =>
        result.isAdmin ||
        result.rows.some(row =>
          row.nodeId === node.id && row.assigned
        )
      );

      const metricResults = await Promise.allSettled(
        visible.map(async node => {
          const r = await fetch(
            `/api/v7/redis/nodes/${node.id}/metrics`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              cache: "no-store"
            }
          );

          if (!r.ok)
            throw Error(`Metrics HTTP ${r.status}`);

          return {
            id: node.id,
            data: await r.json() as Metrics
          };
        })
      );

      const next: Record<string, Metrics> = {};

      metricResults.forEach(item => {
        if (item.status === "fulfilled")
          next[item.value.id] = item.value.data;
      });

      setMetrics(next);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Registry bağlantı hatası"
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    const timer = window.setInterval(
      () => void refresh(), 30000
    );

    return () => window.clearInterval(timer);
  }, [token, refresh]);

  async function update(
    department: string,
    nodeId: string,
    assigned: boolean
  ) {
    if (!registry?.isAdmin || busy) return;

    const key = `${department}:${nodeId}`;
    setBusy(key);
    setMessage("");
    setError("");

    try {
      const response = await fetch(
        `/api/v8/redis/registry/${department}/${nodeId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ assigned })
        }
      );

      if (!response.ok)
        throw Error(
          `Atama kaydedilemedi: HTTP ${response.status}`
        );

      setMessage(
        `${department} → ${nodeId}: ` +
        (assigned ? "Atandı" : "Atama kaldırıldı")
      );

      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "İşlem başarısız"
      );
    } finally {
      setBusy("");
    }
  }

  function exportReport() {
    if (!registry) return;

    const content = {
      product: "KORU ONE Redis Node Registry",
      exportedAt: new Date().toISOString(),
      registry,
      metrics
    };

    const blob = new Blob(
      [JSON.stringify(content, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "koru-redis-registry.json";
    anchor.click();

    URL.revokeObjectURL(url);
  }

  const active = registry?.rows.filter(
    row => row.assigned
  ).length ?? 0;

  const departments = [
    ...new Set(
      registry?.rows.map(row => row.department) ?? []
    )
  ];

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            KORU ONE / REDIS CONTROL PLANE
          </p>
          <h1>Redis Node Registry</h1>
          <p className={styles.muted}>
            Departman bazlı Redis node atamaları,
            canlı kaynak bilgileri ve denetim kayıtları.
          </p>
        </div>

        <div className={styles.actions}>
          <Link href="/redis-fleet" className={styles.link}>
            Node Fleet ↗
          </Link>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!token || Boolean(busy)}
          >
            Yenile
          </button>

          <button
            type="button"
            onClick={exportReport}
            disabled={!registry}
            className={styles.secondary}
          >
            JSON Rapor
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className={styles.success} role="status">
          {message}
        </div>
      )}

      {loading && <p>Redis envanteri yükleniyor...</p>}

      {registry && (
        <>
          <div className={styles.kpis}>
            <div className={styles.card}>
              <small>Registry Nodes</small>
              <strong>2</strong>
              <span>Cache ve Streams</span>
            </div>
            <div className={styles.card}>
              <small>Department Assignments</small>
              <strong>{active}</strong>
              <span>Aktif kaynak atamaları</span>
            </div>
            <div className={styles.card}>
              <small>Departments</small>
              <strong>{departments.length}</strong>
              <span>Görüntülenebilir birimler</span>
            </div>
            <div className={styles.card}>
              <small>Access Mode</small>
              <strong className={styles.mode}>
                {registry.isAdmin ? "ADMIN" : "VIEWER"}
              </strong>
              <span>
                {registry.isAdmin
                  ? "Atama yönetimi açık"
                  : "Salt okunur görünüm"}
              </span>
            </div>
          </div>

          <div className={styles.nodeGrid}>
            {nodes.map(node => {
              const m = metrics[node.id];
              const isAssigned = registry.isAdmin ||
                registry.rows.some(
                  row =>
                    row.nodeId === node.id &&
                    row.assigned
                );

              return (
                <section
                  className={styles.nodeCard}
                  key={node.id}
                >
                  <div className={styles.nodeHeader}>
                    <div>
                      <small>REDIS NODE</small>
                      <h2>{node.label}</h2>
                      <p>{node.subtitle}</p>
                    </div>

                    <span className={
                      m?.connected
                        ? styles.connected
                        : styles.unavailable
                    }>
                      {m?.connected
                        ? "CONNECTED"
                        : isAssigned
                          ? "METRICS UNAVAILABLE"
                          : "NOT ASSIGNED"}
                    </span>
                  </div>

                  <div className={styles.nodeMetrics}>
                    <div>
                      <small>Memory</small>
                      <strong>
                        {m ? memory(m.memoryBytes) : "—"}
                      </strong>
                    </div>
                    <div>
                      <small>Operations/sec</small>
                      <strong>
                        {m?.operationsPerSecond ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <small>Clients</small>
                      <strong>{m?.clients ?? "—"}</strong>
                    </div>
                    <div>
                      <small>Redis Version</small>
                      <strong>{m?.version ?? "—"}</strong>
                    </div>
                  </div>

                  <div className={styles.nodeFooter}>
                    <span>Port {node.port}</span>
                    <span>
                      {m
                        ? `${m.totalKeys} keys`
                        : "Metrics unavailable"}
                    </span>
                  </div>
                </section>
              );
            })}
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHead}>
              <div>
                <h2>Department Assignment Matrix</h2>
                <p className={styles.muted}>
                  Atamalar PostgreSQL üzerinde saklanır.
                  Sadece Admin düzenleyebilir.
                </p>
              </div>
              <span className={styles.pill}>
                LIVE POLICY
              </span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.matrix}>
                <thead>
                  <tr>
                    <th>DEPARTMENT</th>
                    <th>REDIS CACHE</th>
                    <th>REDIS STREAMS</th>
                    <th>LAST UPDATE</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map(dept => {
                    const rows = registry.rows.filter(
                      row => row.department === dept
                    );

                    return (
                      <tr key={dept}>
                        <td>
                          <b>
                            {departmentNames[dept] ?? dept}
                          </b>
                          <small>{dept}</small>
                        </td>

                        {nodes.map(node => {
                          const assignment = rows.find(
                            row => row.nodeId === node.id
                          );

                          if (!assignment)
                            return <td key={node.id}>—</td>;

                          const key =
                            `${dept}:${node.id}`;

                          return (
                            <td key={node.id}>
                              <button
                                type="button"
                                disabled={
                                  !registry.isAdmin ||
                                  Boolean(busy)
                                }
                                onClick={() =>
                                  void update(
                                    dept,
                                    node.id,
                                    !assignment.assigned
                                  )
                                }
                                className={
                                  styles.assignment +
                                  " " +
                                  (assignment.assigned
                                    ? styles.assigned
                                    : styles.notAssigned)
                                }
                              >
                                {busy === key
                                  ? "Kaydediliyor..."
                                  : assignment.assigned
                                    ? "✓ Assigned"
                                    : "＋ Assign"}
                              </button>
                            </td>
                          );
                        })}

                        <td className={styles.updateCell}>
                          {rows.length > 0
                            ? new Date(
                                Math.max(
                                  ...rows.map(row =>
                                    new Date(
                                      row.updatedAt
                                    ).getTime()
                                  )
                                )
                              ).toLocaleString("tr-TR")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className={styles.note}>
              Node ataması gerçek Redis instance'ı
              oluşturmaz. Kullanıcının ilgili Redis
              aracına erişmesi için Keycloak rolü
              ve V8.1 departman izni de gereklidir.
            </p>
          </section>

          <section className={styles.panel}>
            <h2>Registry Audit Trail</h2>
            <p className={styles.muted}>
              Son 30 kaynak atama değişikliği
            </p>

            {registry.audit.length === 0 ? (
              <p>Henüz atama değişikliği yok.</p>
            ) : (
              <div className={styles.auditList}>
                {registry.audit.map((log, i) => (
                  <div key={i} className={styles.auditItem}>
                    <span className={
                      log.current
                        ? styles.auditAllowed
                        : styles.auditDenied
                    }>
                      {log.current
                        ? "ASSIGNED"
                        : "REVOKED"}
                    </span>
                    <strong>
                      {log.department} → {log.nodeId}
                    </strong>
                    <span>
                      {log.actor} ·{" "}
                      {new Date(log.changedAt)
                        .toLocaleString("tr-TR")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
