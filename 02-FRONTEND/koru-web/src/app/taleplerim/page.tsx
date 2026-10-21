"use client";

import {useEffect,useState} from "react";
import {UserManager} from "oidc-client-ts";

type Ticket = {
 id:number;
 title:string;
 department:string;
 status:string;
};

export default function MyTickets() {
 const [token,setToken]=useState("");
 const [tickets,setTickets]=useState<Ticket[]>([]);
 const [title,setTitle]=useState("");
 const [department,setDepartment]=useState("General");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);

 useEffect(()=>{
  let active=true;
  const authority=process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
  if(!authority)return;

  const manager=new UserManager({
   authority,
   client_id:"koru-web",
   redirect_uri:window.location.origin+"/callback",
   response_type:"code",
   scope:"openid profile email"
  });

  manager.getUser().then(user=>{
   if(active&&user&&!user.expired)
    setToken(user.access_token);
  });

  return ()=>{active=false};
 },[]);

 async function load() {
  if(!token)return;
  try {
   const r=await fetch("/api/tickets/mine",{
    headers:{Authorization:"Bearer "+token},
    cache:"no-store"
   });
   if(!r.ok)throw Error("HTTP "+r.status);
   setTickets(await r.json());
   setError("");
  }catch(e){
   setError(e instanceof Error?e.message:"Liste hatasi");
  }
 }

 useEffect(()=>{
  if(!token)return;
  void load();
  const timer=setInterval(()=>void load(),10000);
  return ()=>clearInterval(timer);
 },[token]);

 async function createTicket() {
  if(!title.trim()||busy)return;
  setBusy(true);
  try {
   const r=await fetch("/api/tickets",{
    method:"POST",
    headers:{
     Authorization:"Bearer "+token,
     "Content-Type":"application/json"
    },
    body:JSON.stringify({
     title:title.trim(),
     department
    })
   });

   if(!r.ok)throw Error("HTTP "+r.status);
   setTitle("");
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:"Kayit hatasi");
  }finally{
   setBusy(false);
  }
 }

 return <main style={{maxWidth:1100,margin:"35px auto",padding:20}}>
  <p className="muted">KORU ONE / SELF SERVICE</p>
  <h1>Taleplerim</h1>
  <p className="muted">
   Kendi destek taleplerini oluştur ve durumlarını takip et.
  </p>

  {!token?<section className="card">
   Taleplerini görmek için giriş yapmalısın.
  </section>:<>
   <section className="card">
    <h2>Yeni Destek Talebi</h2>
    <div className="row">
     <input
      placeholder="Talep başlığı"
      maxLength={200}
      value={title}
      onChange={e=>setTitle(e.target.value)}
     />
     <select value={department}
      onChange={e=>setDepartment(e.target.value)}>
      <option value="General">Genel Destek</option>
      <option value="IT">IT</option>
      <option value="Network">Network</option>
     </select>
     <button disabled={busy||!title.trim()}
      onClick={()=>void createTicket()}>
      {busy?"Kaydediliyor...":"Ticket Aç"}
     </button>
    </div>
   </section>

   {error&&<p className="error" role="alert">{error}</p>}

   <section className="card">
    <div className="row">
     <h2>Benim Ticket'larım</h2>
     <button className="secondary"
      onClick={()=>void load()}>Yenile</button>
    </div>
    <div style={{overflowX:"auto"}}>
     <table>
      <thead><tr>
       <th>ID</th><th>Başlık</th>
       <th>Departman</th><th>Durum</th>
      </tr></thead>
      <tbody>
       {tickets.map(t=><tr key={t.id}>
        <td>#{t.id}</td>
        <td>{t.title}</td>
        <td>{t.department}</td>
        <td>{t.status}</td>
       </tr>)}
      </tbody>
     </table>
    </div>
    {!tickets.length&&<p className="muted">
     Henüz açtığın bir talep bulunmuyor.
    </p>}
   </section>
  </>}
 </main>;
}
