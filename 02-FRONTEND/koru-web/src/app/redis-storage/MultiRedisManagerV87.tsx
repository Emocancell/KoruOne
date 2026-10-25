"use client";

import {useCallback,useEffect,useState} from "react";
import {UserManager} from "oidc-client-ts";

type Node = {
  id:string;port:number;memoryMb:number;departments:string[];
  connected:boolean;usedBytes:number;keyCount:number;hits:number;misses:number;
};
// V892_KEY_INSPECTOR
type KeyMeta = {
  exists:boolean;
  type:string;
  ttlSeconds:number|null;
  persistent:boolean;
};
type Audit = {at:string;actor:string;node:string;department:string;action:string;outcome:string};
type Snapshot = {nodes:Node[];canProvision:boolean;measuredAt:string};
type Unlocked = {node:string;session:string;department:string};
const names:Record<string,string>={hr:"Human Resources",marketing:"Marketing",it:"IT Operations",network:"Network",advertising:"Advertising",redis:"Redis Operations"};
const deptNames=Object.keys(names);
const bg="#ffffff",ink="#1b3545",sub="#6e8191",line="#dce7eb",green="#158069";
const panel:React.CSSProperties={background:bg,border:`1px solid ${line}`,borderRadius:15,padding:20};
const action:React.CSSProperties={background:green,border:0,color:"#fff",borderRadius:9,padding:"9px 14px",cursor:"pointer",fontWeight:600};
const soft:React.CSSProperties={...action,background:"#eff5f7",color:ink,border:`1px solid ${line}`};
const field:React.CSSProperties={border:`1px solid ${line}`,padding:"10px 12px",borderRadius:9,width:"100%",background:"#fff",color:ink};
const mem=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(2)} MB`;

export default function MultiRedisManagerV87(){
  const [token,setToken]=useState("");
  const [roles,setRoles]=useState<string[]>([]);
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [audit,setAudit]=useState<Audit[]>([]);
  const [selected,setSelected]=useState("");
  const [username,setUsername]=useState("hr");
  const [password,setPassword]=useState("");
  const [unlocked,setUnlocked]=useState<Unlocked|null>(null);
  const [keys,setKeys]=useState<string[]>([]);
  const [keyName,setKeyName]=useState("demo:sample");
  const [keyValue,setKeyValue]=useState("KORU ONE cache test");
  const [ttl,setTtl]=useState(0);
  const [keyRead,setKeyRead]=useState("");
  const [keyMeta,setKeyMeta]=useState<KeyMeta|null>(null);
  const [newId,setNewId]=useState("redis04");
  const [newPort,setNewPort]=useState(3004);
  const [newMemory,setNewMemory]=useState(256);
  const [assignDept,setAssignDept]=useState("hr");
  const [resizeMb,setResizeMb]=useState(256);
  const [rotateUser,setRotateUser]=useState("koru_admin");
  const [secret,setSecret]=useState<{title:string;username:string;password:string}|null>(null);
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  const chosen=snapshot?.nodes.find(n=>n.id===selected);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const authority=process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
        if(!authority)throw Error("OIDC authority missing");
        const manager=new UserManager({authority,client_id:"koru-web",redirect_uri:window.location.origin+"/callback",response_type:"code",scope:"openid profile email"});
        const user=await manager.getUser();
        if(active){if(!user?.access_token||user.expired)throw Error("Oturum gerekli");setToken(user.access_token);}
      }catch(e){if(active)setStatus(String(e));}
    })();
    return()=>{active=false;};
  },[]);


  useEffect(()=>{
    if(!token)return;

    let active=true;

    fetch("/api/me",{
      headers:{Authorization:`Bearer ${token}`},
      cache:"no-store"
    })
    .then(async r=>r.ok?await r.json():null)
    .then(v=>{
      if(active&&Array.isArray(v?.roles)){
        setRoles(
          v.roles.map((x:string)=>x.toLowerCase())
        );
      }
    })
    .catch(()=>{});

    return ()=>{active=false;};
  },[token]);

  const aclUser=
    roles.includes("admin")||
    roles.includes("redis-operator")||
    roles.includes("redis")||
    roles.includes("redis-viewer")||
    roles.includes("redis-observer")
      ? "koru_admin"
      : roles.includes("network")
        ? "network"
        : roles.includes("it")
          ? "it"
          : "";

  useEffect(()=>{
    setUsername(aclUser);
  },[aclUser]);

  const viewOnly=
    !roles.some(r=>["admin","redis-operator","redis"].includes(r)) &&
    roles.some(r=>["redis-viewer","redis-observer"].includes(r));

  const call=useCallback(async (path:string,method="GET",body?:unknown,redisSession?:string)=>{
    const response=await fetch("/api/v8/redis/multi"+path,{method,headers:{Authorization:`Bearer ${token}`, ...(body!==undefined?{"Content-Type":"application/json"}:{}),...(redisSession?{"X-Koru-Redis-Session":redisSession}:{})},body:body!==undefined?JSON.stringify(body):undefined,cache:"no-store"});
    if(!response.ok){let detail="";try{const j=await response.json();detail=j.message||j.detail||"";}catch{}throw Error(`HTTP ${response.status}${detail?" · "+detail:""}`);}
    return response.json();
  },[token]);
  const refresh=useCallback(async()=>{
    if(!token)return;
    try{
      const response=await call(
      "/nodes","GET",undefined,unlocked?.session
    ) as Snapshot;
      setSnapshot(response);
      setSelected(x=>response.nodes.some(n=>n.id===x)?x:(response.nodes[0]?.id??""));
      if(response.canProvision){setAudit(await call("/audit") as Audit[]);}
      setLoaded(true);
    }catch(e){setStatus("Redis listesi okunamadı: "+String(e));}
  },[token,call,unlocked?.session]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    setUnlocked(null);
    setKeys([]);
    setKeyMeta(null);
    setKeyRead("");
    setSecret(null);
    setPassword("");
  },[selected]);

  useEffect(()=>{
    if(chosen?.memoryMb)
      setResizeMb(chosen.memoryMb);
  },[chosen?.memoryMb]);
  async function run(fn:()=>Promise<void>){
    setBusy(true);setStatus("");
    try{await fn();}catch(e){setStatus(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function admin(path:string,body:unknown,title:string){
    const data=await call(path,"POST",body) as Record<string,unknown>;
    if(typeof data.password==="string")setSecret({title,username:String(data.username??data.department??"koru_admin"),password:data.password});
    else setSecret(null);
    setStatus(title+" · başarılı");
    setUnlocked(null);await refresh();
  }
  async function keyList(){if(!unlocked)return;const result=await call(`/nodes/${unlocked.node}/keys`,"GET",undefined,unlocked.session) as {keys:string[]};setKeys(result.keys);}
  async function inspectKey(name:string) {
    if(!unlocked)return;

    const info=await call(
      `/nodes/${unlocked.node}/key/meta`,
      "POST",
      {name},
      unlocked.session
    ) as KeyMeta;

    setKeyMeta(info);
  }

  useEffect(()=>{
    if(!token||!unlocked?.session)return;

    let active=true;

    const timer=window.setInterval(()=>{
      if(document.visibilityState!=="visible")return;

      void call(
        `/nodes/${unlocked.node}/keys`,
        "GET",
        undefined,
        unlocked.session
      ).then(result=>{
        if(active){
          setKeys((result as {keys:string[]}).keys);
        }
      }).catch(()=>{
        // Gecici ag hatasinda onceki liste korunur.
      });
    },20000);

    return ()=>{
      active=false;
      window.clearInterval(timer);
    };
  },[token,unlocked?.node,unlocked?.session,call]);

  return (
    <section style={{...panel,marginTop:20,color:ink}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div><div style={{color:green,fontSize:12,fontWeight:800,letterSpacing:1}}>KORU ONE / CONTROL PLANE / V8.7</div>
          <h2 style={{fontSize:25,margin:"7px 0"}}>Multi-Redis Infrastructure</h2>
          <p style={{color:sub,fontSize:13,margin:0}}>Bağımsız instance'lar, departman ACL, gerçek metrikler ve denetlenen erişim.</p>
        </div>
        <div style={{
          display:"flex",
          gap:8,
          flexWrap:"wrap"
        }}>
          {snapshot?.canProvision&&
            <button
              style={action}
              onClick={()=>
                document.getElementById("koru-new-redis")
                  ?.scrollIntoView({behavior:"smooth"})
              }
            >
              + Yeni Redis
            </button>
          }

          <button
            style={soft}
            onClick={()=>void refresh()}
            disabled={busy||!token}
          >
            Yenile
          </button>
        </div>
      </div>
      {status&&<div role="status" style={{marginTop:14,padding:12,borderRadius:8,background:"#fff5e6",color:"#82561e",wordBreak:"break-word"}}>{status}</div>}
      {!loaded&&<p style={{color:sub}}>Redis node'ları okunuyor...</p>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(225px,1fr))",gap:12,marginTop:20}}>
        {(snapshot?.nodes??[]).map(n=>{
          const opened=unlocked?.node===n.id;

          return <button
            type="button"
            key={n.id}
            onClick={()=>setSelected(n.id)}
            style={{
              ...panel,
              textAlign:"left",
              cursor:"pointer",
              border:selected===n.id
                ? `2px solid ${green}`
                : `1px solid ${line}`
            }}
          >
            <div style={{
              display:"flex",
              justifyContent:"space-between",
              gap:8
            }}>
              <strong style={{fontSize:17}}>
                {n.id.replace("redis","Redis ")}
              </strong>

              <span style={{
                fontSize:12,
                color:opened?green:sub
              }}>
                {opened?"● Bağlandı":"🔒 Kilitli"}
              </span>
            </div>

            {opened
              ? <div style={{
                  color:sub,
                  fontSize:12,
                  marginTop:12
                }}>
                  {n.keyCount} keys · {mem(n.usedBytes)}
                  {" · "}{n.hits} HIT / {n.misses} MISS
                </div>
              : <div style={{
                  color:sub,
                  fontSize:12,
                  marginTop:12
                }}>
                  Detaylar için şifreyle giriş yap
                </div>}
          </button>;
        })}
      </div>
      {!snapshot?.nodes.length&&loaded&&<p style={{color:sub}}>Görünür node yok. Yönetici başlangıç kurulumunu uygulamalı.</p>}
      {chosen&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(275px,1fr))",gap:14,marginTop:18}}>
        <div style={panel}>
          <h3 style={{marginTop:0}}>{chosen.id.toUpperCase()} · Güvenli giriş</h3>
          <p style={{fontSize:12,color:sub}}>Key işlemlerinden önce atanmış Redis ACL kullanıcısı ve şifresi doğrulanır. Kimlik Keycloak üzerinden audit'e yazılır.</p>
          <label style={{fontSize:12}}>ACL kullanıcı</label>
          <input
            style={{...field,marginTop:6}}
            value={username}
            onChange={e=>{
              setUsername(e.target.value.trim().toLowerCase());
              setUnlocked(null);
              setKeys([]);
              setKeyRead("");
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="koru_admin, hr, marketing, network, it..."
            aria-label="ACL kullanici"
          />
          <label style={{fontSize:12,display:"block",marginTop:11}}>Redis şifresi</label>
          <input style={{...field,marginTop:6}} type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••••••" />
          <button disabled={busy||!password||!username} style={{...action,marginTop:12}} onClick={()=>void run(async()=>{
            const result=await call(`/nodes/${selected}/login`,"POST",{username,password}) as {session:string;department:string};
            setUnlocked({node:selected,session:result.session,department:result.department});setPassword("");setStatus(`${selected} / ${result.department} giriş başarılı; audit kaydı oluşturuldu.`);
          })}>Şifreyle Bağlan</button>
          {unlocked?.node===selected&&<div style={{marginTop:12,color:green,fontSize:13}}>✓ {unlocked.department} oturumu · 10 dakika · yalnızca bu sekmede</div>}
        </div>
        {unlocked?.node===selected&&<div style={panel}>
          <h3 style={{marginTop:0}}>Keyspace Explorer</h3>
          <p style={{fontSize:12,color:sub}}>Şifreyle bağlanınca erişebildiğin namespace altında gerçek Redis key ekle / oku / sil.</p>
          <div className="koru-v88-browser">
            <aside className="koru-v88-keylist">
              <div className="koru-v88-paneheading">Key Browser <span>{keys.length} key · 20 sn</span></div>
              <button disabled={!unlocked||busy} style={soft} onClick={()=>void run(keyList)}>Key'leri Yenile (max 60)</button>
              <div className="koru-v88-keyrows">
                {keys.length===0&&<p style={{color:sub,fontSize:12}}>Giriş sonrası key'leri listele. Key yoksa sağdan yeni kayıt ekle.</p>}
                {keys.map(k=><button key={k} type="button" className="koru-v88-keyrow" onClick={()=>{
                  if(!unlocked)return;
                  const relative=unlocked.department==="koru_admin"?k:k.slice(`koru:${unlocked.department}:`.length);
                  setKeyName(relative);
                  setKeyRead("");
                  void run(async()=>{
                    const r=await call(`/nodes/${selected}/key/read`,"POST",{name:relative},unlocked.session) as {value:string|null};
                    setKeyRead(r.value??"Key bulunamadı");
                  });
                }}><span className="koru-v88-keytype">KEY</span><span>{k}</span></button>)}
              </div>
            </aside>
            <div className="koru-v88-keydetail">
              <div className="koru-v88-paneheading">Key Editor <span>String · ACL kontrollü</span></div>
          <label style={{fontSize:12,display:"block",marginTop:10}}>Key adı {unlocked?.department!=="koru_admin"&&"(departman prefix'i otomatik eklenir)"}</label>
          <input style={{...field,marginTop:5}} value={keyName}
            onChange={e=>{
              setKeyName(e.target.value);
              setKeyMeta(null);
            }} />
          <label style={{fontSize:12,display:"block",marginTop:9}}>String değeri</label>
          <textarea style={{...field,marginTop:5,minHeight:65}} value={keyValue} readOnly={viewOnly} onChange={e=>setKeyValue(e.target.value)} />
          <label style={{fontSize:12,display:"block",marginTop:9}}>
            TTL (saniye · 0 = süresiz / kalıcı)
          </label>
          <input type="number" style={{...field,marginTop:5}}
            value={ttl} min={0} max={86400}
            disabled={viewOnly}
            onChange={e=>setTtl(Number(e.target.value))}/>
          <div style={{color:sub,fontSize:12,marginTop:5}}>
            0 seçildiğinde Redis key'e son kullanma tarihi koymaz.
          </div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:12}}>
            <button style={action} disabled={!unlocked||busy||viewOnly} onClick={()=>void run(async()=>{await call(`/nodes/${selected}/key/set`,"POST",{name:keyName,value:keyValue,ttlSeconds:ttl},unlocked!.session);setStatus("Key yazıldı · audit kaydedildi");await keyList();await refresh();})}>Key Ekle / Güncelle</button>
            <button style={soft} disabled={!unlocked||busy} onClick={()=>void run(async()=>{const r=await call(`/nodes/${selected}/key/read`,"POST",{name:keyName},unlocked!.session) as {value:string|null};setKeyRead(r.value??"Key bulunamadı");})}>Oku</button>
            <button style={{...action,background:"#a94450"}} disabled={!unlocked||busy||viewOnly} onClick={()=>{if(window.confirm("Bu key silinsin mi?"))void run(async()=>{await call(`/nodes/${selected}/key/delete`,"POST",{name:keyName},unlocked!.session);setStatus("Key silme işlemi tamamlandı");await keyList();await refresh();});}}>Sil</button>
          </div>
          {!viewOnly&&
            <button
              type="button"
              style={{...soft,marginTop:10}}
              disabled={!unlocked||busy}
              onClick={()=>void run(async()=>{
                const r=await call(
                  `/nodes/${selected}/key/persist`,
                  "POST",
                  {name:keyName},
                  unlocked!.session
                ) as {persistent:boolean;changed:boolean};

                setStatus(r.changed
                  ? "Key kalıcı hale getirildi; TTL kaldırıldı."
                  : "Bu key zaten kalıcıydı.");
              })}
            >
              Seçili Key'i Kalıcı Yap
            </button>}
          <div style={{marginTop:12}}>
            <button
              type="button"
              style={soft}
              disabled={!unlocked||busy||!keyName}
              onClick={()=>void run(()=>inspectKey(keyName))}
            >
              Key Türü / TTL Kontrol Et
            </button>
          </div>

          {keyMeta&&
            <div role="status" style={{
              marginTop:10,
              padding:12,
              background:"#f2f8f5",
              border:"1px solid #d6e9df",
              borderRadius:10,
              fontSize:13,
              color:ink
            }}>
              {!keyMeta.exists
                ? "Key bulunamadı veya süresi doldu"
                : <>
                    <strong>{keyMeta.type}</strong>
                    {" · "}
                    {keyMeta.persistent
                      ? "Kalıcı · TTL yok"
                      : `Kalan TTL: ${keyMeta.ttlSeconds ?? 0} saniye`}
                  </>
              }
            </div>}

          {keyRead&&<pre className="koru-v88-value">{(()=>{try{return JSON.stringify(JSON.parse(keyRead),null,2);}catch{return keyRead;}})()}</pre>}
            </div>
          </div>
        </div>}
      </div>}
      {snapshot?.canProvision&&<>
        <h3 id="koru-new-redis" style={{marginTop:26}}>Infrastructure Administration · Admin</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(270px,1fr))",gap:14}}>
          <div style={panel}>
            <h4 style={{marginTop:0}}>Yeni Redis Instance</h4>
            <label style={{fontSize:12}}>Node ID</label><input style={{...field,marginTop:4}} value={newId} onChange={e=>setNewId(e.target.value)} />
            <label style={{fontSize:12,display:"block",marginTop:8}}>Port (3001–3099)</label><input style={{...field,marginTop:4}} type="number" value={newPort} onChange={e=>setNewPort(Number(e.target.value))}/>
            <label style={{fontSize:12,display:"block",marginTop:8}}>Max Memory MB</label><input style={{...field,marginTop:4}} type="number" min={32} max={16384} value={newMemory} onChange={e=>setNewMemory(Number(e.target.value))}/>
            <button style={{...action,marginTop:12}} disabled={busy} onClick={()=>void run(()=>admin("/nodes",{id:newId,port:newPort,memoryMb:newMemory},"Yeni Redis oluşturuldu"))}>+ Redis Oluştur</button>
          </div>
          {chosen&&<div style={panel}>
            <h4 style={{marginTop:0}}>{chosen.id.toUpperCase()} · Yönet</h4>
            <div style={{fontSize:12,color:sub}}>Departman ataması</div>
            <select style={{...field,marginTop:6}} value={assignDept} onChange={e=>setAssignDept(e.target.value)}>{deptNames.map(x=><option key={x} value={x}>{names[x]}</option>)}</select>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:9}}>
              <button style={action} disabled={busy} onClick={()=>void run(()=>admin(`/nodes/${selected}/assign`,{department:assignDept},"Departman atandı"))}>Ata + şifre üret</button>
              <button style={soft} disabled={busy||!chosen.departments.includes(assignDept)} onClick={()=>{if(window.confirm("Departman bu Redis'ten çıkarılsın mı?"))void run(()=>admin(`/nodes/${selected}/unassign`,{department:assignDept},"Atama kaldırıldı"));}}>Atamayı Kaldır</button>
            </div>
            <div style={{fontSize:12,color:sub,marginTop:15}}>ACL şifresi yenile</div>
            <select style={{...field,marginTop:6}} value={rotateUser} onChange={e=>setRotateUser(e.target.value)}>{["koru_admin",...chosen.departments].map(x=><option key={x} value={x}>{x}</option>)}</select>
            <button style={{...action,marginTop:9}} disabled={busy} onClick={()=>{if(window.confirm("Şifre değişince önceki oturumlar geçersiz olur. Devam?"))void run(()=>admin(`/nodes/${selected}/rotate`,{username:rotateUser},"ACL şifresi yenilendi"));}}>Şifreyi Yenile</button>
          </div>}
          {chosen&&<div style={panel}>
            <h4 style={{marginTop:0}}>Capacity & Lifecycle</h4>
            <label style={{fontSize:12}}>Max Memory · MB</label>
            <input type="number" style={{...field,marginTop:6}} value={resizeMb} min={32} max={16384} onChange={e=>setResizeMb(Number(e.target.value))}/>
            <button style={{...action,marginTop:9}} disabled={busy} onClick={()=>{if(window.confirm("Redis kısa süre durup tekrar başlayacak. Kalıcı AOF korunur. Onaylıyor musun?"))void run(()=>admin(`/nodes/${selected}/resize`,{memoryMb:resizeMb},"Max memory değiştirildi"));}}>Kapasiteyi Güncelle</button>
            <div style={{fontSize:12,color:sub,marginTop:17}}>Güvenli kaldırma: önce tüm departman atamalarını kaldır.</div>
            <button style={{...action,background:"#a63c4b",marginTop:9}} disabled={busy||chosen.departments.length>0} onClick={()=>{
              const confirmation=window.prompt(`Silmek için tam olarak DELETE ${selected} yaz. AOF verisi silinmez.`);
              if(confirmation===`DELETE ${selected}`)void run(()=>admin(`/nodes/${selected}/delete`,{confirmation},"Redis kaldırıldı"));
            }}>Redis'i Sistemden Kaldır</button>
          </div>}
        </div>
        {secret&&<div style={{...panel,marginTop:16,border:"1px solid #e5b765",background:"#fff9e9"}}>
          <strong>🔐 {secret.title} · Yeni şifre yalnızca şimdi gösteriliyor</strong>
          <div style={{fontSize:13,marginTop:8}}>Kullanıcı: <code>{secret.username}</code></div>
          <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><code style={{wordBreak:"break-all"}}>{secret.password}</code><button style={soft} onClick={()=>void navigator.clipboard.writeText(secret.password)}>Kopyala</button><button style={soft} onClick={()=>setSecret(null)}>Gizle</button></div>
          <p style={{fontSize:12,color:sub}}>Güvenli parola yöneticisine kaydet; bu şifreyi README veya Git deposuna ekleme.</p>
        </div>}
        <div style={{...panel,marginTop:16}}>
          <h3 style={{marginTop:0}}>Audit Trail · Kim Ne Yaptı?</h3>
          <p style={{fontSize:12,color:sub}}>Keycloak kullanıcısı, Redis, departman ve sonuç kaydedilir. Şifreler ve key değerleri loglanmaz.</p>
          <div style={{maxHeight:270,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr>{["Zaman","Kullanıcı","Redis","Departman","İşlem","Sonuç"].map(x=><th key={x} style={{textAlign:"left",padding:"10px 5px",borderBottom:`1px solid ${line}`}}>{x}</th>)}</tr></thead><tbody>{audit.map((x,i)=><tr key={i}>{[new Date(x.at).toLocaleString("tr-TR"),x.actor,x.node,x.department,x.action,x.outcome].map((v,j)=><td key={j} style={{padding:"9px 5px",borderBottom:`1px solid ${line}`}}>{v}</td>)}</tr>)}</tbody></table>
          </div>
        </div>
      </>}
      <p style={{fontSize:12,color:sub,marginTop:16,lineHeight:1.7}}>Redis Insight: Codespaces <b>PORTS → 5540</b>. Host olarak <code>koru-v87-redis01</code> / <code>redis02</code> / <code>redis03</code> container adını ve iç port <code>6379</code> kullan. Her ACL kullanıcısı farklı şifreyle bağlanır. Redis Insight üzerinden yapılan eylemler bu uygulamanın Keycloak audit'ine otomatik yansımaz.</p>
    </section>
  );
}
