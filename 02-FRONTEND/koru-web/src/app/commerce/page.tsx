"use client";

import { useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";
import V6CommerceQueue from "../V6CommerceQueue";

export default function CommercePage(){
  const [token,setToken]=useState("");
  const [status,setStatus]=useState("Oturum kontrol ediliyor...");

  useEffect(()=>{
    let active=true;

    async function boot(){
      try{
        const authority=process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
        if(!authority)throw Error("OIDC adresi eksik.");

        const manager=new UserManager({
          authority,
          client_id:"koru-web",
          redirect_uri:window.location.origin+"/callback",
          response_type:"code",
          scope:"openid profile email"
        });

        const session=await manager.getUser();

        if(!session||session.expired)
          throw Error("Önce giriş yapmalısınız.");

        const r=await fetch("/api/me",{
          headers:{Authorization:`Bearer ${session.access_token}`},
          cache:"no-store"
        });

        if(!r.ok)throw Error("Oturum doğrulanamadı.");

        const me=await r.json();
        const roles:string[]=Array.isArray(me.roles)?me.roles:[];

        if(!roles.some(x=>["admin","marketing"].includes(x)))
          throw Error("Bu sayfaya erişim yetkiniz yok.");

        if(active){
          setToken(session.access_token);
          setStatus("");
        }
      }catch(e){
        if(active)setStatus(
          e instanceof Error?e.message:"Giriş hatası"
        );
      }
    }

    void boot();
    return ()=>{active=false;};
  },[]);

  return <main style={{
    maxWidth:1300,
    margin:"32px auto",
    padding:"0 22px"
  }}>
    <p className="muted">KORU ONE / ENTERPRISE COMMERCE</p>
    <h1>Sipariş ve Teklif Merkezi</h1>

    {status&&<section className="card">
      <p>{status}</p>
      <Link href="/">Ana Sayfa</Link>
    </section>}

    {token&&<V6CommerceQueue token={token}/>}
  </main>;
}
