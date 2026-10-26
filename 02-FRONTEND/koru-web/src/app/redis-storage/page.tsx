"use client";
import MultiRedisManagerV87 from "./MultiRedisManagerV87";


import {
  useCallback, useEffect, useMemo, useState
} from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";
import RedisStorageLiveV89 from "./RedisStorageLiveV89";
import RedisCapacityBarV893 from "./RedisCapacityBarV893";

type NodeMetric = {
  id: string;
  connected: boolean;
  usedBytes: number;
  maxMemoryBytes: number;
  error: string | null;
};

type Usage = {
  department: string;
  nodeId: string;
  budgetMb: number;
  prefix: string;
  measuredBytes: number | null;
  sampledKeys: number;
  state: "complete" | "partial" | "unavailable";
};

type Sample = {
  department: string;
  nodeId: string;
  sampleAt: string;
  measuredBytes: number;
  complete: boolean;
};

type Storage = {
  isAdmin: boolean;
  nodes: NodeMetric[];
  departments: Usage[];
  history: Sample[];
  checkedAt: string;
  budgetIsEnforced: boolean;
};

type StoragePlanV85 = {
  department: string;
  nodeId: string;
  budgetMb: number;
  prefix: string;
  active: boolean;
};

const names: Record<string, string> = {
  hr: "Human Resources",
  network: "Network",
  it: "IT Operations",
  marketing: "Marketing",
  advertising: "Advertising",
  redis: "Redis Operations"
};

const nodeNames: Record<string, string> = {
  "redis-cache": "Redis Cache",
  "redis-streams": "Redis Streams"
};

const MB = 1024 * 1024;

const palette = {
  ink: "#203c4c",
  muted: "#718696",
  accent: "#147b66",
  border: "#dce6eb",
  light: "#f6f9fa",
  warn: "#b17426"
};

