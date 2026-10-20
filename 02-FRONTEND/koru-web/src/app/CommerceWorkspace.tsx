"use client";
import StockWorkspace from "./StockWorkspace";

import { useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import "./style.css";

type Product = {
  id: number;
  name: string;
  price: number;
  discountPercent: number;
};

type Advertisement = {
  id: number;
  title: string;
  content: string;
  published: boolean;
};

export default function CommerceWorkspace({
  mode
}: {
  mode: "marketing" | "advertising"
}) {
  const [token, setToken] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [adTitle, setAdTitle] = useState("");
  const [adContent, setAdContent] = useState("");
  const [drafts, setDrafts] = useState<
    Record<number, { price?: string; discount?: string }>
  >({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isMarketing = mode === "marketing";
  const authorized = roles.includes("admin") ||
    roles.includes(mode);

  const money = (value: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY"
    }).format(value);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `HTTP ${response.status} — ${details.slice(0,150)}`
      );
    }

    return response;
  }

  async function reload() {
    if (!token) return;

    try {
      const userResponse = await request("/api/me");
      const user = await userResponse.json();
      const currentRoles: string[] = user.roles || [];
      setRoles(currentRoles);

      if (!currentRoles.includes("admin") &&
          !currentRoles.includes(mode)) {
        setError("Bu departmana erişim yetkin yok.");
        return;
      }

      const response = await request(
        isMarketing
          ? "/api/products"
          : "/api/advertisements/manage"
      );

      if (isMarketing)
        setProducts(await response.json());
      else
        setAds(await response.json());

      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bağlantı hatası.");
    }
  }

  useEffect(() => {
    const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;
    if (!authority) return;

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    manager.getUser().then(user => {
      if (user && !user.expired)
        setToken(user.access_token);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!token) return;
    void reload();

    const timer = setInterval(() => void reload(), 8000);
    return () => clearInterval(timer);
  }, [token]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
      await reload();
      setMessage("İşlem başarıyla kaydedildi.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  async function addProduct() {
    if (!name.trim() || price.trim() === "" ||
        !Number.isFinite(Number(price)) || Number(price) < 0) {
      setError("Ürün adı ve geçerli bir fiyat gir.");
      return;
    }

    await perform(async () => {
      await request("/api/products", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          price: Number(price)
        })
      });
      setName("");
      setPrice("");
    });
  }

  async function updatePrice(id: number) {
    const value = drafts[id]?.price;

    if (!value || !Number.isFinite(Number(value)) ||
        Number(value) < 0) {
      setError("Geçerli bir fiyat gir.");
      return;
    }

    await perform(async () => {
      await request(`/api/products/${id}/price`, {
        method: "PUT",
        body: JSON.stringify({ price: Number(value) })
      });
      setDrafts(d => ({
        ...d,
        [id]: { ...d[id], price: "" }
      }));
    });
  }

  async function updateDiscount(id: number) {
    const value = drafts[id]?.discount;

    if (value === undefined || value === "" ||
        !Number.isFinite(Number(value)) ||
        Number(value) < 0 || Number(value) > 90) {
      setError("İndirim %0 ile %90 arasında olmalı.");
      return;
    }

    await perform(async () => {
      await request(`/api/products/${id}/discount`, {
        method: "PUT",
        body: JSON.stringify({ percent: Number(value) })
      });
      setDrafts(d => ({
        ...d,
        [id]: { ...d[id], discount: "" }
      }));
    });
  }

  async function createAd() {
    if (!adTitle.trim() || !adContent.trim()) {
      setError("Reklam başlığı ve içeriği boş olamaz.");
      return;
    }

    await perform(async () => {
      await request("/api/advertisements", {
        method: "POST",
        body: JSON.stringify({
          title: adTitle.trim(),
          content: adContent.trim()
        })
      });
      setAdTitle("");
      setAdContent("");
    });
  }

  async function changePublication(id: number, publish: boolean) {
    await perform(async () => {
      await request(
        `/api/advertisements/${id}/${publish ? "publish" : "unpublish"}`,
        { method: "PUT" }
      );
    });
  }

  return (
    <main className="commerce-container">
      <div className="commerce-header">
        <div>
          <p className="muted">KORU ONE / DEPARTMAN MERKEZİ</p>
          <h1>{isMarketing ? "Pazarlama Merkezi" : "Reklam Yönetim Merkezi"}</h1>
          <p className="muted">
            {isMarketing
              ? "Ürün kataloğu, fiyatlandırma ve indirim yönetimi."
              : "Kurumsal reklam içerikleri ve yayın kontrolü."}
          </p>
        </div>
        <div className="row">
          <a className="action" href="/">Ana Sayfa</a>
          <button className="secondary" onClick={reload}>Yenile</button>
        </div>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" className="commerce-success">{message}</p>}

      {!token && <section className="card">
        Kurumsal hesabınla giriş yap.
      </section>}

      {token && !authorized && <section className="card">
        <h2>Yetkilendirme</h2>
        <p>Bu modül yalnızca ilgili departman ve Admin tarafından yönetilir.</p>
      </section>}

      {token && authorized && isMarketing && (
        <>
          <div className="cards">
            <div className="card">
              Ürün Sayısı
              <strong>{products.length}</strong>
            </div>
            <div className="card">
              İndirimli Ürünler
              <strong>{products.filter(p => Number(p.discountPercent) > 0).length}</strong>
            </div>
          </div>

          <section className="card">
            <h2>Yeni Ürün Ekle</h2>
            <div className="commerce-form">
              <input
                placeholder="Örn. Dizüstü Bilgisayar"
                maxLength={200}
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <input
                type="number"
                placeholder="Satış fiyatı (TL)"
                min="0"
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
              <button disabled={busy} onClick={addProduct}>
                + Ürün Kaydet
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Ürün ve Fiyat Yönetimi</h2>
            <div className="commerce-table">
              <table>
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>Liste Fiyatı</th>
                    <th>İndirim</th>
                    <th>Satış Fiyatı</th>
                    <th>Yeni Fiyat</th>
                    <th>İndirim Güncelle</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{money(Number(p.price))}</td>
                      <td>%{p.discountPercent ?? 0}</td>
                      <td><b>{money(
                        Number(p.price) *
                        (1 - Number(p.discountPercent ?? 0) / 100)
                      )}</b></td>
                      <td>
                        <div className="commerce-cell">
                          <input
                            type="number"
                            min="0"
                            placeholder="Yeni fiyat"
                            value={drafts[p.id]?.price ?? ""}
                            onChange={e => setDrafts(d => ({
                              ...d,
                              [p.id]: { ...d[p.id], price: e.target.value }
                            }))}
                          />
                          <button disabled={busy}
                                  onClick={() => updatePrice(p.id)}>
                            Kaydet
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="commerce-cell">
                          <input
                            type="number"
                            min="0"
                            max="90"
                            placeholder="%"
                            value={drafts[p.id]?.discount ?? ""}
                            onChange={e => setDrafts(d => ({
                              ...d,
                              [p.id]: { ...d[p.id], discount: e.target.value }
                            }))}
                          />
                          <button disabled={busy}
                                  onClick={() => updateDiscount(p.id)}>
                            Uygula
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {token && authorized && !isMarketing && (
        <>
          <div className="cards">
            <div className="card">
              Toplam Reklam
              <strong>{ads.length}</strong>
            </div>
            <div className="card">
              Yayındaki Reklam
              <strong>{ads.filter(a => a.published).length}</strong>
            </div>
          </div>

          <section className="card">
            <h2>Yeni Reklam / Banner İçeriği</h2>
            <div className="commerce-form">
              <input
                placeholder="Reklam başlığı"
                maxLength={200}
                value={adTitle}
                onChange={e => setAdTitle(e.target.value)}
              />
              <textarea
                placeholder="Ana sayfada gösterilecek reklam metni..."
                maxLength={2000}
                value={adContent}
                onChange={e => setAdContent(e.target.value)}
              />
              <button disabled={busy} onClick={createAd}>
                + Taslak Oluştur
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Reklam Envanteri</h2>
            {ads.map(a => (
              <div className="commerce-ad" key={a.id}>
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.content}</p>
                  <span className={a.published
                    ? "commerce-published"
                    : "commerce-draft"}>
                    {a.published ? "Yayında" : "Taslak / Yayından kaldırıldı"}
                  </span>
                </div>
                <button
                  disabled={busy}
                  className={a.published ? "secondary" : ""}
                  onClick={() => changePublication(a.id, !a.published)}
                >
                  {a.published ? "Yayından Kaldır" : "Yayınla"}
                </button>
              </div>
            ))}
            {!ads.length && <p>Henüz reklam bulunmuyor.</p>}
          </section>
        </>
      )}
      {token && authorized && isMarketing && <StockWorkspace token={token} />}
    </main>
  );
}
