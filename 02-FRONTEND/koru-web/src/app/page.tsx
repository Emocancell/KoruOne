"use client";
import TicketInbox from "./TicketInbox";

import {useEffect,useState} from 'react';
import {UserManager} from 'oidc-client-ts';
const authority=process.env.NEXT_PUBLIC_OIDC_AUTHORITY||'http://localhost:8081/realms/koru';
const manager=typeof window!=='undefined'?new UserManager({authority,client_id:'koru-web',redirect_uri:window.location.origin+'/callback',response_type:'code',scope:'openid profile email'}):null;
const api=process.env.NEXT_PUBLIC_API_URL??'';
export default function Home(){const [hrSupportOpen,setHrSupportOpen]=useState(false);const [token,setToken]=useState('');const [me,setMe]=useState<any>(null);const [dashboard,setDashboard]=useState<any>(null);const [tickets,setTickets]=useState<any[]>([]);const [products,setProducts]=useState<any[]>([]);const [ads,setAds]=useState<any[]>([]);const [title,setTitle]=useState('');const [error,setError]=useState('');
const [health,setHealth]=useState('');

async function handleSession() {
  if (!manager) return;

  try {
    if (token) {
      // Hem uygulama hem Keycloak oturumunu kapat
      await manager.signoutRedirect({
        post_logout_redirect_uri: window.location.origin + "/"
      });

      setToken("");
      setMe(null);
      setDashboard(null);
      setTickets([]);
      setProducts([]);
      setAds([]);
      setError("");
    } else {
      // Kullanıcı adı ve şifre ekranını zorunlu göster
      await manager.signinRedirect({
        prompt: "login"
      });
    }
  } catch (err) {
    console.error("Oturum işlemi başarısız:", err);
    setError("Oturum işlemi başarısız. Tekrar deneyin.");
  }
}

async function request(path:string,opts:RequestInit={}){const res=await fetch(api+path,{...opts,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...opts.headers}});if(!res.ok){
 const message=await res.text();
 throw Error('HTTP '+res.status+' - '+message.slice(0,350));
}
return res.json()}
async function refresh(){try{const [u,d,p,a]=await Promise.all([request('/api/me'),request('/api/dashboard'),request('/api/products'),request('/api/advertisements')]);setMe(u);setDashboard(d);setProducts(p);setAds(a);setError('')}catch(e:any){setError(e.message)}}
useEffect(()=>{manager?.getUser().then(u=>{if(u?.access_token && !u.expired)setToken(u.access_token)})},[]);
useEffect(()=>{if(token)refresh()},[token]);

async function checkHealth(){
 try{
  const res=await fetch('/health',{cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  const data=await res.json();
  setHealth('API AKTIF - '+(data.status||'OK'));
  setError('');
 }catch(e:any){
  setHealth('API BAGLANTI HATASI');
  setError(e.message);
 }
}

async function closeTicket(id:number){
 try{
  await request('/api/tickets/'+id+'/status',{
   method:'PATCH',
   body:JSON.stringify({status:'closed'})
  });
  await refresh();
 }catch(e:any){
  setError('Ticket kapatilamadi: '+e.message);
 }
}

const canCloseTicket=me?.roles?.some(
 (r:string)=>['admin','it','network'].includes(r)
)??false;

// koru-commerce-auto-refresh
useEffect(()=>{
  if(!token)return;
  const interval=setInterval(()=>void refresh(),10000);
  return ()=>clearInterval(interval);
},[token]);

async function createTicket(){
if(!title.trim()){
 setError('Ticket basligi giriniz.');
 return;
}
try{await request('/api/tickets',{method:'POST',body:JSON.stringify({title,department:'General'})});setTitle('');await refresh()}catch(e:any){setError(e.message)}}
return <><header><div className="brand">KORU <span>ONE</span></div><div>{me?.name||'Kurumsal Portal'} <button className="secondary" onClick={()=>void handleSession()}>{token?'Çıkış Yap':'Giriş Yap'}</button></div></header>
{token && <nav className="koru-department-nav">
  <a href="/operations">IT / Network</a>
  {me?.roles?.some((r:string)=>["marketing","admin"].includes(r)) &&
    <a href="/marketing">Pazarlama Merkezi</a>}
  {me?.roles?.some((r:string)=>["advertising","admin"].includes(r)) &&
    <a href="/advertising">Reklam Yönetimi</a>}
</nav>}
<main><p className="muted">ENTERPRISE OPERATIONS · REDIS INTELLIGENCE</p><h1>Redis Operations Overview</h1>
<div className="cards">
  <div className="card">
    <h2>Redis Intelligence</h2>
    <p className="muted">
      Cache, Streams, bellek, performans ve canlı telemetri.
    </p>
    <a className="action" href="/redis-intelligence">
      Redis Merkezi
    </a>
  </div>

  <div className="card">
    <h2>Departman Merkezleri</h2>
    <p className="muted">
      Yetkinize uygun departman işlemlerine üst menüden erişin.
    </p>
  </div>
</div><p className="muted">Departman operasyonları, Redis performansı ve güvenli yetkilendirme tek merkezde.</p>{!token?<div className="card">Dashboard ve departman işlemlerine erişmek için kurumsal hesabınızla giriş yapın.</div>:<><div className="row"><button onClick={refresh}>Yenile</button><button className="secondary" onClick={checkHealth}>
API Sağlık
</button>
{health&&<span role="status">{health}</span>}</div>{error&&<p className="error">{error}</p>}<p className="muted">Roller: {me?.roles?.join(', ')||'—'}</p><div className="card"><h2>Redis Cache Gözlemi</h2><p>Veri kaynağı: <b>{dashboard?.source||'—'}</b></p><p>İstek süresi: <b>{dashboard?.elapsedMs?.toFixed(2)??'—'} ms</b></p><p className="muted">İlk sorgu PostgreSQL; sonraki sorgular Redis HIT olarak ölçülür. Bu değerler gerçek API ölçümleridir.</p></div>{me?.roles?.includes('hr') && <div className='row'><button className='secondary' onClick={()=>setHrSupportOpen(!hrSupportOpen)}>{hrSupportOpen?'Destek Masasını Gizle':'Destek Masasını Aç'}</button></div>}<section className="card"><h2>Ürün Kataloğu</h2><table><tbody>{products.map(p=><tr key={p.id}><td>{p.name}</td><td>
  {Number(p.discountPercent||0)>0 ?
    <>
      <s>{Number(p.price).toLocaleString('tr-TR')} ₺</s>
      <b style={{display:'block',color:'#237756'}}>
        {(Number(p.price)*(1-Number(p.discountPercent)/100))
          .toLocaleString('tr-TR',{maximumFractionDigits:2})} ₺
      </b>
      <small>%{p.discountPercent} indirim</small>
    </>
    : <b>{Number(p.price).toLocaleString('tr-TR')} ₺</b>}
</td></tr>)}</tbody></table></section><section className="card"><h2>Yayındaki Reklamlar</h2>{ads.map(a=><p key={a.id}><b>{a.title}</b> — {a.content}</p>)}</section></>}</main></>}
