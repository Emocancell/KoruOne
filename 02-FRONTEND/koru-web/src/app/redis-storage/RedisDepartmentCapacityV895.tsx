"use client";

import {useCallback,useEffect,useState} from "react";

type Department = {
  department:string;
  quotaMb:number;
  usedBytes:number;
  sampledKeys:number;
  complete:boolean;
};

type Capacity = {
  node:string;
  memoryMb:number;
  assignedMb:number;
  departments:Department[];
};

type Props = {
  nodeId:string;
  token:string;
  admin:boolean;
  session?:string;
};

const MB=1048576;
const green="#158069";
const ink="#1b3545";
const muted="#718696";
const border="#dce7eb";

const labels:Record<string,string>={
  hr:"Human Resources",
  marketing:"Marketing",
  it:"IT Operations",
  network:"Network",
  advertising:"Advertising",
  redis:"Redis Operations"
};

const fmt=(n:number)=>
  n.toLocaleString("tr-TR",{
    maximumFractionDigits:2,
    minimumFractionDigits:2
  });

export default function RedisDepartmentCapacityV895({
  nodeId,token,admin,session
}:Props){
  const [data,setData]=useState<Capacity|null>(null);
  const [values,setValues]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    if(!token||!session)return;

    try{
      const response=await fetch(
        `/api/v8/redis/multi/nodes/${nodeId}/department-capacity`,
        {
          headers:{
            Authorization:`Bearer ${token}`,
            ...(session
              ? {"X-Koru-Redis-Session":session}
              : {})
          },
          cache:"no-store"
        }
      );

      if(!response.ok){
        if(response.status===401)
          throw Error("HTTP 401: Yeniden giris yap.");
        throw Error(`Kota API HTTP ${response.status}`);
      }

      const result=await response.json() as Capacity;
      setData(result);

      setValues(previous=>{
        const updated={...previous};

        for(const d of result.departments){
          if(updated[d.department]===undefined)
            updated[d.department]=String(d.quotaMb);
        }

        return updated;
      });
    }catch(e){
      setMessage(e instanceof Error?e.message:String(e));
    }
  },[nodeId,token,admin,session]);

  useEffect(()=>{
    void load();

    const interval=window.setInterval(()=>{
      if(document.visibilityState==="visible")void load();
    },15000);

    return ()=>window.clearInterval(interval);
  },[load]);

  async function save(department:string){
    if(!admin||busy||!data)return;

    const quota=Number(values[department]);

    if(
      values[department]?.trim()==="" ||
      !Number.isInteger(quota) ||
      quota<0 ||
      quota>data.memoryMb
    ){
      setMessage("Gecerli bir MB kotasi gir.");
      return;
    }

    setBusy(department);
    setMessage("");

    try{
      const response=await fetch(
        `/api/v8/redis/multi/nodes/${nodeId}/department-capacity/${department}`,
        {
          method:"PUT",
          headers:{
            Authorization:`Bearer ${token}`,
            "Content-Type":"application/json"
          },
          body:JSON.stringify({memoryMb:quota})
        }
      );

      if(!response.ok){
        let detail=`HTTP ${response.status}`;

        try{
          const body=await response.json();
          detail=body.message||detail;
        }catch{}

        throw Error(detail);
      }

      setMessage(
        `${labels[department]??department}: ${quota} MB kaydedildi.`
      );

      await load();
    }catch(e){
      setMessage(e instanceof Error?e.message:String(e));
    }finally{
      setBusy("");
    }
  }

  return (
    <section style={{
      background:"#fff",
      border:`1px solid ${border}`,
      borderRadius:15,
      padding:20,
      marginTop:18,
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
          <h3 style={{margin:"0 0 5px"}}>
            {nodeId.toUpperCase()} · Departman RAM Yönetimi
          </h3>
          <p style={{color:muted,fontSize:12,margin:0}}>
            Departman bazlı kota, gerçek key kullanımı ve boş alan
          </p>
        </div>

        <button
          type="button"
          onClick={()=>void load()}
          style={{
            border:`1px solid ${border}`,
            background:"#f2f7f5",
            borderRadius:9,
            padding:"9px 14px",
            color:ink
          }}
        >
          Yenile
        </button>
      </div>

      {data&&
        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(3,minmax(0,1fr))",
          gap:10,
          marginTop:18
        }}>
          {[
            ["Redis kapasitesi",`${data.memoryMb} MB`],
            ["Bu hesabın kotası",
              data.assignedMb>0
                ? `${data.assignedMb} MB`
                : "Kota tanımsız"],
            ["Kalan hesap kotası",
              data.assignedMb>0&&data.departments[0]?.complete
                ? `${Math.max(
                    0,
                    data.assignedMb-
                    (data.departments[0]?.usedBytes??0)/MB
                  ).toFixed(2)} MB`
                : "—"]
          ].map(([label,value])=>
            <div key={String(label)} style={{
              background:"#f6f9f8",
              padding:12,
              borderRadius:10
            }}>
              <div style={{fontSize:11,color:muted}}>
                {label}
              </div>
              <strong style={{fontSize:18}}>
                {value}
              </strong>
            </div>
          )}
        </div>
      }

      {message&&
        <p role="status" style={{
          color:"#986329",
          fontSize:12,
          marginTop:12
        }}>
          {message}
        </p>
      }

      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(255px,1fr))",
        gap:12,
        marginTop:18
      }}>
        {data?.departments.map(d=>{
          const used=d.usedBytes/MB;
          const adminAccount=d.department==="koru_admin";
          const limit=adminAccount
            ? data.memoryMb
            : d.quotaMb;
          const percent=limit>0?used/limit*100:0;
          const width=Math.min(100,Math.max(0,percent));
          const remaining=Math.max(0,limit-used);

          return (
            <article key={d.department} style={{
              border:`1px solid ${border}`,
              borderRadius:12,
              padding:15,
              background:"#fff"
            }}>
              <strong>
                {labels[d.department]??d.department}
              </strong>

              <div style={{
                color:muted,
                fontSize:12,
                marginTop:6
              }}>
                koru:{d.department==="koru_admin"?"redis":d.department}:*
              </div>

              <div style={{
                display:"flex",
                justifyContent:"space-between",
                gap:8,
                marginTop:15,
                fontSize:12
              }}>
                <b>{d.complete?"":"≥ "}{fmt(used)} MB</b>
                <span>
                  {adminAccount
                    ? `${limit} MB Redis toplam limiti`
                    : limit>0
                      ? `${limit} MB kota`
                      : "Kota tanımsız"}
                </span>
              </div>

              <div style={{
                height:11,
                background:"#e7eef0",
                borderRadius:15,
                overflow:"hidden",
                marginTop:9
              }}>
                {limit>0&&
                  <div style={{
                    height:"100%",
                    width:`${width}%`,
                    background:percent>=90?"#b44957":green,
                    borderRadius:15,
                    transition:"width .3s ease"
                  }}/>
                }
              </div>

              <div style={{
                display:"flex",
                justifyContent:"space-between",
                gap:8,
                marginTop:8,
                color:muted,
                fontSize:11
              }}>
                <span>
                  {limit>0&&d.complete
                    ? `%${fmt(percent)} dolu`
                    : limit>0
                      ? "Kısmi ölçüm"
                      : "Limit tanımsız"}
                </span>

                <span>
                  {limit>0&&d.complete
                    ? `${fmt(remaining)} MB boş`
                    : "—"}
                </span>
              </div>

              <div style={{
                fontSize:11,
                color:muted,
                marginTop:7
              }}>
                {d.sampledKeys} key ölçüldü
                {!d.complete&&" · Kısmi tarama"}
              </div>

              {admin&&d.department!=="koru_admin"&&
                <div style={{
                  display:"flex",
                  alignItems:"center",
                  gap:8,
                  marginTop:15
                }}>
                  <input
                    type="number"
                    min={0}
                    max={data.memoryMb}
                    aria-label={`${d.department} RAM MB`}
                    value={values[d.department]??String(limit)}
                    onChange={e=>setValues(v=>({
                      ...v,
                      [d.department]:e.target.value
                    }))}
                    style={{
                      minWidth:0,
                      width:"100%",
                      padding:9,
                      border:`1px solid ${border}`,
                      borderRadius:9
                    }}
                  />
                  <span style={{fontSize:12}}>MB</span>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={()=>void save(d.department)}
                    style={{
                      background:green,
                      color:"#fff",
                      border:0,
                      padding:"10px 13px",
                      borderRadius:9,
                      fontWeight:600,
                      cursor:"pointer"
                    }}
                  >
                    {busy===d.department?"...":"Kaydet"}
                  </button>
                </div>
              }

              {admin&&d.department!=="koru_admin"&&
                <div style={{
                  color:muted,
                  fontSize:11,
                  marginTop:8
                }}>
                  0 MB = Kota sınırı kaldırılır
                </div>
              }
            </article>
          );
        })}
      </div>

      <p style={{
        marginTop:14,
        fontSize:11,
        color:muted
      }}>
        Departman kotaları KORU ONE API üzerinden yapılan
        key yazımlarına uygulanır. Redis CLI veya başka
        uygulamalardaki doğrudan yazımları sınırlandırmaz.
        Ölçüm key belleğidir, ortak Redis overhead'i değildir.
      </p>
    </section>
  );
}
