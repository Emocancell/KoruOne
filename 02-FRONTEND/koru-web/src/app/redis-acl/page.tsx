"use client";

import { useCallback, useEffect, useState } from "react";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

type Check = {
  id: string;
  label: string;
  category: string;
  status: "allowed" | "denied" | "unknown";
};

type Report = {
  node: string;
  connected: boolean;
  authenticatedAs: string;
  users: string[];
  checks: Check[];
  commandsExecuted: boolean;
  credentialsIncluded: boolean;
  checkedAt: string;
};

const colors = {
  text: "#173448",
  muted: "#65788a",
  accent: "#087e78",
  green: "#16785b",
  red: "#b94045",
  amber: "#a36a19",
  border: "#dce5eb",
  background: "#f7f9fb"
};

const card: React.CSSProperties = {
  padding: 22,
  borderRadius: 15,
  border: `1px solid ${colors.border}`,
  background: "#fff"
};

function StatusTag({
  status
}: {
  status: Check["status"];
}) {
  const allowed = status === "allowed";
  const denied = status === "denied";

  const color = allowed
    ? colors.green
    : denied
      ? colors.red
      : colors.amber;

  const background = allowed
    ? "#e6f3ec"
    : denied
      ? "#fbe9ea"
      : "#fff3dc";

  return (
    <span style={{
      background,
      color,
      borderRadius: 30,
      padding: "5px 10px",
      fontWeight: 700,
      fontSize: 11,
      whiteSpace: "nowrap"
    }}>
      {allowed
        ? "İZİNLİ"
        : denied
          ? "ENGELLİ"
          : "BİLİNMİYOR"}
    </span>
  );
}

function SummaryCard({
  title,
  value,
  subtitle
}: {
  title: string;
  value: string | number;
  subtitle: string;
}) {
  return (
    <div style={card}>
      <div style={{
        fontSize: 13,
        color: colors.muted
      }}>
        {title}
      </div>

      <div style={{
        fontSize: 29,
        fontWeight: 750,
        marginTop: 12,
        color: colors.text
      }}>
        {value}
      </div>

      <div style={{
        marginTop: 7,
        fontSize: 12,
        color: colors.muted
      }}>
        {subtitle}
      </div>
    </div>
  );
}

