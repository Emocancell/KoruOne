"use client";

import { useCallback, useEffect, useState } from "react";

type Order = {
  id:number;
  productId:number;
  kind:string;
  quantity:number;
  buyerName:string;
  buyerEmail:string;
  priceAtRequest:number;
  proposedUnitPrice:number|null;
  status:string;
  createdAt:string;
};

type Product = {
  id:number;
  name:string;
  stock:number;
  soldCount:number;
  reservedCount:number;
  isPublished:boolean;
  available:number;
};

type Sale = {
  id:number;
  productId:number;
  quantity:number;
  unitPrice:number;
  soldAt:string;
};

type Summary = {
  pending:number;
  confirmed:number;
  offers:number;
  soldUnits:number;
  totalRevenue:number;
  listedProducts:number;
};

export default function V6CommerceQueue({token}:{token:string}) {
  const [orders,setOrders] = useState<Order[]>([]);
  const [products,setProducts] = useState<Product[]>([]);
  const [sales,setSales] = useState<Sale[]>([]);
  const [summary,setSummary] = useState<Summary|null>(null);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);

  const request = useCallback(async (
    path:string,init:RequestInit={}
  )=>{
    const response=await fetch(path,{
      ...init,
      headers:{
        Authorization:`Bearer ${token}`,
        ...(init.body?{"Content-Type":"application/json"}:{}),
        ...init.headers
      },
      cache:"no-store"
    });

    if(!response.ok){
      const detail=await response.text();
      throw Error(`HTTP ${response.status}: ${detail.slice(0,150)}`);
    }

    return response;
  },[token]);

  const refresh = useCallback(async()=>{
    if(!token)return;

    try{
      const results=await Promise.all([
        request("/api/v6/commerce/requests"),
        request("/api/v6/commerce/products"),
        request("/api/v6/commerce/sales"),
        request("/api/v6/commerce/summary")
      ]);

      const [o,p,s,k]=await Promise.all(results.map(x=>x.json()));

      setOrders(o);
      setProducts(p);
      setSales(s);
      setSummary(k);
      setError("");
    }catch(e){
      setError(e instanceof Error?e.message:"Veriler alınamadı");
    }
  },[token,request]);

  useEffect(()=>{
    void refresh();
    const timer=setInterval(()=>void refresh(),12000);
    return ()=>clearInterval(timer);
  },[refresh]);

  const money=(n:number)=>new Intl.NumberFormat("tr-TR",{
    style:"currency",currency:"TRY"
  }).format(n);

  async function decide(id:number,action:"confirm"|"reject"){
    const verb=action==="confirm"?"onaylansın":"reddedilsin";

    if(!window.confirm(`#${id} numaralı talep ${verb} mı?`))
      return;

    setBusy(true);
    setMessage("");

    try{
      const response=await request(
        `/api/v6/commerce/requests/${id}/decision`,{
          method:"POST",
          body:JSON.stringify({action})
        }
      );

      const result=await response.json();

      setMessage(
        `#${id} tamamlandı. Yeni durum: ${result.status}`
      );
      await refresh();
    }catch(e){
      setError(e instanceof Error?e.message:"Karar kaydedilemedi");
    }finally{
      setBusy(false);
    }
  }

  async function publication(id:number,published:boolean){
    setBusy(true);

    try{
      await request(`/api/v6/commerce/products/${id}/publication`,{
        method:"PUT",
        body:JSON.stringify({published})
      });

      setMessage(
        published?"Ürün yeniden yayına alındı.":"Ürün yayından kaldırıldı."
      );
      await refresh();
    }catch(e){
      setError(e instanceof Error?e.message:"Yayın durumu değişmedi");
    }finally{
      setBusy(false);
    }
  }

  async function csv(){
    try{
      const r=await request("/api/v6/commerce/requests.csv");
      const url=URL.createObjectURL(await r.blob());
      const a=document.createElement("a");
      a.href=url;
      a.download="koru-siparis-teklif.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){
      setError(e instanceof Error?e.message:"CSV indirilemedi");
    }
  }

  const pending=orders.filter(o=>o.status==="pending");

  function productName(id:number){
    return products.find(p=>p.id===id)?.name??`Ürün #${id}`;
  }

  return <div className="v6-commerce">
    <section className="card">
      <div className="v6-commerce-head">
        <div>
          <p className="muted">KORU ONE / COMMERCE OPERATIONS</p>
          <h2>Sipariş ve Teklif Yönetimi</h2>
          <p className="muted">
            PostgreSQL satış kayıtları · Redis ürün cache
          </p>
        </div>
        <div className="v6-commerce-actions">
          <button className="secondary" onClick={refresh}>Yenile</button>
          <button onClick={csv}>CSV Dışa Aktar</button>
        </div>
      </div>

      {error&&<p className="error" role="alert">{error}</p>}
      {message&&<p role="status" style={{color:"#19734d"}}>{message}</p>}

      {summary&&<div className="v6-commerce-kpis">
        {[
          ["Bekleyen Talep",summary.pending],
          ["Bekleyen Teklif",summary.offers],
          ["Onaylanan Sipariş",summary.confirmed],
          ["Satılan Adet",summary.soldUnits],
          ["Yayındaki Ürün",summary.listedProducts]
        ].map(([label,value])=><div key={String(label)}>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>)}
        <div>
          <small>Kaydedilen Satış Tutarı</small>
          <strong>{money(Number(summary.totalRevenue))}</strong>
        </div>
      </div>}
    </section>

    <section className="card">
      <h2>Bekleyen Siparişler ve Teklifler</h2>

      {pending.length===0&&
        <p className="muted">Bekleyen talep bulunmuyor.</p>}

      <div className="v6-commerce-scroll">
        <table>
          <thead><tr>
            <th>No</th><th>Ürün</th><th>Tür</th><th>Adet</th>
            <th>Müşteri</th><th>Fiyat</th><th>İşlem</th>
          </tr></thead>
          <tbody>
            {pending.map(o=><tr key={o.id}>
              <td>#{o.id}</td>
              <td>{productName(o.productId)}</td>
              <td>{o.kind==="purchase"?"Satın Al":"Teklif"}</td>
              <td>{o.quantity}</td>
              <td>
                <b>{o.buyerName}</b>
                <div className="muted">{o.buyerEmail}</div>
              </td>
              <td>
                {money(Number(o.priceAtRequest))}
                {o.kind==="offer"&&
                  <div>Teklif: {money(Number(o.proposedUnitPrice))}</div>}
              </td>
              <td>
                <div className="v6-commerce-actions">
                  <button disabled={busy}
                    onClick={()=>decide(o.id,"confirm")}>
                    {o.kind==="offer"?"Teklifi Kabul Et":"Satışı Onayla"}
                  </button>
                  <button className="secondary" disabled={busy}
                    onClick={()=>decide(o.id,"reject")}>
                    Reddet
                  </button>
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <p className="muted">
        Teklifi kabul etmek satış veya ödeme oluşturmaz.
        Satın alma onayı ise rezervasyonu satışa dönüştürür.
      </p>
    </section>

    <section className="card">
      <h2>Ürün ve İlan Kontrolü</h2>

      <div className="v6-commerce-scroll">
        <table>
          <thead><tr>
            <th>Ürün</th><th>Stok</th><th>Rezerve</th>
            <th>Satılan</th><th>Durum</th><th>Yayın</th>
          </tr></thead>
          <tbody>
            {products.map(p=>{
              const state=p.stock===0&&p.soldCount>0
                ?"Satıldı"
                :!p.isPublished
                  ?"Yayında Değil"
                  :p.available===0?"Stok Yok / Rezerve":"Satışta";

              return <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.stock}</td>
                <td>{p.reservedCount}</td>
                <td>{p.soldCount}</td>
                <td><strong>{state}</strong></td>
                <td>
                  <button disabled={busy}
                    className="secondary"
                    onClick={()=>publication(p.id,!p.isPublished)}>
                    {p.isPublished?"Yayından Kaldır":"Yayına Al"}
                  </button>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="card">
      <h2>Satış Geçmişi</h2>
      <div className="v6-commerce-scroll">
        <table>
          <thead><tr>
            <th>Satış No</th><th>Ürün</th><th>Adet</th>
            <th>Birim Fiyat</th><th>Tarih</th>
          </tr></thead>
          <tbody>
            {sales.map(s=><tr key={s.id}>
              <td>#{s.id}</td>
              <td>{productName(s.productId)}</td>
              <td>{s.quantity}</td>
              <td>{money(Number(s.unitPrice))}</td>
              <td>{new Date(s.soldAt).toLocaleString("tr-TR")}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
