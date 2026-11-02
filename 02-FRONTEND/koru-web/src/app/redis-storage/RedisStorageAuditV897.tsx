"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

type AuditRecord = {
  at:string;
  actor:string;
  node:string;
  department:string;
  action:string;
  outcome:string;
};

const border="#dce6eb";
const muted="#718696";
const ink="#203c4c";
const green="#147b66";

const inputStyle:React.CSSProperties={
  width:"100%",
  minWidth:0,
  padding:"10px 12px",
  border:`1px solid ${border}`,
  borderRadius:9,
  background:"#fff",
  color:ink,
  fontSize:13
};

export default function RedisStorageAuditV897({
  token
}:{
  token:string
}){
  const [open,setOpen]=useState(false);
  const [records,setRecords]=useState<AuditRecord[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const [node,setNode]=useState("all");
  const [department,setDepartment]=useState("all");
  const [outcome,setOutcome]=useState("all");
  const [search,setSearch]=useState("");

  const load=useCallback(async()=>{
    if(!token)return;

    setBusy(true);

    try{
      const response=await fetch(
        "/api/v8/redis/multi/audit",
        {
          headers:{
            Authorization:`Bearer ${token}`
          },
          cache:"no-store"
        }
      );

      if(!response.ok){
        if(response.status===401)
          throw Error("Keycloak oturumu gecersiz.");
        if(response.status===403)
          throw Error("Audit loglari icin Admin yetkisi gerekli.");

        throw Error(`Audit API HTTP ${response.status}`);
      }

      const payload:unknown=await response.json();

      if(!Array.isArray(payload))
        throw Error("Audit API beklenmeyen veri dondurdu.");

      setRecords(payload as AuditRecord[]);
      setError("");
    }catch(e){
      setError(
        e instanceof Error?e.message:"Loglar okunamadi."
      );
    }finally{
      setBusy(false);
    }
  },[token]);

  useEffect(()=>{
    if(!open)return;

    void load();

    const timer=window.setInterval(()=>{
      if(document.visibilityState==="visible")
        void load();
    },30000);

    return ()=>window.clearInterval(timer);
  },[open,load]);

  const nodes=useMemo(
    ()=>[...new Set(records.map(x=>x.node))]
      .filter(Boolean).sort(),
    [records]
  );

  const departments=useMemo(
    ()=>[...new Set(records.map(x=>x.department))]
      .filter(Boolean).sort(),
    [records]
  );

  const outcomes=useMemo(
    ()=>[...new Set(records.map(x=>x.outcome))]
      .filter(Boolean).sort(),
    [records]
  );

  const visible=useMemo(()=>{
    const query=search.trim().toLocaleLowerCase("tr-TR");

    return records.filter(row=>{
      if(node!=="all"&&row.node!==node)return false;

      if(department!=="all"&&
         row.department!==department)return false;

      if(outcome!=="all"&&row.outcome!==outcome)return false;

      if(!query)return true;

      return [
        row.actor,
        row.node,
        row.department,
        row.action,
        row.outcome
      ].join(" ")
       .toLocaleLowerCase("tr-TR")
       .includes(query);
    });
  },[records,node,department,outcome,search]);

  const successes=visible.filter(x=>
    x.outcome.toLowerCase()==="success"
  ).length;

  const failures=visible.filter(x=>
    ["failed","denied","quota-exceeded"]
      .includes(x.outcome.toLowerCase())
  ).length;

  return (
    <details
      style={{
        marginTop:20,
        background:"#fff",
        border:`1px solid ${border}`,
        borderRadius:15,
        padding:20,
        color:ink
      }}
      onToggle={e=>setOpen(e.currentTarget.open)}
    >
      <summary style={{
        cursor:"pointer",
        fontSize:17,
        fontWeight:800
      }}>
        <span>Redis Activity Logs · Audit Trail</span>

        <span style={{
          display:"block",
          color:muted,
          fontWeight:400,
          fontSize:12,
          marginTop:6
        }}>
          Redis işlemleri, kullanıcı hareketleri,
          departmanlar ve işlem sonuçları
        </span>
      </summary>

      {open&&
        <div style={{marginTop:20}}>
          <div style={{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            flexWrap:"wrap",
            gap:12
          }}>
            <div>
              <strong style={{fontSize:15}}>
                Redis İşlem Geçmişi
              </strong>

              <div style={{
                fontSize:12,
                color:muted,
                marginTop:5
              }}>
                API tarafından getirilen son 75 kayıt
                içerisinden filtreleme yapılır.
              </div>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={()=>void load()}
              style={{
                background:green,
                color:"#fff",
                border:0,
                borderRadius:9,
                padding:"10px 15px",
                cursor:"pointer"
              }}
            >
              {busy?"Yükleniyor...":"Logları Yenile"}
            </button>
          </div>

          {error&&
            <p role="alert" style={{
              background:"#fff3eb",
              color:"#a34f2b",
              borderRadius:9,
              padding:12,
              fontSize:13,
              marginTop:15
            }}>
              {error}
            </p>
          }

          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(155px,1fr))",
            gap:11,
            marginTop:17
          }}>
            {[
              ["Görüntülenen Kayıt",visible.length],
              ["Başarılı İşlem",successes],
              ["Başarısız / Reddedilen",failures]
            ].map(([label,value])=>(
              <div
                key={String(label)}
                style={{
                  background:"#f6f9f8",
                  padding:14,
                  borderRadius:11
                }}
              >
                <div style={{
                  fontSize:12,
                  color:muted
                }}>
                  {label}
                </div>

                <strong style={{
                  display:"block",
                  fontSize:23,
                  marginTop:7
                }}>
                  {value}
                </strong>
              </div>
            ))}
          </div>

          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(165px,1fr))",
            gap:10,
            marginTop:19
          }}>
            <label style={{fontSize:12}}>
              Redis Instance
              <select
                value={node}
                onChange={e=>setNode(e.target.value)}
                style={{...inputStyle,marginTop:6}}
              >
                <option value="all">Tüm Redis'ler</option>
                {nodes.map(x=>
                  <option key={x} value={x}>{x}</option>
                )}
              </select>
            </label>

            <label style={{fontSize:12}}>
              Departman
              <select
                value={department}
                onChange={e=>setDepartment(e.target.value)}
                style={{...inputStyle,marginTop:6}}
              >
                <option value="all">Tüm Departmanlar</option>
                {departments.map(x=>
                  <option key={x} value={x}>{x}</option>
                )}
              </select>
            </label>

            <label style={{fontSize:12}}>
              İşlem Sonucu
              <select
                value={outcome}
                onChange={e=>setOutcome(e.target.value)}
                style={{...inputStyle,marginTop:6}}
              >
                <option value="all">Tüm Sonuçlar</option>
                {outcomes.map(x=>
                  <option key={x} value={x}>{x}</option>
                )}
              </select>
            </label>

            <label style={{fontSize:12}}>
              Kullanıcı / İşlem Ara
              <input
                value={search}
                onChange={e=>setSearch(e.target.value)}
                placeholder="Kullanıcı veya işlem..."
                style={{...inputStyle,marginTop:6}}
              />
            </label>
          </div>

          <div style={{
            overflowX:"auto",
            marginTop:20,
            border:`1px solid ${border}`,
            borderRadius:11
          }}>
            <table style={{
              width:"100%",
              borderCollapse:"collapse",
              fontSize:12,
              minWidth:680
            }}>
              <thead style={{background:"#f5f8f7"}}>
                <tr>
                  {[
                    "Tarih / Saat",
                    "Kullanıcı",
                    "Redis",
                    "Departman",
                    "İşlem",
                    "Sonuç"
                  ].map(title=>
                    <th
                      key={title}
                      style={{
                        textAlign:"left",
                        padding:13,
                        borderBottom:`1px solid ${border}`
                      }}
                    >
                      {title}
                    </th>
                  )}
                </tr>
              </thead>

              <tbody>
                {visible.map((row,index)=>(
                  <tr key={`${row.at}-${row.node}-${index}`}>
                    <td style={{
                      padding:12,
                      borderBottom:`1px solid ${border}`,
                      whiteSpace:"nowrap"
                    }}>
                      {new Date(row.at).toLocaleString("tr-TR")}
                    </td>

                    {[
                      row.actor,
                      row.node,
                      row.department,
                      row.action
                    ].map((value,i)=>
                      <td key={i} style={{
                        padding:12,
                        borderBottom:`1px solid ${border}`,
                        overflowWrap:"anywhere"
                      }}>
                        {value}
                      </td>
                    )}

                    <td style={{
                      padding:12,
                      borderBottom:`1px solid ${border}`,
                      fontWeight:700,
                      color:row.outcome==="success"
                        ?green
                        :"#a54a51"
                    }}>
                      {row.outcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!busy&&visible.length===0&&
            <p style={{
              color:muted,
              fontSize:13,
              textAlign:"center",
              padding:15
            }}>
              Seçilen filtrelerde log kaydı bulunamadı.
            </p>
          }

          <p style={{
            color:muted,
            fontSize:11,
            lineHeight:1.7,
            marginTop:14
          }}>
            Loglar Keycloak kullanıcısı, Redis instance,
            departman, işlem ve sonucu içerir.
            ACL şifreleri ve key değerleri gösterilmez.
            Panel açıkken her 30 saniyede yenilenir.
          </p>
        </div>
      }
    </details>
  );
}