function NodePanel({
  report
}: {
  report: Report;
}) {
  const dangerous = report.checks.filter(
    x =>
      ["flushall", "config", "acl-admin"].includes(x.id)
      && x.status === "allowed"
  );

  const allowed = report.checks.filter(
    x => x.status === "allowed"
  ).length;

  const denied = report.checks.filter(
    x => x.status === "denied"
  ).length;

  const unknown = report.checks.filter(
    x => x.status === "unknown"
  ).length;

  const defaultAccount =
    report.authenticatedAs === "default";

  return (
    <section style={{
      ...card,
      marginTop: 20
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "flex-start"
      }}>
        <div>
          <p style={{
            color: colors.accent,
            fontSize: 12,
            letterSpacing: 1,
            fontWeight: 750,
            margin: "0 0 8px"
          }}>
            REDIS SECURITY NODE
          </p>
          <h2 style={{margin: 0, fontSize: 23}}>
            {report.node === "cache"
              ? "Redis Cache"
              : "Redis Streams"}
          </h2>
          <p style={{
            color: colors.muted,
            fontSize: 13
          }}>
            Kimlik: <b>{report.authenticatedAs}</b>
            {" · "}
            {report.users.length} kullanıcı
          </p>
        </div>

        <span style={{
          color: report.connected
            ? colors.green
            : colors.red,
          background: report.connected
            ? "#e5f3ec"
            : "#fbe9ea",
          fontSize: 12,
          padding: "7px 11px",
          borderRadius: 30,
          fontWeight: 750
        }}>
          {report.connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(130px,1fr))",
        gap: 12,
        marginTop: 15
      }}>
        {[
          ["İzinli", allowed, colors.green],
          ["Engelli", denied, colors.red],
          ["Bilinmeyen", unknown, colors.amber]
        ].map(([label, count, color]) => (
          <div key={String(label)} style={{
            background: colors.background,
            borderRadius: 11,
            padding: 15
          }}>
            <small style={{color: colors.muted}}>
              {label}
            </small>
            <strong style={{
              display: "block",
              fontSize: 24,
              marginTop: 7,
              color: String(color)
            }}>
              {count}
            </strong>
          </div>
        ))}
      </div>

      {defaultAccount && (
        <div style={{
          marginTop: 18,
          background: "#fff8eb",
          borderLeft: "4px solid #bd8a29",
          borderRadius: 9,
          padding: "13px 15px"
        }}>
          <strong style={{color: "#946118"}}>
            Default Account Kullanımı
          </strong>
          <p style={{
            fontSize: 13,
            margin: "7px 0 0",
            color: "#705b3b"
          }}>
            Monitoring bağlantısı default kullanıcısıyla
            kurulmuş. Üretim ortamında uygulama, monitoring
            ve operasyon hesaplarını ayırmak önerilir.
          </p>
        </div>
      )}

      {dangerous.length > 0 && (
        <div style={{
          marginTop: 14,
          background: "#fff1f1",
          borderLeft: "4px solid #c03e43",
          padding: "13px 15px",
          borderRadius: 9
        }}>
          <strong style={{color: colors.red}}>
            Geniş Yönetim Yetkisi Algılandı
          </strong>
          <p style={{
            fontSize: 13,
            margin: "7px 0 0"
          }}>
            Bu hesabın bazı kritik komutları çalıştırma
            izni bulunuyor: {" "}
            {dangerous.map(x => x.label).join(", ")}.
            Bunlar yalnızca simüle edildi.
          </p>
        </div>
      )}

      <h3 style={{marginTop: 25}}>
        Command Permission Matrix
      </h3>

      <p style={{
        color: colors.muted,
        fontSize: 13
      }}>
        Redis ACL DRYRUN sonuçları. Gerçek komut icrası yoktur.
      </p>

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(225px,1fr))",
        gap: 10
      }}>
        {report.checks.map(check => (
          <div key={check.id} style={{
            border: `1px solid ${colors.border}`,
            background: colors.background,
            borderRadius: 10,
            padding: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10
          }}>
            <div>
              <strong style={{
                fontSize: 13,
                color: colors.text
              }}>
                {check.label}
              </strong>
              <p style={{
                fontSize: 11,
                color: colors.muted,
                margin: "5px 0 0"
              }}>
                {check.category}
              </p>
            </div>
            <StatusTag status={check.status}/>
          </div>
        ))}
      </div>

      <h3 style={{marginTop: 25}}>
        Redis ACL Users
      </h3>

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 9
      }}>
        {report.users.map(user => (
          <div key={user} style={{
            background: "#edf3f6",
            padding: "10px 14px",
            borderRadius: 9,
            fontWeight: 650,
            fontSize: 13
          }}>
            <span style={{color: colors.muted}}>
              USER
            </span>
            {" · "}
            {user}
            {user === report.authenticatedAs && (
              <span style={{color: colors.green}}>
                {" "}● Active
              </span>
            )}
          </div>
        ))}
      </div>

      <p style={{
        marginTop: 19,
        fontSize: 12,
        color: colors.muted
      }}>
        Son yetki kontrolü: {" "}
        {new Date(report.checkedAt)
          .toLocaleString("tr-TR")}
      </p>
    </section>
  );
}

