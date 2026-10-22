"use client";

import { useCallback, useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import styles from "./access.module.css";

type Policy = {
  department: string;
  tool: string;
  allowed: boolean;
  updatedBy: string;
  updatedAt: string;
};

type Audit = {
  actor: string;
  department: string;
  tool: string;
  previous: boolean;
  current: boolean;
  changedAt: string;
};

type AccessData = {
  isAdmin: boolean;
  isNetworkManager: boolean;
  department: string | null;
  rows: Policy[];
  history: Audit[];
};

const departments = [
  ["network", "Network"],
  ["it", "IT"],
  ["hr", "İnsan Kaynakları"],
  ["marketing", "Pazarlama"],
  ["advertising", "Reklam"],
  ["redis", "Redis Operations"]
];

const tools = [
  ["monitor", "Fleet / Metrics"],
  ["streams", "Streams Read"],
  ["stream-write", "Streams Write"],
  ["acl", "ACL Security"]
];

export default function RedisAccessPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("OIDC yapılandırması bulunamadı.");
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
        setError("Kurumsal oturum açmalısın.");
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
      const r = await fetch("/api/v8/redis/access", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!r.ok)
        throw Error(`Redis Access API: HTTP ${r.status}`);

      const result = await r.json() as AccessData;
      setData(result);
      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "Erişim tablosu okunamadı.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function editable(department: string, tool: string) {
    if (data?.isAdmin) return true;

    return Boolean(
      data?.isNetworkManager &&
      department === "network" &&
      tool === "monitor"
    );
  }

  async function changeAccess(
    department: string,
    tool: string,
    next: boolean
  ) {
    if (!editable(department, tool) || busy) return;

    const key = `${department}:${tool}`;
    setBusy(key);
    setNotice("");
    setError("");

    try {
      const r = await fetch(
        `/api/v8/redis/access/${department}/${tool}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ allowed: next })
        }
      );

      if (!r.ok)
        throw Error(`Kaydetme başarısız: HTTP ${r.status}`);

      setNotice(
        `${department} / ${tool}: ` +
        (next ? "İzin verildi" : "Erişim kapatıldı")
      );

      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message : "Politika değiştirilemedi.");
    } finally {
      setBusy("");
    }
  }

  const granted = data?.rows.filter(x => x.allowed).length ?? 0;
  const denied = data?.rows.filter(x => !x.allowed).length ?? 0;

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            KORU ONE / REDIS CONTROL / SECURITY
          </p>
          <h1>Department Access Manager</h1>
          <p className={styles.muted}>
            Redis modüllerine departman bazlı giriş
            izinlerini merkezi olarak yönet.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={!token || Boolean(busy)}
          className={styles.refresh}
        >
          Yenile ↻
        </button>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className={styles.success} role="status">
          {notice}
        </div>
      )}

      {loading && <p>Yetki politikaları yükleniyor...</p>}

      {data && (
        <>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <small>Departman</small>
              <strong>6</strong>
              <span>Yönetilen kurumsal birim</span>
            </div>
            <div className={styles.kpi}>
              <small>Açık izin</small>
              <strong>{granted}</strong>
              <span>Politika matrisindeki izinler</span>
            </div>
            <div className={styles.kpi}>
              <small>Kapalı izin</small>
              <strong>{denied}</strong>
              <span>Departman erişimi engelli</span>
            </div>
            <div className={styles.kpi}>
              <small>Yönetim seviyesi</small>
              <strong className={styles.role}>
                {data.isAdmin ? "ADMIN" : "NETWORK"}
              </strong>
              <span>
                {data.isAdmin
                  ? "Tüm departmanlar"
                  : "Network izleme politikası"}
              </span>
            </div>
          </div>

          <section className={styles.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Department Permission Matrix</h2>
                <p className={styles.muted}>
                  Kaydettiğin değişiklikler API
                  erişimine doğrudan uygulanır.
                </p>
              </div>
              <span className={styles.pill}>
                POSTGRESQL · LIVE POLICY
              </span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.matrix}>
                <thead>
                  <tr>
                    <th>DEPARTMAN</th>
                    {tools.map(([key, name]) => (
                      <th key={key}>{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map(([dept, title]) => (
                    <tr key={dept}>
                      <td>
                        <strong>{title}</strong>
                        <small>{dept}</small>
                      </td>

                      {tools.map(([tool]) => {
                        const policy = data.rows.find(
                          x => x.department === dept &&
                               x.tool === tool
                        );

                        if (!policy)
                          return <td key={tool}>—</td>;

                        const canEdit = editable(dept, tool);
                        const key = `${dept}:${tool}`;

                        return (
                          <td key={tool}>
                            <button
                              type="button"
                              disabled={!canEdit || Boolean(busy)}
                              onClick={() =>
                                void changeAccess(
                                  dept, tool, !policy.allowed
                                )
                              }
                              className={
                                styles.permission +
                                " " +
                                (policy.allowed
                                  ? styles.enabled
                                  : styles.disabled)
                              }
                              title={
                                canEdit
                                  ? "İzni değiştirmek için tıkla"
                                  : "Bu yetkiyi yönetemezsin"
                              }
                              aria-label={
                                `${dept} ${tool} ` +
                                (policy.allowed
                                  ? "açık" : "kapalı")
                              }
                            >
                              {busy === key
                                ? "Kaydediliyor"
                                : policy.allowed
                                  ? "✓ İzinli"
                                  : "⊘ Kapalı"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.hint}>
              Admin hesapları kurtarma amacıyla bu
              matristen etkilenmez. Bir izni açmak,
              kullanıcının Keycloak rolünün izin
              vermediği bir yetkiyi kazandırmaz.
              Örneğin Network rolü ACL yönetimi yapamaz.
            </p>
          </section>

          <div className={styles.bottomGrid}>
            <section className={styles.panel}>
              <h2>Access Distribution</h2>
              <p className={styles.muted}>
                Departmanlara göre etkin izin oranı
              </p>

              {departments.map(([dept, title]) => {
                const rows = data.rows.filter(
                  x => x.department === dept
                );
                const count = rows.filter(x => x.allowed).length;
                const pct = rows.length
                  ? count / rows.length * 100
                  : 0;

                return (
                  <div key={dept} className={styles.barRow}>
                    <div className={styles.barLabel}>
                      <span>{title}</span>
                      <b>{count}/{rows.length}</b>
                    </div>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{width: `${pct}%`}}
                      />
                    </div>
                  </div>
                );
              })}
            </section>

            <section className={styles.panel}>
              <h2>Security Audit</h2>
              <p className={styles.muted}>
                Son 25 politika değişikliği
              </p>

              {data.history.length === 0 ? (
                <p>Henüz politika değişikliği yok.</p>
              ) : (
                <div className={styles.auditList}>
                  {data.history.map((item, i) => (
                    <div key={i} className={styles.auditItem}>
                      <b>
                        {item.current
                          ? "İZİN VERİLDİ"
                          : "ERİŞİM KAPATILDI"}
                      </b>
                      <span>
                        {item.department} · {item.tool}
                      </span>
                      <small>
                        {item.actor} ·{" "}
                        {new Date(item.changedAt)
                          .toLocaleString("tr-TR")}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
