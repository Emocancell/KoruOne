"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { UserManager } from "oidc-client-ts";
import Link from "next/link";

const centers = [
  { title: "Genel Bakış", url: "/", roles: [] },
  { title: "Ürün Vitrini", url: "/store", roles: [] },
  { title: "İK Merkezi", url: "/hr", roles: ["hr", "admin"] },
  { title: "Network Merkezi", url: "/operations", roles: ["network", "admin"] },
  { title: "IT Merkezi", url: "/operations", roles: ["it", "admin"] },
  { title: "Pazarlama Merkezi", url: "/marketing", roles: ["marketing", "admin"] },
  { title: "Sipariş & Teklif", url: "/commerce", roles: ["marketing", "admin"] },
  { title: "Reklam Merkezi", url: "/advertising", roles: ["advertising", "admin"] },
  { title: "Redis Intelligence", url: "/redis-intelligence",
    roles: ["redis-viewer", "redis-operator", "admin"] },
  { title: "Redis Node Fleet", url: "/redis-fleet",
    roles: ["redis-viewer", "redis-operator", "admin"] },
  { title: "Redis Diagnostics",
    url: "/redis-diagnostics",
    roles: ["redis-viewer", "redis-operator", "admin"] },
  { title: "Redis Streams Ops",
    url: "/redis-streams-ops",
    roles: ["admin", "redis-viewer", "redis-operator"] },
  { title: "Redis ACL Security",
    url: "/redis-acl",
    roles: ["admin", "redis-operator"] },
  { title: "Admin Pro", url: "/admin-pro", roles: ["admin"] }
];

export default function KoruNavigation() {
  const pathname = usePathname();
  const [roles, setRoles] = useState<string[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const authority = process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) return;

    const manager = new UserManager({
      authority,
      client_id: "koru-web",
      redirect_uri: window.location.origin + "/callback",
      response_type: "code",
      scope: "openid profile email"
    });

    async function loadSession() {
      try {
        const session = await manager.getUser();

        if (!session || session.expired) {
          if (active) {
            setLoggedIn(false);
            setRoles([]);
          }
          return;
        }

        const response = await fetch("/api/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          },
          cache: "no-store"
        });

        if (!response.ok) throw Error("Oturum doğrulanamadı");

        const me = await response.json();

        if (active) {
          setLoggedIn(true);
          setRoles(Array.isArray(me.roles) ? me.roles : []);
        }
      } catch {
        if (active) {
          setLoggedIn(false);
          setRoles([]);
        }
      }
    }

    void loadSession();

    const refresh = window.setInterval(loadSession, 10000);
    window.addEventListener("focus", loadSession);

    return () => {
      active = false;
      window.clearInterval(refresh);
      window.removeEventListener("focus", loadSession);
    };
  }, [pathname]);

  return (
    <nav className="koru-global-nav" aria-label="KORU ONE merkezleri">
      <div className="koru-global-nav-inner">
        <Link href="/" className="koru-brand">KORU ONE</Link>

        {centers.map(center => {
          const allowed =
            loggedIn &&
            (center.roles.length === 0 ||
             center.roles.some(role => roles.includes(role)));

          const general = center.url === "/" || center.url === "/store";

          if (allowed || general) {
            return (
              <Link
                key={center.title}
                href={center.url}
                className={
                  "koru-global-nav-link" +
                  (pathname === center.url ? " active" : "")
                }
              >
                {center.title}
              </Link>
            );
          }

          return (
            <span
              key={center.title}
              className="koru-global-nav-link koru-locked"
              title={loggedIn ? "Bu merkeze yetkiniz yok" : "Önce giriş yapın"}
              aria-disabled="true"
            >
              {center.title} 🔒
            </span>
          );
        })}

        {!loggedIn && (
          <Link href="/" className="koru-login-link">
            Giriş Yap
          </Link>
        )}

        {roles.includes("admin") && (
          <span className="koru-admin-label">Admin Pro</span>
        )}
      </div>
    </nav>
  );
}