const card: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${palette.border}`,
  padding: 21,
  borderRadius: 15,
  boxShadow: "0 3px 15px rgba(20,45,65,.035)"
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
  gap: 14
};

const format = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(n);

function bytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "Ölçülemedi";
  if (n < 1024) return `${format(n)} B`;
  if (n < MB) return `${format(n / 1024)} KB`;
  return `${format(n / MB)} MB`;
}

function Bar({
  value, max, uncertain = false
}: {
  value: number | null;
  max: number;
  uncertain?: boolean;
}) {
  const ratio = value === null || max <= 0
    ? 0
    : value / max * 100;

  const percent = Math.max(
    0, Math.min(100, ratio)
  );

  const color = ratio >= 100
    ? "#bf464e"
    : ratio >= 80
      ? "#c48a35"
      : "#16816b";

  return (
    <div
      title={
        value === null
          ? "Ölçüm mevcut değil"
          : `${format(ratio)}%` +
            (uncertain ? " · Kısmi ölçüm" : "")
      }
      style={{
        height: 12,
        background: "#e8eef0",
        borderRadius: 20,
        overflow: "hidden",
        marginTop: 12
      }}
    >
      <div style={{
        height: "100%",
        width: `${percent}%`,
        background: color,
        opacity: uncertain ? .65 : 1,
        borderRadius: 20,
        transition: "width .3s"
      }}/>
    </div>
  );
}

function Trend({samples}: {samples: Sample[]}) {
  const ordered = [...samples]
    .sort((a,b) =>
      new Date(a.sampleAt).getTime() -
      new Date(b.sampleAt).getTime()
    )
    .slice(-60);

  if (ordered.length < 2) {
    return (
      <div style={{
        height: 160,
        display: "grid",
        placeItems: "center",
        color: palette.muted,
        background: palette.light,
        borderRadius: 12,
        fontSize: 13
      }}>
        Grafik için ikinci ölçüm bekleniyor.
      </div>
    );
  }

  const maximum = Math.max(
    ...ordered.map(x => x.measuredBytes),
    1
  );

  const points = ordered.map((s,i) => {
    const x = 15 + i / (ordered.length - 1) * 670;
    const y = 137 -
      s.measuredBytes / maximum * 115;

    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return (
    <div>
      <svg
        viewBox="0 0 700 155"
        width="100%"
        height="190"
        preserveAspectRatio="none"
        role="img"
        aria-label="Son bir saatlik bellek kullanım trendi"
        style={{
          background: palette.light,
          borderRadius: 12
        }}
      >
        {[22, 79, 137].map(y => (
          <line
            key={y}
            x1="15" x2="685" y1={y} y2={y}
            stroke="#dce7eb"
            strokeDasharray="4 5"
          />
        ))}
        <polyline
          points={points}
          fill="none"
          stroke="#138069"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        color: palette.muted,
        fontSize: 12
      }}>
        <span>
          {new Date(first.sampleAt)
            .toLocaleTimeString("tr-TR", {
              hour: "2-digit", minute: "2-digit"
            })}
        </span>
        <strong>{bytes(last.measuredBytes)}</strong>
        <span>
          {new Date(last.sampleAt)
            .toLocaleTimeString("tr-TR", {
              hour: "2-digit", minute: "2-digit"
            })}
        </span>
      </div>
    </div>
  );
}

export default function RedisStoragePage() {
  const [token, setToken] = useState("");
  const [legacy,setLegacy]=useState<{
    cache:{usedMemoryBytes:number;maxMemoryBytes:number};
    streams:{usedMemoryBytes:number;maxMemoryBytes:number};
  }|null>(null);
  const [legacyError,setLegacyError]=useState("");
  const [data, setData] = useState<Storage | null>(null);
  const [selected, setSelected] = useState("hr:redis-cache");
  const [budget, setBudget] = useState("256");
  const [prefix, setPrefix] = useState("koru:hr:");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [plansV85, setPlansV85] =
    useState<StoragePlanV85[]>([]);
  const [planBusyV85, setPlanBusyV85] = useState("");
  const [planErrorV85, setPlanErrorV85] = useState("");


  useEffect(() => {
    let active = true;

    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

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
      const r = await fetch("/api/v8/redis/storage", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!r.ok)
        throw Error(`Storage API HTTP ${r.status}`);

      const result = await r.json() as Storage;
      setData(result);
      // KORU_V85_FETCH_PLANS
      if (result.isAdmin) {
        try {
          const plansResponse = await fetch(
            "/api/v8/redis/storage/plans",
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              cache: "no-store"
            }
          );

          if (!plansResponse.ok)
            throw Error(
              `Plan API HTTP ${plansResponse.status}`);

          setPlansV85(
            await plansResponse.json() as StoragePlanV85[]
          );
          setPlanErrorV85("");
        } catch (e) {
          setPlanErrorV85(e instanceof Error
            ? e.message : "Planlar okunamadi.");
        }
      }


      setSelected(previous =>
        result.departments.some(
          d => `${d.department}:${d.nodeId}` === previous
        )
        ? previous
        : result.departments.length
          ? `${result.departments[0].department}:` +
            result.departments[0].nodeId
          : ""
      );

      setError("");
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "Storage metrikleri okunamadı.");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    if (!auto) return;

    const id = window.setInterval(
      () => void refresh(), 30000
    );

    return () => window.clearInterval(id);
  }, [token, auto, refresh]);

  useEffect(()=>{
    if(!token)return;
    let active=true;

    async function loadLegacy(){
      try{
        const response=await fetch(
          "/api/v8/redis/storage/reality/live",
          {
            headers:{Authorization:`Bearer ${token}`},
            cache:"no-store"
          }
        );

        if(!response.ok)throw Error(`HTTP ${response.status}`);

        const result=await response.json();

        if(active){
          setLegacy(result);
          setLegacyError("");
        }
      }catch(e){
        if(active){
          setLegacyError(
            e instanceof Error?e.message:"Baglanti hatasi"
          );
        }
      }
    }

    void loadLegacy();
    const timer=window.setInterval(()=>void loadLegacy(),15000);

    return ()=>{
      active=false;
      window.clearInterval(timer);
    };
  },[token]);

  const item = data?.departments.find(
    d => `${d.department}:${d.nodeId}` === selected
  );

  useEffect(() => {
    if (!item) return;
    setBudget(String(item.budgetMb));
    setPrefix(item.prefix);
  }, [item?.department, item?.nodeId,
      item?.budgetMb, item?.prefix]);

  const samples = useMemo(() =>
    (data?.history ?? []).filter(
      s => `${s.department}:${s.nodeId}` === selected
    ),
    [data, selected]
  );

  const grouped = useMemo(() => {
    const result: Record<string, Usage[]> = {};

    for (const d of data?.departments ?? []) {
      (result[d.department] ??= []).push(d);
    }

    return result;
  }, [data]);

  const totalUsed = data?.nodes.reduce(
    (sum,n) => sum + (n.connected ? n.usedBytes : 0),
    0
  ) ?? 0;

  const active = data?.nodes.filter(
    n => n.connected
  ).length ?? 0;

  async function togglePlanV85(
    plan: StoragePlanV85
  ) {
    if (!data?.isAdmin || planBusyV85) return;

    if (plan.active && !window.confirm(
      `${plan.department}/${plan.nodeId} planini pasife al? ` +
      "Redis verileri silinmeyecek."
    )) return;

    const key = `${plan.department}:${plan.nodeId}`;
    setPlanBusyV85(key);
    setPlanErrorV85("");

    try {
      const base = `/api/v8/redis/storage/plans/` +
        `${plan.department}/${plan.nodeId}`;

      const response = await fetch(
        plan.active ? base : base + "/restore",
        {
          method: plan.active ? "DELETE" : "POST",
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok)
        throw Error(
          `Plan islemi HTTP ${response.status}: ` +
          (await response.text()).slice(0,180)
        );

      await refresh();
    } catch (e) {
      setPlanErrorV85(e instanceof Error
        ? e.message : "Plan degistirilemedi.");
    } finally {
      setPlanBusyV85("");
    }
  }

  async function savePolicy() {
    if (!item || !data?.isAdmin || busy) return;

    const nextBudget = Number(budget);

    if (!Number.isInteger(nextBudget) ||
        nextBudget < 1 || nextBudget > 102400) {
      setError("Bütçe 1–102400 MB olmalıdır.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/v8/redis/storage/` +
        `${item.department}/${item.nodeId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            budgetMb: nextBudget,
            prefix: prefix.trim()
          })
        }
      );

      if (!response.ok) {
        const info = await response.text();
        throw Error(
          `Kaydetme HTTP ${response.status}: ${info.slice(0,250)}`
        );
      }

      setNotice("Depolama bütçesi ve namespace kaydedildi.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.message
        : "Ayar kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  const legacyRows:NodeMetric[]=legacy ? [
    {
      id:"redis-cache",
      connected:true,
      usedBytes:legacy.cache.usedMemoryBytes,
      maxMemoryBytes:legacy.cache.maxMemoryBytes,
      error:null
    },
    {
      id:"redis-streams",
      connected:true,
      usedBytes:legacy.streams.usedMemoryBytes,
      maxMemoryBytes:legacy.streams.maxMemoryBytes,
      error:null
    }
  ] : data?.nodes ?? [];

  return (
    <main style={{
      maxWidth: 1500,
      margin: "30px auto",
      padding: "0 22px 70px",
      color: palette.ink
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
            color: palette.accent,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 1
          }}>
            KORU ONE / REDIS CONTROL / CAPACITY
          </p>
          <h1 style={{fontSize: 33, margin: "8px 0"}}>
            Storage & Capacity
          </h1>
          <p style={{color: palette.muted}}>
            Departman namespace ölçümleri, planlama
            bütçeleri ve kalıcı trend grafikleri.
          </p>
        </div>

        <div style={{
          display: "flex", gap: 9,
          alignItems: "center", flexWrap: "wrap"
        }}>
          <Link href="/redis-users">
            User Access
          </Link>
          <button onClick={() => setAuto(v => !v)}>
            Auto {auto ? "ON" : "OFF"}
          </button>
          <button
            disabled={!token || busy}
            onClick={() => void refresh()}
          >
            Yenile
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" style={{
          background: "#fff0f0",
          color: "#a83340",
          padding: 14,
          borderRadius: 10
        }}>{error}</p>
      )}

      {notice && (
        <p role="status" style={{
          background: "#e6f5ec",
          color: "#156c4e",
          padding: 14,
          borderRadius: 10
        }}>{notice}</p>
      )}

      <div style={{...grid, marginTop: 25}}>
        {[
          ["Legacy Redis Nodes", data
            ? `${active}/${data.nodes.length}` : "—",
            "Eski Cache + Streams · 6379/6380"],
          ["Physical RAM", data
            ? bytes(totalUsed) : "—",
            "Redis INFO used_memory"],
          ["Department Scopes", data
            ? Object.keys(grouped).length : "—",
            "Erişilebilir departman"],
          ["Sampling", "Bounded",
            "4 SCAN sayfası, max 40 key"]
        ].map(([title,value,info]) => (
          <div key={title} style={card}>
            <small style={{color: palette.muted}}>
              {title}
            </small>
            <strong style={{
              display: "block",
              fontSize: 26,
              margin: "12px 0"
            }}>
              {value}
            </strong>
            <small style={{color: palette.muted}}>
              {info}
            </small>
          </div>
        ))}
      </div>

      <MultiRedisManagerV87/>

      <h2 style={{marginTop:28}}>Legacy Redis Storage (6379 / 6380)</h2>
      <section style={{...card, marginTop: 20}}>
        <h2>Physical Redis Capacity</h2>
        <p style={{color: palette.muted, fontSize: 13}}>
          Instance genelindeki gerçek Redis bellek verisi.
          Departman kullanımından bağımsızdır.
        </p>

        {legacyError&&<p style={{
          fontSize:12,color:"#a36c32"
        }}>
          Legacy INFO ölçümü: {legacyError}.
          Son bilinen veriler gösteriliyor.
        </p>}
        <div style={grid}>
          {legacyRows.map(node => (
            <div key={node.id} style={{
              border: `1px solid ${palette.border}`,
              borderRadius: 12,
              padding: 17
            }}>
              <strong>{nodeNames[node.id] || node.id}</strong>
              <div style={{
                marginTop: 12,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 13
              }}>
                <span>
                  {node.connected
                    ? bytes(node.usedBytes)
                    : "Bağlantı yok"}
                </span>
                <span>
                  {node.maxMemoryBytes > 0
                    ? bytes(node.maxMemoryBytes)
                    : "Limit tanımsız"}
                </span>
              </div>
              <RedisCapacityBarV893
                usedBytes={node.connected?node.usedBytes:null}
                maxMemoryBytes={node.maxMemoryBytes}
              />
            </div>
          ))}
        </div>
      </section>

      {data?.isAdmin && <RedisStorageLiveV89 token={token} />}

      <section style={{...card, marginTop: 20}}>
        <h2>Department Storage Allocation</h2>
        <p style={{color: palette.muted, fontSize: 13}}>
          Her satır yalnızca ilgili Redis namespace'ine
          ait ölçülen anahtar belleğini gösterir.
        </p>

        <div style={{
          display: "grid",
          gap: 12,
          marginTop: 20
        }}>
          {Object.entries(grouped).map(([department, rows]) =>
            rows.map(d => {
              const key = `${d.department}:${d.nodeId}`;
              const budgetBytes = d.budgetMb * MB;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  style={{
                    background: selected === key
                      ? "#eff8f3"
                      : "#fff",
                    border: selected === key
                      ? "1px solid #95c9b2"
                      : `1px solid ${palette.border}`,
                    padding: 18,
                    borderRadius: 12,
                    color: palette.ink,
                    textAlign: "left",
                    width: "100%"
                  }}
                >
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 10
                  }}>
                    <div>
                      <strong>
                        {names[department] || department}
                      </strong>
                      <div style={{
                        fontSize: 12,
                        color: palette.muted,
                        marginTop: 4
                      }}>
                        {nodeNames[d.nodeId]} · {d.prefix}
                      </div>
                    </div>

                    <div style={{textAlign: "right"}}>
                      <strong>
                        {d.state === "partial" ? "≥ " : ""}
                        {bytes(d.measuredBytes)}
                        {" / "}
                        {d.budgetMb} MB
                      </strong>
                      <div style={{
                        color: d.state === "complete"
                          ? "#188268"
                          : palette.warn,
                        fontSize: 11,
                        marginTop: 5
                      }}>
                        {d.state === "complete"
                          ? "Ölçüm tamamlandı"
                          : d.state === "partial"
                            ? "Kısmi ölçüm"
                            : "Ölçüm yapılamadı"}
                        {" · "}{d.sampledKeys} key
                      </div>
                    </div>
                  </div>

                  <Bar
                    value={d.measuredBytes}
                    max={budgetBytes}
                    uncertain={d.state !== "complete"}
                  />
                </button>
              );
            })
          )}

          {data && !data.departments.length && (
            <p style={{color: palette.muted}}>
              Bu kullanıcıya atanmış Redis kaynağı yok.
            </p>
          )}
        </div>
      </section>

      {/* KORU_V85_PLAN_MANAGER */}
      {data?.isAdmin && (
        <section style={{...card, marginTop: 20}}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12
          }}>
            <div>
              <h2>Storage Plan Manager</h2>
              <p style={{
                fontSize: 13, color: palette.muted
              }}>
                Planları düzenle, pasife al veya geri yükle.
                Redis anahtarları hiçbir zaman silinmez.
              </p>
            </div>
            <a href="/redis-operations">
              Alerts & Slowlog →
            </a>
          </div>

          {planErrorV85 && (
            <p role="alert" style={{color:"#b43c47"}}>
              {planErrorV85}
            </p>
          )}

          <div style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(260px,1fr))",
            gap: 12,
            marginTop: 17
          }}>
            {plansV85.map(plan => {
              const key =
                `${plan.department}:${plan.nodeId}`;

              return (
                <div key={key} style={{
                  border: "1px solid #e1e9ed",
                  padding: 17,
                  borderRadius: 12
                }}>
                  <strong>
                    {names[plan.department] ||
                     plan.department}
                  </strong>
                  <p style={{
                    fontSize: 12, color: palette.muted
                  }}>
                    {nodeNames[plan.nodeId]}
                    {" · "}{plan.prefix}
                  </p>
                  <p>
                    <b>{plan.budgetMb} MB</b>
                    {" · "}
                    <span style={{
                      color: plan.active
                        ? "#148068" : "#b14d4f"
                    }}>
                      {plan.active ? "Aktif" : "Pasif"}
                    </span>
                  </p>
                  <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8
                  }}>
                    {plan.active && (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          setSelected(key);
                          document.getElementById(
                            "v84-capacity-editor"
                          )?.scrollIntoView({
                            behavior: "smooth",
                            block: "center"
                          });
                        }}
                      >
                        Düzenle
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={Boolean(planBusyV85)}
                      onClick={() =>
                        void togglePlanV85(plan)}
                      style={{
                        background: plan.active
                          ? "#a9434b"
                          : "#176d54"
                      }}
                    >
                      {planBusyV85 === key
                        ? "Kaydediliyor..."
                        : plan.active
                          ? "Planı Sil"
                          : "Geri Yükle"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {item && (
        <div style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(300px,1fr))",
          gap: 16,
          marginTop: 20
        }}>
          <section style={card}>
            <h2>Memory Trend · Last Hour</h2>
            <p style={{color: palette.muted, fontSize: 13}}>
              {names[item.department]} /{" "}
              {nodeNames[item.nodeId]}
            </p>

            <Trend samples={samples}/>

            <p style={{
              color: palette.muted,
              fontSize: 12,
              lineHeight: 1.6
            }}>
              Dakikalık örnekler PostgreSQL'de saklanır.
              Eksik veya kısmi taramalar tüm belleği
              temsil etmeyebilir.
            </p>
          </section>

          <section style={card}>
            <h2 id="v84-capacity-editor">Capacity Policy</h2>
            <p style={{color: palette.muted, fontSize: 13}}>
              {names[item.department]} ·{" "}
              {nodeNames[item.nodeId]}
            </p>

            <label style={{
              display: "block",
              marginTop: 20,
              fontSize: 13
            }}>
              Planlanan bütçe (MB)
            </label>

            <input
              type="number"
              min={1}
              max={102400}
              disabled={!data?.isAdmin}
              value={budget}
              onChange={e => setBudget(e.target.value)}
              style={{
                maxWidth: "100%",
                width: "100%",
                marginTop: 7
              }}
            />

            <label style={{
              display: "block",
              marginTop: 16,
              fontSize: 13
            }}>
              Redis key namespace
            </label>

            <input
              value={prefix}
              disabled={!data?.isAdmin}
              onChange={e => setPrefix(e.target.value)}
              style={{
                maxWidth: "100%",
                width: "100%",
                marginTop: 7
              }}
            />

            {data?.isAdmin && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void savePolicy()}
                style={{marginTop: 17}}
              >
                {busy ? "Kaydediliyor..." : "Policy Kaydet"}
              </button>
            )}

            <p style={{
              background: "#fff7e8",
              color: "#835d23",
              padding: 13,
              borderRadius: 9,
              marginTop: 17,
              lineHeight: 1.6,
              fontSize: 12
            }}>
              Bu bütçe bir planlama hedefidir; Redis
              tarafından uygulanmış bir bellek kotası
              değildir. Yalnızca koru:...: biçimindeki
              çakışmayan namespace'ler kabul edilir.
            </p>
          </section>
        </div>
      )}

      <p style={{
        marginTop: 22,
        fontSize: 12,
        color: palette.muted,
        lineHeight: 1.7
      }}>
        Redis SCAN ölçümü limitlidir; büyük veri setlerinde
        kısmi sonuç oluşabilir. Namespace'e dahil olmayan
        anahtarlar departmana yazılmaz. Grafik ölçümleri
        canlı Redis verisinden üretilir, demo sayı kullanılmaz.
      </p>
    </main>
  );
}
