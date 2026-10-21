"use client";
// KORU_V77_DIAGNOSTICS

import { useCallback, useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

type NodeReport = {
  id: string;
  name: string;
  connected: boolean;
  error?: string | null;

  version?: string | null;
  redisMode?: string | null;
  role?: string | null;

  clusterEnabled?: boolean | null;
  connectedReplicas?: number | null;
  masterLinkStatus?: string | null;

  aofEnabled?: boolean | null;
  rdbLastBgsaveStatus?: string | null;
  rdbChangesSinceLastSave?: number | null;
  aofLastRewriteStatus?: string | null;

  memoryBytes?: number | null;
  memoryRssBytes?: number | null;
  memoryPeakBytes?: number | null;
  maxMemoryBytes?: number | null;
  maxMemoryPolicy?: string | null;
  fragmentation?: number | null;

  clients?: number | null;
  blockedClients?: number | null;
  rejectedConnections?: number | null;
  totalErrorReplies?: number | null;

  evictions?: number | null;
  expiredKeys?: number | null;
  hits?: number | null;
  misses?: number | null;

  operationsPerSecond?: number | null;
  uptimeSeconds?: number | null;
  latencyMs?: number | null;

  checkedAt?: string;
};

type ResponseData = {
  checkedAt: string;
  nodes: NodeReport[];
};

type Finding = {
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(n);

function bytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${fmt(n)} B`;
  if (n < 1048576) return `${fmt(n / 1024)} KB`;
  if (n < 1073741824) return `${fmt(n / 1048576)} MB`;
  return `${fmt(n / 1073741824)} GB`;
}

function value(
  n: string | number | null | undefined
) {
  if (n === null || n === undefined) return "—";
  return typeof n === "number" ? fmt(n) : n;
}

const box: React.CSSProperties = {
  padding: 20,
  borderRadius: 15,
  border: "1px solid #dce5e9",
  background: "#ffffff"
};

function analyze(node: NodeReport): Finding[] {
  const result: Finding[] = [];

  if (!node.connected) {
    return [{
      level: "critical",
      title: "Node tanilama basarisiz",
      detail: node.error || "Baglanti ya da INFO okunamadi."
    }];
  }

  const used = node.memoryBytes;
  const max = node.maxMemoryBytes;

  if (max !== null && max !== undefined && max > 0 &&
      used !== null && used !== undefined) {
    const usage = used / max * 100;

    if (usage >= 90) {
      result.push({
        level: "critical",
        title: "Bellek limiti kritik",
        detail: `Bellek dolulugu %${fmt(usage)}.`
      });
    } else if (usage >= 75) {
      result.push({
        level: "warning",
        title: "Bellek kapasitesi izlenmeli",
        detail: `Bellek dolulugu %${fmt(usage)}.`
      });
    }
  }

  if (max === 0) {
    result.push({
      level: "info",
      title: "Maxmemory limiti yok",
      detail:
        "Bu node icin bellek ust siniri tanimli degil. " +
        "Kullanim amacina gore kapasite politikasi belirlenmeli."
    });
  }

  if (
    node.role === "slave" &&
    node.masterLinkStatus === "down"
  ) {
    result.push({
      level: "critical",
      title: "Replication baglantisi kopuk",
      detail: "Replica, primary sunucuya baglanamiyor."
    });
  }

  if (node.rdbLastBgsaveStatus === "err") {
    result.push({
      level: "critical",
      title: "RDB snapshot hatasi",
      detail: "Son background save basarisiz olmus."
    });
  }

  if (node.aofEnabled === false) {
    result.push({
      level: "info",
      title: "AOF kapali",
      detail:
        "AOF etkin degil. RDB veya baska veri koruma " +
        "yontemleri ayrica degerlendirilmeli."
    });
  }

  if (node.clusterEnabled === false) {
    result.push({
      level: "info",
      title: "Redis Cluster etkin degil",
      detail:
        "Bu instance Cluster modunda calismiyor. " +
        "Sentinel ve harici HA yapilari ayrica incelenmeli."
    });
  }

  if ((node.rejectedConnections ?? 0) > 0) {
    result.push({
      level: "warning",
      title: "Gecmiste reddedilen baglantilar",
      detail:
        `${fmt(node.rejectedConnections ?? 0)} baglanti ` +
        "sunucu baslangicindan beri reddedilmis."
    });
  }

  if ((node.evictions ?? 0) > 0) {
    result.push({
      level: "info",
      title: "Eviction kaydi var",
      detail:
        `${fmt(node.evictions ?? 0)} eviction, ` +
        "sunucu baslangicindan beri kaydedilmis."
    });
  }

  if (
    (node.fragmentation ?? 0) > 3 &&
    (node.memoryBytes ?? 0) < 67108864
  ) {
    result.push({
      level: "info",
      title: "Fragmentation yorumu",
      detail:
        "Redis bellegi cok kucuk oldugundan yuksek RSS " +
        "orani tek basina bellek sorunu anlamina gelmez."
    });
  }

  if (!result.length) {
    result.push({
      level: "info",
      title: "Tanili esik asimi yok",
      detail:
        "Kontrol edilen alanlarda belirgin uyarı bulunmadi. " +
        "Bu sonuc tam guvenlik veya HA testi degildir."
    });
  }

  return result;
}

function InfoCard({
  title,
  content,
  detail
}: {
  title: string;
  content: string;
  detail?: string;
}) {
  return <div style={box}>
    <div style={{fontSize:13,color:"#63788b"}}>
      {title}
    </div>
    <strong style={{
      display:"block",
      fontSize:23,
      marginTop:10,
      color:"#17334a",
      overflowWrap:"anywhere"
    }}>
      {content}
    </strong>
    {detail && <p style={{
      marginBottom:0,
      color:"#64748b",
      fontSize:12
    }}>{detail}</p>}
  </div>;
}

function NodeSection({node}: {node: NodeReport}) {
  const findings = analyze(node);

  const used = node.memoryBytes;
  const max = node.maxMemoryBytes;

  const usage = (
    used !== null && used !== undefined &&
    max !== null && max !== undefined && max > 0
  ) ? used / max * 100 : null;

  const fields: {
    title: string;
    content: string;
    detail?: string;
  }[] = [
    {
      title:"Redis Sürümü",
      content:value(node.version)
    },
    {
      title:"Çalışma Modu",
      content:value(node.redisMode)
    },
    {
      title:"Replication Rolü",
      content:value(node.role)
    },
    {
      title:"Bağlı Replica",
      content:value(node.connectedReplicas)
    },
    {
      title:"AOF",
      content:node.aofEnabled === null ||
        node.aofEnabled === undefined
          ? "Bilinmiyor"
          : node.aofEnabled ? "Aktif" : "Kapalı"
    },
    {
      title:"Son RDB Durumu",
      content:value(node.rdbLastBgsaveStatus)
    },
    {
      title:"Bellek Limiti",
      content:max === 0 ? "Limitsiz" : bytes(max)
    },
    {
      title:"Bellek Politikası",
      content:value(node.maxMemoryPolicy)
    },
    {
      title:"Peak Memory",
      content:bytes(node.memoryPeakBytes)
    },
    {
      title:"Connected Clients",
      content:value(node.clients)
    },
    {
      title:"Blocked Clients",
      content:value(node.blockedClients),
      detail:"Blocking stream okumaları burada normal olabilir."
    },
    {
      title:"Rejected Connections",
      content:value(node.rejectedConnections)
    },
    {
      title:"Error Replies",
      content:value(node.totalErrorReplies)
    },
    {
      title:"Ping Latency",
      content:node.latencyMs == null
        ? "—" : `${fmt(node.latencyMs)} ms`
    },
    {
      title:"Evictions",
      content:value(node.evictions)
    },
    {
      title:"Expired Keys",
      content:value(node.expiredKeys)
    }
  ];

  return <section style={{marginTop:24}}>
    <div style={{
      ...box,
      marginBottom:16,
      borderLeft:node.connected
        ? "4px solid #16866b"
        : "4px solid #b91c1c"
    }}>
      <div style={{
        display:"flex",
        justifyContent:"space-between",
        alignItems:"center",
        gap:12,
        flexWrap:"wrap"
      }}>
        <div>
          <h2 style={{margin:"0 0 8px"}}>
            {node.name}
          </h2>
          <span style={{fontSize:13,color:"#64748b"}}>
            {node.id}
          </span>
        </div>
        <strong style={{
          color:node.connected?"#16866b":"#b91c1c"
        }}>
          {node.connected?"CONNECTED":"UNAVAILABLE"}
        </strong>
      </div>

      {usage !== null && (
        <div style={{marginTop:18}}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            fontSize:13,
            marginBottom:7
          }}>
            <span>Memory Capacity</span>
            <b>{fmt(usage)}%</b>
          </div>
          <div style={{
            background:"#e6ecf0",
            borderRadius:10,
            height:13,
            overflow:"hidden"
          }}>
            <div style={{
              background:usage>=90?"#c03b40":
                usage>=75?"#bd8a2b":"#16866b",
              width:`${Math.min(100,Math.max(0,usage))}%`,
              height:"100%"
            }}/>
          </div>
          <p style={{fontSize:12,color:"#64748b"}}>
            {bytes(used)} / {bytes(max)}
          </p>
        </div>
      )}
    </div>

    <div style={{
      display:"grid",
      gridTemplateColumns:
        "repeat(auto-fit,minmax(210px,1fr))",
      gap:14
    }}>
      {fields.map(field=>
        <InfoCard
          key={field.title}
          title={field.title}
          content={field.content}
          detail={field.detail}
        />
      )}
    </div>

    <div style={{...box,marginTop:17}}>
      <h3 style={{marginTop:0}}>
        Risk & Capacity Findings
      </h3>

      <div style={{display:"grid",gap:10}}>
        {findings.map((finding,index)=>{
          const color = finding.level==="critical"
            ? "#b91c1c"
            : finding.level==="warning"
              ? "#a56b14"
              : "#256d82";

          return <div key={index} style={{
            borderLeft:`3px solid ${color}`,
            padding:"12px 14px",
            background:"#f8fafb",
            borderRadius:7
          }}>
            <strong style={{color}}>
              {finding.level.toUpperCase()}
              {" · "}{finding.title}
            </strong>
            <p style={{
              fontSize:13,
              color:"#526675",
              margin:"6px 0 0"
            }}>
              {finding.detail}
            </p>
          </div>;
        })}
      </div>
    </div>
  </section>;
}

export default function RedisDiagnosticsPage() {
  const [token,setToken] = useState("");
  const [data,setData] = useState<ResponseData|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const [auto,setAuto] = useState(true);

  useEffect(()=>{
    let active=true;
    const authority=process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if(!authority){
      setError("Keycloak ayari bulunamadi.");
      return;
    }

    const manager=new UserManager({
      authority,
      client_id:"koru-web",
      redirect_uri:window.location.origin+"/callback",
      response_type:"code",
      scope:"openid profile email"
    });

    manager.getUser().then(user=>{
      if(!active)return;
      if(!user||user.expired||!user.access_token){
        setError("Lutfen giris yapin.");
      }else{
        setToken(user.access_token);
      }
    }).catch(()=>{
      if(active)setError("Oturum okunamadi.");
    });

    return ()=>{active=false};
  },[]);

  const refresh=useCallback(async()=>{
    if(!token)return;
    setLoading(true);

    try {
      const response=await fetch(
        "/api/v7/redis/diagnostics",
        {
          headers:{Authorization:"Bearer "+token},
          cache:"no-store"
        }
      );

      if(!response.ok){
        throw new Error(
          "Diagnostics API HTTP "+response.status
        );
      }

      const result=await response.json() as ResponseData;

      if(!Array.isArray(result.nodes)){
        throw Error("API veri yapisi beklenenden farkli.");
      }

      setData(result);
      setError("");
    }catch(e){
      setError(
        e instanceof Error ? e.message : "Tanilama hatasi"
      );
    }finally{
      setLoading(false);
    }
  },[token]);

  useEffect(()=>{
    if(!token)return;
    void refresh();

    if(!auto)return;

    const timer=setInterval(
      ()=>void refresh(),
      15000
    );

    return ()=>clearInterval(timer);
  },[token,auto,refresh]);

  function exportJson(){
    if(!data)return;

    const file=new Blob(
      [JSON.stringify(data,null,2)],
      {type:"application/json"}
    );

    const url=URL.createObjectURL(file);
    const anchor=document.createElement("a");

    anchor.href=url;
    anchor.download="koru-redis-diagnostics.json";
    anchor.click();

    URL.revokeObjectURL(url);
  }

  const connected=data?.nodes.filter(n=>n.connected).length??0;

  return <main style={{
    maxWidth:1440,
    padding:"30px 22px 65px",
    margin:"0 auto",
    color:"#17334a"
  }}>
    <div style={{
      display:"flex",
      justifyContent:"space-between",
      gap:15,
      alignItems:"flex-start",
      flexWrap:"wrap"
    }}>
      <div>
        <p style={{
          color:"#087e78",
          fontSize:12,
          fontWeight:700,
          letterSpacing:1
        }}>
          KORU ONE / REDIS CONTROL PLANE
        </p>
        <h1 style={{fontSize:35,margin:"8px 0"}}>
          Redis Diagnostics & Capacity
        </h1>
        <p style={{color:"#657b8a"}}>
          Multi-node persistence, replication,
          memory policy ve kapasite analizi
        </p>
      </div>

      <div style={{
        display:"flex",
        gap:9,
        alignItems:"center",
        flexWrap:"wrap"
      }}>
        <Link href="/redis-fleet">
          ← Redis Fleet
        </Link>
        <button onClick={()=>setAuto(x=>!x)}>
          Auto: {auto?"ON":"OFF"}
        </button>
        <button onClick={()=>void refresh()}
          disabled={loading||!token}>
          {loading?"Okunuyor...":"Yenile"}
        </button>
        <button onClick={exportJson} disabled={!data}>
          JSON Rapor
        </button>
      </div>
    </div>

    {error&&<div role="alert" style={{
      ...box,
      marginTop:20,
      color:"#b91c1c",
      borderColor:"#efaaaa"
    }}>
      {error}
    </div>}

    <div style={{
      display:"grid",
      gridTemplateColumns:
        "repeat(auto-fit,minmax(200px,1fr))",
      gap:14,
      marginTop:25
    }}>
      <InfoCard
        title="Envanterdeki Node"
        content={data?value(data.nodes.length):"—"}
      />
      <InfoCard
        title="Bağlı Node"
        content={data?
          `${connected}/${data.nodes.length}`:"—"}
      />
      <InfoCard
        title="Monitoring Durumu"
        content={error?"Hata":data?"Aktif":"Bekleniyor"}
      />
      <InfoCard
        title="Son Kontrol"
        content={data
          ? new Date(data.checkedAt)
              .toLocaleTimeString("tr-TR")
          : "—"}
        detail="15 saniyelik yenileme"
      />
    </div>

    {data?.nodes.map(node=>(
      <NodeSection key={node.id} node={node}/>
    ))}

    <section style={{
      ...box,
      background:"#f5f9fb",
      marginTop:25
    }}>
      <h3 style={{marginTop:0}}>Operasyon Güvenliği</h3>
      <p style={{
        color:"#64748b",
        fontSize:13,
        marginBottom:0
      }}>
        Bu ekran yalnızca tanılama amaçlıdır.
        Redis verileri, ACL hesapları veya node
        ayarları değiştirilmez. Cluster topolojisi,
        Sentinel, gerçek yedekleme, recovery
        ve failover senaryoları ayrıca test edilmelidir.
        Uyarılar anlık analizdir; kalıcı alarm sistemi değildir.
      </p>
    </section>
  </main>;
}
