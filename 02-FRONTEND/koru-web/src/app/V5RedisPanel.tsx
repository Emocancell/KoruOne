"use client";

import { useCallback, useEffect, useState } from "react";

type Metrics = {
  connected: boolean;
  version: string;
  role: string;
  memoryBytes: number;
  memoryRssBytes: number;
  maxMemoryBytes: number;
  clients: number;
  hits: number;
  misses: number;
  hitRatio: number;
  evictions: number;
  expired: number;
  operationsPerSecond: number;
  totalKeys: number;
  uptimeSeconds: number;
  rejectedConnections: number;
  checkedAt: string;
};

export default function V5RedisPanel({
  token
}: {
  token: string;
}) {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);

    try {
      const response = await fetch("/api/v5/redis/metrics", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      if (!response.ok)
        throw new Error(`Redis API HTTP ${response.status}`);

      const result = await response.json();

      setData(result);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Redis bağlantı hatası"
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();

    const timer = setInterval(() => void load(), 5000);

    return () => clearInterval(timer);
  }, [load]);

  const mb = (bytes: number) =>
    (bytes / 1048576).toFixed(2) + " MB";

  const number = (value: number) =>
    new Intl.NumberFormat("tr-TR").format(value);

  if (!data) {
    return (
      <section className="card">
        <h2>Redis Intelligence</h2>
        <p>{loading ? "Redis metrikleri yükleniyor..." : error}</p>
      </section>
    );
  }

  const metrics = [
    ["Cache HIT", number(data.hits)],
    ["Cache MISS", number(data.misses)],
    ["Hit Ratio", `%${data.hitRatio}`],
    ["Toplam Key", number(data.totalKeys)],
    ["Bellek", mb(data.memoryBytes)],
    ["RSS Bellek", mb(data.memoryRssBytes)],
    ["Aktif Bağlantı", number(data.clients)],
    ["İşlem / saniye", number(data.operationsPerSecond)],
    ["Evicted Keys", number(data.evictions)],
    ["Expired Keys", number(data.expired)],
    ["Reddedilen Bağlantı", number(data.rejectedConnections)],
    ["Uptime", `${Math.floor(data.uptimeSeconds / 3600)} saat`]
  ];

  return (
    <div className="v5-redis-dashboard">
      <section className="card">
        <div className="v5-redis-heading">
          <div>
            <p className="muted">
              REDIS INTELLIGENCE / LIVE TELEMETRY
            </p>
            <h2>Redis 8 — Sistem Performansı</h2>
            <p className="muted">
              Sürüm: {data.version} · Rol: {data.role}
            </p>
          </div>

          <button className="secondary" onClick={load}>
            {loading ? "Yenileniyor..." : "Yenile"}
          </button>
        </div>

        <p>
          Bağlantı:
          <strong style={{color: "#21764f"}}>
            {" "}{data.connected ? "Aktif" : "Kapalı"}
          </strong>
        </p>

        {error && <p role="alert" className="error">{error}</p>}
      </section>

      <div className="v5-redis-grid">
        {metrics.map(([label, value]) => (
          <div className="card v5-redis-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className="card">
        <h2>Redis HIT / MISS Analizi</h2>

        <div className="v5-redis-progress">
          <div
            style={{
              width: `${Math.min(100, Math.max(0, data.hitRatio))}%`
            }}
          />
        </div>

        <p>
          HIT: {number(data.hits)} · MISS: {number(data.misses)}
        </p>

        <p className="muted">
          HIT oranı Redis sunucusunun keyspace istatistiklerinden
          hesaplanır. Yalnızca uygulamanın cache isteklerini
          temsil etmez.
        </p>
      </section>

      <section className="card">
        <h2>Redis Bellek Analizi</h2>

        <p>Kullanılan Bellek: <b>{mb(data.memoryBytes)}</b></p>
        <p>RSS Bellek: <b>{mb(data.memoryRssBytes)}</b></p>

        {data.maxMemoryBytes > 0 ? (
          <>
            <div className="v5-redis-progress">
              <div
                style={{
                  width: `${Math.min(100,
                    100 * data.memoryBytes / data.maxMemoryBytes
                  )}%`
                }}
              />
            </div>

            <p>Maxmemory: {mb(data.maxMemoryBytes)}</p>
          </>
        ) : (
          <p className="muted">
            Redis maxmemory sınırı tanımlanmamış.
          </p>
        )}
      </section>

      <p className="muted">
        Son ölçüm: {new Date(data.checkedAt).toLocaleString("tr-TR")}
        {" · "}5 saniyede bir güncellenir.
      </p>
    </div>
  );
}
