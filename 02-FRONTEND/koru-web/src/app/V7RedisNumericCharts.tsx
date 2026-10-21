"use client";

import { useEffect, useState } from "react";

type Point = {
  time: number;
  ops: number | null;
  memory: number | null;
  hit: number | null;
  clients: number | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 2
  }).format(n);

const memoryFmt = (n: number) =>
  n >= 1048576
    ? fmt(n / 1048576) + " MB"
    : fmt(n / 1024) + " KB";

function NumberChart({
  title, data, format
}: {
  title: string;
  data: {time:number; value:number|null}[];
  format: (n:number)=>string;
}) {
  const valid = data.filter(
    (p): p is {time:number;value:number} =>
      p.value !== null
  );

  const numbers = valid.map(p => p.value);
  const latest = valid.at(-1);

  const min = numbers.length ? Math.min(...numbers) : 0;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const padding = Math.max((max-min)*0.12, 0.5);
  const low = min-padding;
  const high = max+padding;
  const range = Math.max(high-low,1);

  const left = 90;
  const right = 480;
  const top = 32;
  const bottom = 160;

  const x = (i:number) =>
    left + i/Math.max(valid.length-1,1)*(right-left);

  const y = (n:number) =>
    bottom - ((n-low)/range)*(bottom-top);

  const points = valid.map(
    (p,i) => `${x(i)},${y(p.value)}`
  ).join(" ");

  return <article style={{
    background:"white",
    border:"1px solid #dce5e9",
    borderRadius:15,
    padding:20,
    minWidth:0
  }}>
    <div style={{color:"#617684",fontSize:13}}>
      {title}
    </div>

    <div style={{
      fontSize:29,
      fontWeight:750,
      marginTop:9,
      color:"#163d43"
    }}>
      {latest ? format(latest.value) : "—"}
    </div>

    <svg viewBox="0 0 510 208"
      width="100%"
      role="img"
      aria-label={title+" zaman grafigi"}
      style={{display:"block",marginTop:15}}>
      {[0,0.5,1].map(f=>{
        const yy=bottom-f*(bottom-top);
        return <g key={f}>
          <line x1={left} x2={right}
            y1={yy} y2={yy}
            stroke="#dce4e9"
            strokeDasharray="4 5"/>
          <text x={left-7} y={yy+4}
            fontSize="11" fill="#617684"
            textAnchor="end">
            {format(low+f*range)}
          </text>
        </g>;
      })}

      {valid.length>1&&
        <polyline
          points={points}
          fill="none"
          stroke="#16856f"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />}

      {latest&&<g>
        <circle
          cx={x(valid.length-1)}
          cy={y(latest.value)}
          r="5"
          fill="#16856f"
        />
        <text
          x={x(valid.length-1)-7}
          y={Math.max(17,y(latest.value)-12)}
          textAnchor="end"
          fontSize="12"
          fontWeight="bold"
          fill="#16856f">
          {format(latest.value)}
        </text>
      </g>}

      {valid.length===0&&
        <text x="280" y="108"
          textAnchor="middle"
          fill="#64748b">
          Canli olcum bekleniyor
        </text>}

      {valid.length>0&&<g fill="#64748b" fontSize="11">
        <text x={left} y="185">
          {new Date(valid[0].time).toLocaleTimeString("tr-TR")}
        </text>
        <text x={right} y="185" textAnchor="end">
          {new Date(valid[valid.length-1].time)
            .toLocaleTimeString("tr-TR")}
        </text>
      </g>}
    </svg>

    <div style={{
      display:"flex",
      gap:15,
      flexWrap:"wrap",
      fontSize:12,
      color:"#607481"
    }}>
      <span>Min: {numbers.length?format(min):"—"}</span>
      <span>Max: {numbers.length?format(max):"—"}</span>
      <span>Ölçüm: {numbers.length}</span>
    </div>
  </article>;
}

export default function V7RedisNumericCharts({
  token
}: {token:string}) {
  const [history,setHistory]=useState<Point[]>([]);
  const [error,setError]=useState("");

  useEffect(()=>{
    if(!token)return;
    let active=true;
    let busy=false;

    const read=async()=>{
      if(busy)return;
      busy=true;
      try {
        const res=await fetch("/api/v5/redis/metrics",{
          headers:{Authorization:"Bearer "+token},
          cache:"no-store"
        });

        if(!res.ok)throw Error("Redis API HTTP "+res.status);

        const d=await res.json();
        if(d.connected!==true)
          throw Error("Redis bağlantısı yok");

        const num=(v:unknown):number|null=>{
          if(v===null||v===undefined||v==="")return null;
          const n=Number(v);
          return Number.isFinite(n)?n:null;
        };

        const point:Point={
          time:Date.now(),
          ops:num(d.operationsPerSecond),
          memory:num(d.memoryBytes),
          hit:num(d.hitRatio),
          clients:num(d.clients)
        };

        if(active){
          setHistory(h=>[...h,point].slice(-40));
          setError("");
        }
      }catch(e){
        if(active)setError(
          e instanceof Error?e.message:"Metrik hatası"
        );
      }finally{
        busy=false;
      }
    };

    void read();
    const id=setInterval(()=>void read(),5000);

    return ()=>{
      active=false;
      clearInterval(id);
    };
  },[token]);

  const series=(field:keyof Omit<Point,"time">)=>
    history.map(p=>({time:p.time,value:p[field]}));

  return <section style={{margin:"32px 0 60px"}}>
    <h2>Redis Canlı Performans Grafikleri</h2>
    <p style={{color:"#64748b"}}>
      Son 40 ölçüm · 5 saniyede bir yenileme ·
      Anlık değer, min/max ve sayısal eksenler
    </p>

    {error&&<p role="alert"
      style={{color:"#b42332"}}>{error}</p>}

    <div style={{
      display:"grid",
      gridTemplateColumns:
        "repeat(auto-fit,minmax(310px,1fr))",
      gap:17,
      marginTop:20
    }}>
      <NumberChart
        title="Operations / sec"
        data={series("ops")}
        format={fmt}/>
      <NumberChart
        title="Used Memory"
        data={series("memory")}
        format={memoryFmt}/>
      <NumberChart
        title="Cache HIT Ratio"
        data={series("hit")}
        format={n=>fmt(n)+"%"}/>
      <NumberChart
        title="Connected Clients"
        data={series("clients")}
        format={fmt}/>
    </div>
  </section>;
}
