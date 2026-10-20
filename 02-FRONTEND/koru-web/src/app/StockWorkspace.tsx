"use client";

import { useCallback, useEffect, useState } from "react";

type Product = {
  id: number;
  name: string;
  price: number;
  stock: number;
  soldCount: number;
};

type Sale = {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  actor: string;
  soldAt: string;
};

export default function StockWorkspace({ token }: { token: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (
    path: string,
    options: RequestInit = {}
  ) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return response;
  }, [token]);

  const reload = useCallback(async () => {
    if (!token) return;

    try {
      const [p, s] = await Promise.all([
        request("/api/v4/products"),
        request("/api/v4/products/sales")
      ]);

      setProducts(await p.json());
      setSales(await s.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Veriler alınamadı.");
    }
  }, [token, request]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function processProduct(id: number, action: "stock" | "sell") {
    const quantity = Number(quantities[id]);

    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Geçerli bir adet gir.");
      return;
    }

    if (action === "sell" &&
        !window.confirm(`${quantity} adet ürün satıldı olarak işaretlensin mi?`)) {
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await request(`/api/v4/products/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ quantity })
      });

      setQuantities(previous => ({ ...previous, [id]: "" }));

      await reload();

      setMessage(
        action === "sell"
          ? "Satış kaydedildi. Stok güncellendi."
          : "Stok başarıyla artırıldı."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Stok ve Satış Yönetimi</h2>
      <p className="muted">
        Ürünleri stokla, satış kaydı oluştur ve geçmişi incele.
      </p>

      {error && <p role="alert" className="error">{error}</p>}
      {message && <p role="status" style={{ color: "#20764e" }}>{message}</p>}

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Stok</th>
              <th>Satılan</th>
              <th>Durum</th>
              <th>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.stock}</td>
                <td>{p.soldCount}</td>
                <td>
                  <b style={{ color: p.stock > 0 ? "#227451" : "#b34838" }}>
                    {p.stock > 0 ? "Satışta" : "Tükendi"}
                  </b>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Adet"
                      style={{ width: 85 }}
                      value={quantities[p.id] ?? ""}
                      onChange={e => setQuantities(x => ({
                        ...x,
                        [p.id]: e.target.value
                      }))}
                    />

                    <button
                      disabled={busy}
                      onClick={() => processProduct(p.id, "stock")}
                    >
                      Stok Ekle
                    </button>

                    <button
                      className="secondary"
                      disabled={busy || p.stock === 0}
                      onClick={() => processProduct(p.id, "sell")}
                    >
                      Satıldı
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 30 }}>Satış Geçmişi</h3>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Satış No</th>
              <th>Ürün ID</th>
              <th>Adet</th>
              <th>Birim Fiyat</th>
              <th>İşlemi Yapan</th>
              <th>Tarih</th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => (
              <tr key={s.id}>
                <td>#{s.id}</td>
                <td>{s.productId}</td>
                <td>{s.quantity}</td>
                <td>
                  {Number(s.unitPrice).toLocaleString("tr-TR")} ₺
                </td>
                <td>{s.actor}</td>
                <td>
                  {new Date(s.soldAt).toLocaleString("tr-TR")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        style={{ marginTop: 16 }}
        className="secondary"
        onClick={reload}
      >
        Verileri Yenile
      </button>
    </section>
  );
}
