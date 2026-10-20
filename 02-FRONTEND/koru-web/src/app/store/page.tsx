"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Product = {
  id: number;
  name: string;
  price: number;
  discountPercent: number;
  available: number;
  salePrice: number;
  status: string;
};

type Kind = "purchase" | "offer";

type Selection = {
  product: Product;
  kind: Kind;
  requestKey: string;
};

type Receipt = {
  id: number;
  kind: Kind;
  status: string;
  message: string;
};

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY"
  }).format(Number(value));

export default function StorePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [offer, setOffer] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/v6/store/products", {
        cache: "no-store"
      });

      if (!response.ok)
        throw new Error(`Katalog HTTP ${response.status}`);

      const result: Product[] = await response.json();

      setProducts(result);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Katalog yüklenemedi."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => void load(), 15000);

    return () => window.clearInterval(timer);
  }, [load]);

  function open(product: Product, kind: Kind) {
    setSelection({
      product,
      kind,
      requestKey: crypto.randomUUID()
    });
    setReceipt(null);
    setQuantity(1);
    setOffer("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selection || submitting) return;

    if (!Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > selection.product.available ||
        quantity > 100) {
      setError("Geçerli ve stokta bulunan bir miktar seç.");
      return;
    }

    if (selection.kind === "offer" &&
        (!Number.isFinite(Number(offer)) || Number(offer) <= 0)) {
      setError("Teklif tutarını kontrol et.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/v6/store/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: selection.requestKey,
          productId: selection.product.id,
          kind: selection.kind,
          quantity,
          buyerName: name.trim(),
          buyerEmail: email.trim(),
          proposedUnitPrice:
            selection.kind === "offer" ? Number(offer) : null
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || `Talep HTTP ${response.status}`
        );
      }

      setReceipt({
        id: result.id,
        kind: result.kind,
        status: result.status,
        message: result.message
      });

      setSelection(null);
      await load();
    } catch (e) {
      // Aynı requestKey korunur; tekrar denemek
      // ikinci stok rezervasyonu oluşturmaz.
      setError(
        e instanceof Error ? e.message : "Talep gönderilemedi."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="koru-store">
      <div className="koru-store-intro">
        <p className="muted">KORU ONE / KURUMSAL ÜRÜN VİTRİNİ</p>
        <h1>Ürünler ve Kurumsal Teklifler</h1>
        <p>
          Ürünleri inceleyebilir, satın alma talebi oluşturabilir
          veya kendi fiyat teklifinizi iletebilirsiniz.
        </p>
        <div className="koru-store-actions">
          <button className="secondary" onClick={load}>
            {loading ? "Güncelleniyor..." : "Ürünleri Yenile"}
          </button>
          <a href="/" className="koru-store-home">Ana Sayfa</a>
        </div>
      </div>

      {error && (
        <p role="alert" className="error">{error}</p>
      )}

      {receipt && (
        <section className="card koru-store-success" role="status">
          <h2>Talebiniz alındı</h2>
          <p><b>Talep numarası:</b> #{receipt.id}</p>
          <p>
            {receipt.kind === "purchase"
              ? "Ürün rezerve edildi. Yönetici onayı bekleniyor."
              : "Fiyat teklifiniz değerlendirmeye alındı."}
          </p>
          <p className="muted">
            Henüz ödeme alınmadı ve satış kesinleşmedi.
          </p>
        </section>
      )}

      <div className="koru-store-grid">
        {products.map(product => (
          <article className="card koru-product" key={product.id}>
            <div className="koru-product-top">
              <span className="koru-product-badge">Satışta</span>
              <span className="muted">#{product.id}</span>
            </div>

            <div className="koru-product-symbol">
              <span aria-hidden="true">▧</span>
            </div>

            <h2>{product.name}</h2>

            <p className="muted">
              Stokta: {product.available} adet
            </p>

            {product.discountPercent > 0 && (
              <p className="koru-old-price">
                {money(product.price)}
              </p>
            )}

            <div className="koru-product-price">
              {money(product.salePrice)}
            </div>

            {product.discountPercent > 0 && (
              <p className="koru-product-discount">
                %{product.discountPercent} indirim
              </p>
            )}

            <div className="koru-product-buttons">
              <button onClick={() => open(product, "purchase")}>
                Satın Al
              </button>
              <button
                className="secondary"
                onClick={() => open(product, "offer")}
              >
                Teklif Ver
              </button>
            </div>
          </article>
        ))}
      </div>

      {!loading && products.length === 0 && (
        <section className="card">
          <h2>Şu anda satışta ürün bulunmuyor</h2>
          <p className="muted">
            Stoğu biten veya yayından kaldırılan ürünler
            bu vitrinde gösterilmez.
          </p>
        </section>
      )}

      {selection && (
        <div
          className="koru-store-overlay"
          onClick={() => !submitting && setSelection(null)}
        >
          <section
            className="koru-store-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              selection.kind === "purchase"
                ? "Satın alma talebi"
                : "Fiyat teklifi"
            }
            onClick={e => e.stopPropagation()}
          >
            <div className="koru-store-modal-head">
              <h2>
                {selection.kind === "purchase"
                  ? "Satın Alma Talebi"
                  : "Teklif Oluştur"}
              </h2>
              <button
                className="secondary"
                type="button"
                disabled={submitting}
                onClick={() => setSelection(null)}
              >
                ×
              </button>
            </div>

            <p><b>{selection.product.name}</b></p>
            <p>Liste fiyatı: {money(selection.product.salePrice)}</p>

            <form onSubmit={submit} className="koru-store-form">
              <label>
                Adınız Soyadınız
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ad Soyad"
                />
              </label>

              <label>
                E-posta Adresiniz
                <input
                  required
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ornek@firma.com"
                />
              </label>

              <label>
                Adet
                <input
                  required
                  type="number"
                  min={1}
                  max={Math.min(100, selection.product.available)}
                  value={quantity}
                  onChange={e => setQuantity(Number(e.target.value))}
                />
              </label>

              {selection.kind === "offer" && (
                <label>
                  Teklif Ettiğiniz Birim Fiyat (TL)
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={offer}
                    onChange={e => setOffer(e.target.value)}
                    placeholder="Ör. 24500"
                  />
                </label>
              )}

              <p className="muted">
                Bu form ödeme işlemi gerçekleştirmez.
                Bilgileriniz talebin değerlendirilmesi
                amacıyla kaydedilir.
              </p>

              <button type="submit" disabled={submitting}>
                {submitting ? "Gönderiliyor..." : "Talebi Gönder"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