export default function RedisAclSecurityPro() {
  const [token, setToken] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    let active = true;
    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setError("Keycloak yapılandırması eksik.");
      return;
    }

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    manager.getUser().then(user => {
      if (!active) return;

      if (!user || user.expired || !user.access_token) {
        setError("Kurumsal giriş gerekli.");
        return;
      }

      setToken(user.access_token);
    }).catch(() => {
      if (active) setError("Oturum okunamadı.");
    });

    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;

    setBusy(true);

    try {
      const results = await Promise.allSettled(
        ["cache", "streams"].map(async node => {
          const response = await fetch(
            `/api/v7/redis/acl-pro/${node}`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              cache: "no-store"
            }
          );

          if (!response.ok) {
            throw new Error(
              `${node}: HTTP ${response.status}`
            );
          }

          return response.json() as Promise<Report>;
        })
      );

      const good: Report[] = [];
      const failures: string[] = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          good.push(result.value);
        } else {
          failures.push(
            ["cache", "streams"][index]
          );
        }
      });

      setReports(good);

      setError(
        failures.length
          ? `Okunamayan instance: ${failures.join(", ")}`
          : ""
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "ACL Security Pro hatası"
      );
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    void refresh();

    if (!auto) return;

    const timer = setInterval(
      () => void refresh(),
      30000
    );

    return () => clearInterval(timer);
  }, [token, auto, refresh]);

  function exportReport() {
    if (!reports.length) return;

    const blob = new Blob(
      [JSON.stringify({
        product: "KORU ONE ACL Security Pro",
        exportedAt: new Date().toISOString(),
        simulatedOnly: true,
        credentialsIncluded: false,
        nodes: reports
      }, null, 2)],
      {type:"application/json"}
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "koru-redis-acl-security.json";
    link.click();

    URL.revokeObjectURL(url);
  }

  const totalUsers = reports.reduce(
    (sum, r) => sum + r.users.length, 0
  );

  const criticalPermissions = reports.reduce(
    (sum, report) =>
      sum + report.checks.filter(
        x =>
          ["flushall", "config", "acl-admin"]
            .includes(x.id) &&
          x.status === "allowed"
      ).length,
    0
  );

  return (
    <main style={{
      maxWidth: 1450,
      margin: "30px auto",
      padding: "0 22px 65px",
      color: colors.text
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 15,
        flexWrap: "wrap"
      }}>
        <div>
          <p style={{
            color: colors.accent,
            letterSpacing: 1,
            fontWeight: 750,
            fontSize: 12
          }}>
            KORU ONE / REDIS SECURITY
          </p>

          <h1 style={{
            margin: "8px 0",
            fontSize: "clamp(27px,3vw,37px)"
          }}>
            Redis ACL Security Pro
          </h1>

          <p style={{
            color: colors.muted
          }}>
            Multi-node kullanıcı envanteri,
            komut yetkileri ve güvenlik risk analizi.
          </p>
        </div>

        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 9,
          alignItems: "center"
        }}>
          <Link href="/redis-fleet">
            Redis Fleet
          </Link>

          <button onClick={() => setAuto(v => !v)}>
            Auto: {auto ? "ON" : "OFF"}
          </button>

          <button disabled={!token || busy}
            onClick={() => void refresh()}>
            {busy ? "Kontrol ediliyor..." : "Yenile"}
          </button>

          <button
            onClick={exportReport}
            disabled={!reports.length}>
            JSON Rapor
          </button>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        marginTop: 15
      }}>
        <span style={{
          padding: "7px 12px",
          borderRadius: 30,
          color: colors.green,
          background: "#e6f3ec",
          fontSize: 12,
          fontWeight: 700
        }}>
          READ ONLY / DRY RUN
        </span>

        <span style={{
          color: colors.muted,
          padding: "7px 0",
          fontSize: 12
        }}>
          30 saniye yenileme · Redis ACL değişikliği yapılmaz
        </span>
      </div>

      {error && (
        <p role="alert" style={{
          background: "#fff2f2",
          padding: 14,
          color: colors.red,
          borderRadius: 10,
          marginTop: 20
        }}>
          {error}
        </p>
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit,minmax(185px,1fr))",
        gap: 14,
        marginTop: 24
      }}>
        <SummaryCard
          title="Redis Instance"
          value={reports.length || "—"}
          subtitle="ACL envanteri okunan node"
        />

        <SummaryCard
          title="ACL Kullanıcıları"
          value={reports.length ? totalUsers : "—"}
          subtitle="Node bazlı toplam"
        />

        <SummaryCard
          title="Geniş Yönetim İzinleri"
          value={reports.length ? criticalPermissions : "—"}
          subtitle="Kritik komut simülasyonu"
        />

        <SummaryCard
          title="Veri Güvenliği"
          value="0"
          subtitle="Gerçekte çalıştırılan test komutu"
        />
      </div>

      {reports.map(report => (
        <NodePanel key={report.node} report={report}/>
      ))}

      <section style={{
        ...card,
        marginTop: 24,
        background: "#f5f8fa"
      }}>
        <h2 style={{marginTop: 0}}>
          Security Recommendations
        </h2>

        <p style={{fontSize: 14}}>
          <b>1.</b> Uygulama, monitoring ve Redis operasyon
          kullanıcılarını ayrı hesaplarla yönet.
        </p>
        <p style={{fontSize: 14}}>
          <b>2.</b> Uygulama hesaplarından FLUSHALL,
          CONFIG SET ve ACL SETUSER izinlerini kaldırmayı
          üretim öncesi değerlendir.
        </p>
        <p style={{fontSize: 14}}>
          <b>3.</b> Redis ACL komut izinlerine ek olarak
          key pattern ve Pub/Sub kanal yetkilerini de
          ayrı bir güvenlik denetiminde doğrula.
        </p>
        <p style={{
          color: colors.muted,
          fontSize: 12,
          marginBottom: 0
        }}>
          Bu rapor, bağlantının kullandığı Redis hesabının
          sabit örnek komutlar üzerindeki ACL izinlerini
          kontrol eder. Diğer kullanıcıların tüm izinlerini,
          parola durumlarını veya eksiksiz güvenlik
          uygunluğunu temsil etmez.
        </p>
      </section>
    </main>
  );
}
