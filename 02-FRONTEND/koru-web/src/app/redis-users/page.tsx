"use client";

import { useCallback, useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import styles from "./users.module.css";

type Decision = "inherit" | "allow" | "deny";

type Person = {
  id: number;
  username: string;
  department: string;
  roles: string[];
  lastSeen: string;
  permissions: Record<string, Decision>;
};

type Audit = {
  actor: string;
  username: string;
  department: string;
  tool: string;
  previous: string;
  current: string;
  changedAt: string;
};

type Data = {
  isAdmin: boolean;
  users: Person[];
  audit: Audit[];
};

const tools = [
  ["monitor", "Fleet / Metrics / Diagnostics"],
  ["streams", "Streams Read"],
  ["stream-write", "Streams Operations"],
  ["acl", "ACL Security"]
];

export default function RedisUserAccessPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [selectedId, setSelectedId] = useState(0);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("OIDC yapılandırması eksik.");
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

      await fetch("/api/v8/redis/users/self", {
        headers: {
          Authorization: `Bearer ${user.access_token}`
        }
      }).catch(() => undefined);
    }).catch(() => {
      if (active) setError("Oturum okunamadı.");
    });

    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(
        "/api/v8/redis/users",
        {
          headers: {Authorization: `Bearer ${token}`},
          cache: "no-store"
        }
      );

      if (!response.ok)
        throw Error(`HTTP ${response.status}`);

      const result = await response.json() as Data;
      setData(result);

      setSelectedId(old =>
        result.users.some(u => u.id === old)
          ? old
          : result.users[0]?.id ?? 0
      );

      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "Kullanıcı listesi okunamadı.");
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    if (!token) return;

    const timer = setInterval(
      () => void refresh(), 30000
    );

    return () => clearInterval(timer);
  }, [refresh, token]);

  const users = (data?.users ?? []).filter(u =>
    (u.username + " " + u.department)
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const selected = data?.users.find(
    u => u.id === selectedId
  );

  function editable(user: Person, tool: string) {
    if (user.roles.includes("admin")) return false;
    if (data?.isAdmin) return true;

    return user.department === "network" &&
      tool === "monitor";
  }

  async function save(
    person: Person,
    tool: string,
    decision: Decision
  ) {
    if (!editable(person, tool) || busy) return;

    setBusy(`${person.id}:${tool}`);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/v8/redis/users/${person.id}/permissions/${tool}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({decision})
        }
      );

      if (!response.ok)
        throw Error(`Kaydetme HTTP ${response.status}`);

      setMessage(
        `${person.username}: ${tool} → ${decision}`
      );

      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "İzin kaydedilemedi.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            KORU ONE / REDIS / SECURITY
          </p>
          <h1>User Access Manager</h1>
          <p className={styles.muted}>
            Gerçek Keycloak oturumları için
            bireysel Redis araç izinleri.
          </p>
        </div>
        <button
          disabled={!token || Boolean(busy)}
          onClick={() => void refresh()}
        >
          ↻ Yenile
        </button>
      </div>

      {error &&
        <p className={styles.error} role="alert">{error}</p>}

      {message &&
        <p className={styles.success} role="status">{message}</p>}

      {data && (
        <>
          {/* KORU_V84_STORAGE_LINK */}
          <div style={{
            background: "#edf7f2",
            border: "1px solid #cfe7d9",
            borderRadius: 12,
            padding: 16,
            margin: "20px 0"
          }}>
            <strong>Redis Storage & Capacity</strong>
            <p style={{fontSize: 13}}>
              Departmanlarin bellek kullanimini,
              planlama butcelerini ve gecmis
              trend grafiklerini goruntule.
            </p>
            <a href="/redis-storage">
              Storage Dashboard →
            </a>
          </div>

          <div className={styles.kpis}>
            <article>
              <small>Kayıtlı kullanıcı</small>
              <strong>{data.users.length}</strong>
            </article>
            <article>
              <small>Özel izin</small>
              <strong>
                {data.users.reduce(
                  (sum, u) =>
                    sum + Object.keys(u.permissions).length,
                  0
                )}
              </strong>
            </article>
            <article>
              <small>Yönetim</small>
              <strong>
                {data.isAdmin ? "ADMIN" : "NETWORK"}
              </strong>
            </article>
          </div>

          <div className={styles.columns}>
            <section className={styles.panel}>
              <h2>Users</h2>
              <input
                className={styles.search}
                placeholder="Kullanıcı ara..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />

              {users.map(user => (
                <button
                  key={user.id}
                  className={
                    styles.user +
                    (user.id === selectedId
                      ? " " + styles.selected
                      : "")
                  }
                  onClick={() => setSelectedId(user.id)}
                >
                  <span className={styles.avatar}>
                    {user.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <b>{user.username}</b>
                    <small>
                      {user.department}
                      {" · "}
                      {user.roles.join(", ")}
                    </small>
                  </span>
                </button>
              ))}

              {users.length === 0 &&
                <p className={styles.muted}>
                  Henüz kullanıcı bulunmuyor.
                </p>}
            </section>

            <section className={styles.panel}>
              {selected ? (
                <>
                  <p className={styles.eyebrow}>
                    IDENTITY PROFILE
                  </p>
                  <h2>{selected.username}</h2>
                  <p className={styles.muted}>
                    {selected.department}
                    {" · "}
                    {selected.roles.join(", ")}
                  </p>

                  <div className={styles.tools}>
                    {tools.map(([tool, label]) => {
                      const current =
                        selected.permissions[tool] ??
                        "inherit";

                      return (
                        <div className={styles.tool} key={tool}>
                          <strong>{label}</strong>
                          <div className={styles.options}>
                            {(["inherit", "allow", "deny"] as
                              Decision[]).map(decision => (
                              <button
                                key={decision}
                                disabled={
                                  !editable(selected, tool) ||
                                  Boolean(busy)
                                }
                                className={
                                  current === decision
                                    ? styles.active
                                    : styles.choice
                                }
                                onClick={() =>
                                  void save(
                                    selected, tool, decision
                                  )
                                }
                              >
                                {decision.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p className={styles.note}>
                    Allow yalnızca uygulama seviyesindeki
                    departman kuralını geçersiz kılar.
                    Keycloak rolünü veya node atamasını
                    aşamaz. Admin erişimi korunur.
                  </p>
                </>
              ) : (
                <p>Kullanıcı seç.</p>
              )}
            </section>
          </div>

          <section className={styles.panel}>
            <h2>Security Audit Trail</h2>
            {data.audit.map((item, index) => (
              <div className={styles.audit} key={index}>
                <div>
                  <strong>{item.username}</strong>
                  <small>
                    {item.department} · {item.tool}
                  </small>
                </div>
                <div>
                  <b>
                    {item.previous} → {item.current}
                  </b>
                  <small>
                    {item.actor} ·{" "}
                    {new Date(item.changedAt)
                      .toLocaleString("tr-TR")}
                  </small>
                </div>
              </div>
            ))}

            {data.audit.length === 0 &&
              <p className={styles.muted}>
                Henüz değişiklik yok.
              </p>}
          </section>

          <p className={styles.muted}>
            Kullanıcılar KORU ONE'a giriş yaptıkça
            kaydedilir; tüm Keycloak hesaplarını
            otomatik listelemez.
          </p>
        </>
      )}
    </main>
  );
}
