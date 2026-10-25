"use client";

import {useCallback,useEffect,useRef,useState} from "react";

type Group = {
  name:string;
  count:number;
};

type Node = {
  id:string;
  online:boolean;
  usedBytes:number;
  overheadBytes:number;
  datasetBytes:number;
  maxMemoryBytes:number;
  totalKeys:number;
  scannedKeys:number;
  scanComplete:boolean;
  groups:Group[];
};

type Snapshot = {
  checkedAt:string;
  nodes:Node[];
};

function bytes(n:number) {
  if(n<1024)return `${n} B`;

  const units=["KB","MB","GB","TB"];
  let value=n/1024;
  let index=0;

  while(value>=1024&&index<units.length-1){
    value/=1024;
    index++;
  }

  return `${value.toLocaleString("tr-TR",{
    maximumFractionDigits:2
  })} ${units[index]}`;
}

const border="#dae7e1";
const ink="#203c4c";
const muted="#718696";
const green="#147b66";

export default function RedisStorageLiveV89({
  token
}:{
  token:string
}) {
  const [data,setData]=useState<Snapshot|null>(null);
  const [auto,setAuto]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const inflight=useRef(false);

  const load=useCallback(async()=>{
    if(!token||inflight.current)return;

    inflight.current=true;
    setBusy(true);

    try {
      const response=await fetch(
        "/api/v8/redis/storage/live-v89",
        {
          headers:{
            Authorization:`Bearer ${token}`
          },
          cache:"no-store"
        }
      );

      if(!response.ok)
        throw new Error(`API HTTP ${response.status}`);

      const result=await response.json() as Snapshot;

      setData(result);
      setError("");
    }
    catch(e) {
      setError(
        e instanceof Error ? e.message :
        "Olcum okunamadi"
      );
    }
    finally {
      inflight.current=false;
      setBusy(false);
    }
  },[token]);

  useEffect(()=>{
    void load();
    if(!auto)return;

    const timer=window.setInterval(
      ()=>void load(),10000
    );

    return ()=>window.clearInterval(timer);
  },[auto,load]);

  return <section style={{
    background:"#fff",
    border:`1px solid ${border}`,
    borderRadius:16,
    padding:20,
    marginTop:20,
    color:ink
  }}>
    <div style={{
      display:"flex",
      justifyContent:"space-between",
      alignItems:"center",
      flexWrap:"wrap",
      gap:12
    }}>
      <div>
        <h2 style={{margin:"0 0 6px"}}>
          Real Redis Keyspace Breakdown
        </h2>
        <div style={{color:muted,fontSize:13}}>
          Redis 01+ · Gerçek RAM ve key sayısı ·
          Key adları ve içerikleri gizli
        </div>
      </div>

      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>setAuto(v=>!v)}
          style={{
            background:auto?green:"#e9f0ed",
            color:auto?"#fff":ink
          }}>
          Auto {auto?"ON":"OFF"} · 10 sn
        </button>
        <button onClick={()=>void load()}
          disabled={busy||!token}
          style={{background:green,color:"#fff"}}>
          {busy?"Ölçülüyor...":"Şimdi Ölç"}
        </button>
      </div>
    </div>

    {error&&<p role="alert" style={{
      color:"#b54708",
      background:"#fff5ed",
      padding:12,
      borderRadius:9
    }}>{error}</p>}

    <div style={{
      display:"grid",
      gridTemplateColumns:
        "repeat(auto-fit,minmax(290px,1fr))",
      gap:14,
      marginTop:20
    }}>
      {(data?.nodes??[]).map(node=>
        <article key={node.id} style={{
          padding:18,
          border:`1px solid ${border}`,
          borderRadius:13
        }}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center"
          }}>
            <h3 style={{margin:0}}>
              {node.id.replace("redis","Redis ")}
            </h3>
            <span style={{
              color:node.online?green:"#a83c46",
              fontSize:12
            }}>
              {node.online?"● Connected":"● Offline"}
            </span>
          </div>

          {node.online?<div>
            <div style={{
              display:"grid",
              gridTemplateColumns:"1fr 1fr",
              gap:9,
              marginTop:18
            }}>
              {[
                ["Toplam Key",String(node.totalKeys)],
                ["Gerçek RAM",bytes(node.usedBytes)],
                ["Dataset",bytes(node.datasetBytes)],
                ["Overhead",bytes(node.overheadBytes)]
              ].map(([name,value])=>
                <div key={name} style={{
                  background:"#f6f9f8",
                  borderRadius:9,
                  padding:12
                }}>
                  <div style={{
                    color:muted,fontSize:12
                  }}>{name}</div>
                  <strong style={{fontSize:17}}>
                    {value}
                  </strong>
                </div>
              )}
            </div>

            <div style={{
              marginTop:16,
              fontSize:12,
              color:muted
            }}>
              Namespace dağılımı
              {node.scanComplete?" · Tam tarama":" · Kısmi tarama"}
              {" · "}{node.scannedKeys} key incelendi
            </div>

            {node.groups.map(group=>
              <div key={group.name} style={{
                display:"flex",
                justifyContent:"space-between",
                padding:"9px 0",
                borderBottom:`1px solid ${border}`,
                fontSize:13
              }}>
                <span>{group.name}</span>
                <strong>{group.count} key</strong>
              </div>
            )}
          </div>:<p style={{color:muted,fontSize:13}}>
            Redis bağlantısı veya yönetici yetkisi kontrol edilmeli.
          </p>}
        </article>
      )}
    </div>

    <div style={{
      marginTop:16,
      fontSize:12,
      color:muted
    }}>
      {data?.checkedAt
        ? `Son ölçüm: ${new Date(
            data.checkedAt).toLocaleTimeString("tr-TR")}`
        : "Henüz ölçüm alınmadı"}

      {" · "}Yalnızca sayısal metrikler ve namespace toplamları
      gösterilir. Redis key değerleri okunmaz.
    </div>
  </section>;
}
