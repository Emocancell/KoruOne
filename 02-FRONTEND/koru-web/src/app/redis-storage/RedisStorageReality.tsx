"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GroupRow = {
  name: string;
  keyCount: number;
  bytes: number;
};

type NodeSummary = {
  label: string;
  usedMemoryBytes: number;
  overheadBytes: number;
  datasetBytes: number;
  totalKeys: number;
  scannedKeys: number;
  maxMemoryBytes: number;
  hitCount: number;
  missCount: number;
  fragmentationRatio: number;
  groups: GroupRow[];
};

type Payload = {
  checkedAt: string;
  cache: NodeSummary;
  streams: NodeSummary;
};

function fmtBytes(v: number) {
  if (!v || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString("tr-TR", {
    minimumFractionDigits: i === 0 ? 0 : 2,
    maximumFractionDigits: i === 0 ? 0 : 2,
  })} ${units[i]}`;
}

function fmtTime(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleTimeString("tr-TR");
}

function MetricBox({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        background: "#f6f8fa",
        border: "1px solid #d9e3ea",
        borderRadius: 12,
        padding: 14,
        minHeight: 86,
      }}
    >
      <div style={{ fontSize: 13, color: "#57708a", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#17324d" }}>
        {value}
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: NodeSummary }) {
  return (
    <div
      style={{
        border: "1px solid #d9e3ea",
        borderRadius: 14,
        padding: 18,
        background: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, color: "#17324d" }}>
          {node.label}
        </h3>
        <div style={{ fontSize: 13, color: "#57708a" }}>
          Toplam key: <b style={{ color: "#17324d" }}>{node.totalKeys}</b>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <MetricBox title="Gerçek toplam RAM" value={fmtBytes(node.usedMemoryBytes)} />
        <MetricBox title="Redis INFO overhead" value={fmtBytes(node.overheadBytes)} />
        <MetricBox title="Redis INFO dataset" value={fmtBytes(node.datasetBytes)} />
        <MetricBox title="Gerçek toplam key" value={node.totalKeys} />
      </div>

      <div style={{ fontSize: 13, color: "#57708a", marginBottom: 10 }}>
        SCAN: {node.scannedKeys} key incelendi · Key içeriği gösterilmez
      </div>

      <div style={{ borderTop: "1px solid #e5edf3", paddingTop: 10 }}>
        {node.groups.map((g) => (
          <div
            key={g.name}
            style={{
              display: "grid",
              gridTemplateColumns: "1.6fr 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid #eef3f7",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, color: "#17324d" }}>{g.name}</div>
              <div style={{ fontSize: 12, color: "#6b8096" }}>
                {g.keyCount} key
              </div>
            </div>

            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: "#e8eef3",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width:
                    node.usedMemoryBytes > 0
                      ? `${Math.min(
                          100,
                          (g.bytes / node.usedMemoryBytes) * 100
                        )}%`
                      : "0%",
                  height: "100%",
                  background: "linear-gradient(90deg, #0f766e, #198f72)",
                }}
              />
            </div>

            <div
              style={{
                textAlign: "right",
                minWidth: 140,
                fontWeight: 700,
                color: "#17324d",
              }}
            >
              {fmtBytes(g.bytes)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RedisStorageReality() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v8/redis/storage/reality/live", {
        cache: "no-store",
      });

      if (!res.ok) {
        setError(`Keyspace API HTTP ${res.status}`);
        setBusy(false);
        return;
      }

      const json = (await res.json()) as Payload;
      setData(json);
    } catch {
      setError("Keyspace API baglantisi kurulamadi.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  const footer = useMemo(() => {
    if (!data) return "Henüz ölçüm yok.";
    return `Son veri: ${fmtTime(data.checkedAt)} · Auto refresh ${
      auto ? "AÇIK" : "KAPALI"
    }`;
  }, [data, auto]);

  return (
    <div
      style={{
        border: "1px solid #d9e3ea",
        borderRadius: 16,
        padding: 20,
        background: "#ffffff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: "#17324d" }}>
            Real Redis Keyspace Breakdown
          </h2>
          <div style={{ color: "#5c7389", marginTop: 6 }}>
            Gerçek Redis INFO, DBSIZE ve MEMORY USAGE ölçümleri. Redis verileri
            değiştirilmez, key içeriği gösterilmez.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setAuto((x) => !x)}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "10px 14px",
              background: auto ? "#198f72" : "#dbe7e2",
              color: auto ? "#fff" : "#17324d",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Auto: {auto ? "ON" : "OFF"}
          </button>
          <button
            onClick={load}
            disabled={busy}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "10px 16px",
              background: "#198f72",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Ölçülüyor..." : "Şimdi Ölç"}
          </button>
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 16,
            background: "#fff5f0",
            border: "1px solid #ffd6bf",
            color: "#b54708",
            borderRadius: 12,
            padding: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {data?.cache ? <NodeCard node={data.cache} /> : null}
        {data?.streams ? <NodeCard node={data.streams} /> : null}
      </div>

      <div
        style={{
          marginTop: 16,
          color: "#5c7389",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {footer}
      </div>
    </div>
  );
}
