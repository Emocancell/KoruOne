"use client";

import {useCallback,useEffect,useState} from "react";

type Metrics = {
 connected:boolean;
 version:string;
 role:string;
 memoryBytes:number;
 memoryRssBytes:number;
 maxMemoryBytes:number;
 clients:number;
 hits:number;
 misses:number;
 hitRatio:number;
 evictions:number;
 expired:number;
 operationsPerSecond:number;
 totalKeys:number;
 uptimeSeconds:number;
 rejectedConnections:number;
 checkedAt:string;
};

type Sample = {
 time:string;
 ops:number;
 memory:number;
 clients:number;
};

const fmt=(n:number)=>
 new Intl.NumberFormat("tr-TR").format(n);

const mb=(n:number)=>
 (n/1048576).toFixed(2)+" MB";

export default function V7RedisDashboard({
 token
}:{token:string}) {

 const [data,setData]=useState<Metrics|null>(null);
 const [history,setHistory]=useState<Sample[]>([]);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);
 const [auto,setAuto]=useState(true);
 const [metric,setMetric]=useState<
  "ops"|"memory"|"clients"
 >("ops");

 const load=useCallback(async()=>{
  if(!token)return;
  setLoading(true);

  try{
   const r=await fetch("/api/v5/redis/metrics",{
    headers:{Authorization:`Bearer ${token}`},
    cache:"no-store"
   });

   if(!r.ok)throw Error("Redis API HTTP "+r.status);

   const d:Metrics=await r.json();
   setData(d);
   setError("");

   setHistory(old=>[...old,{
    time:new Date().toLocaleTimeString("tr-TR"),
    ops:d.operationsPerSecond,
    memory:d.memoryBytes/1048576,
    clients:d.clients
   }].slice(-30));

  }catch(e){
   setError(e instanceof Error?e.message:"Bağlantı hatası");
  }finally{
   setLoading(false);
  }
 },[token]);

 useEffect(()=>{
  void load();
 },[load]);

 useEffect(()=>{
  if(!auto)return;
  const timer=setInterval(()=>void load(),5000);
  return ()=>clearInterval(timer);
 },[auto,load]);

 const cards=[
  ["Operations / sec",fmt(data?.operationsPerSecond??0)],
  ["Memory Usage",mb(data?.memoryBytes??0)],
  ["Connected Clients",fmt(data?.clients??0)],
  ["Total Keys",fmt(data?.totalKeys??0)],
  ["Cache HIT",fmt(data?.hits??0)],
  ["Cache MISS",fmt(data?.misses??0)],
  ["Hit Ratio",data?.hits||data?.misses
    ?`${data?.hitRatio??0}%`:"—"],
  ["Evicted Keys",fmt(data?.evictions??0)],
  ["Expired Keys",fmt(data?.expired??0)],
  ["Rejected Connections",fmt(data?.rejectedConnections??0)],
  ["Memory RSS",mb(data?.memoryRssBytes??0)],
  ["Uptime",Math.floor((data?.uptimeSeconds??0)/3600)+" saat"]
 ];

 const values=history.map(x=>x[metric]);
 const max=Math.max(1,...values);
 const memoryPercent=data?.maxMemoryBytes
  ? Math.min(100,100*data.memoryBytes/data.maxMemoryBytes)
  : 0;

 return <div className="v7-redis">
  <section className="v7-hero">
   <div>
    <p className="muted">KORU ONE / REDIS CONTROL CENTER</p>
    <h2>Redis Intelligence</h2>
    <p>Canlı telemetri, performans ve sistem sağlığı</p>
   </div>
   <div className="v7-actions">
    <span className={data?.connected?"v7-online":"v7-offline"}>
     {data?.connected?"● Connected":"● Not connected"}
    </span>
    <button className="secondary" onClick={()=>setAuto(!auto)}>
     {auto?"Otomatik: Açık":"Otomatik: Kapalı"}
    </button>
    <button onClick={()=>void load()} disabled={loading}>
     {loading?"Yenileniyor":"Yenile"}
    </button>
   </div>
  </section>

  {error&&<p className="error" role="alert">{error}</p>}

  {!data&&<section className="card">
   Redis telemetrisi yükleniyor. Yetkili oturum gereklidir.
  </section>}

  {data&&<>
   <div className="v7-stats">
    {cards.map(([label,value])=>
     <div className="v7-stat" key={label}>
      <span>{label}</span>
      <strong>{value}</strong>
     </div>
    )}
   </div>

   <section className="v7-panel">
    <div className="v7-panel-heading">
     <div>
      <h3>Live Performance</h3>
      <p className="muted">Son 30 ölçüm · 5 saniye aralık</p>
     </div>
     <div className="v7-actions">
      {(["ops","memory","clients"] as const).map(k=>
       <button key={k}
        className={metric===k?"":"secondary"}
        onClick={()=>setMetric(k)}>
        {k==="ops"?"OPS":k==="memory"?"RAM":"Clients"}
       </button>
      )}
     </div>
    </div>

    <div className="v7-chart">
     {history.map((point,i)=>
      <div className="v7-chart-col"
       key={i}
       title={`${point.time}: ${point[metric].toFixed(2)}`}>
       <div style={{
        height:Math.max(3,point[metric]/max*100)+"%"
       }}/>
      </div>
     )}
    </div>
    <p className="muted">
     Grafik yalnızca sayfa açıkken toplanan ölçümleri gösterir.
    </p>
   </section>

   <div className="v7-bottom">
    <section className="v7-panel">
     <h3>Memory Analysis</h3>
     <p>Kullanılan: <b>{mb(data.memoryBytes)}</b></p>
     <p>RSS: <b>{mb(data.memoryRssBytes)}</b></p>
     <div className="v7-progress">
      <div style={{width:memoryPercent+"%"}}/>
     </div>
     <p className="muted">
      {data.maxMemoryBytes
       ?`Limit: ${mb(data.maxMemoryBytes)} · %${memoryPercent.toFixed(2)}`
       :"Maxmemory sınırı tanımlanmamış"}
     </p>
    </section>

    <section className="v7-panel">
     <h3>Redis Instance</h3>
     <p>Sürüm: <b>{data.version}</b></p>
     <p>Rol: <b>{data.role}</b></p>
     <p>Bağlantı: <b>{data.connected?"Aktif":"Kapalı"}</b></p>
     <p>Son ölçüm: <b>{new Date(data.checkedAt)
      .toLocaleTimeString("tr-TR")}</b></p>
     <p className="muted">
      Bu görünüm mevcut uygulama Redis örneğine aittir.
     </p>
    </section>
   </div>
  </>}
 </div>;
}
