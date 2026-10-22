"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserManager } from "oidc-client-ts";
import styles from "./KoruNavigation.module.css";

type Identity = {
  username: string;
  roles: string[];
};

type MenuName = "centers" | "redis" | "account" | null;

type NavigationItem = {
  title: string;
  href: string;
  roles: string[];
  description?: string;
};

const mainLinks: NavigationItem[] = [
  {
    title: "Genel Bakış",
    href: "/",
    roles: []
  },
  {
    title: "Network Merkezi",
    href: "/operations",
    roles: ["network", "admin"]
  },
  {
    title: "IT Merkezi",
    href: "/operations",
    roles: ["it", "admin"]
  },
  {
    title: "Taleplerim",
    href: "/taleplerim",
    roles: []
  }
];

const centerLinks: NavigationItem[] = [
  {
    title: "Ürün Vitrini",
    href: "/store",
    roles: [],
    description: "Ürün ve hizmet kataloğu"
  },
  {
    title: "İK Merkezi",
    href: "/hr",
    roles: ["hr", "admin"],
    description: "Personel ve maaş yönetimi"
  },
  {
    title: "Pazarlama Merkezi",
    href: "/marketing",
    roles: ["marketing", "admin"],
    description: "Pazarlama operasyonları"
  },
  {
    title: "Sipariş & Teklif",
    href: "/commerce",
    roles: ["marketing", "admin"],
    description: "Ticari iş akışları"
  },
  {
    title: "Reklam Merkezi",
    href: "/advertising",
    roles: ["advertising", "admin"],
    description: "Kampanya ve reklamlar"
  },
  {
    title: "Admin Pro",
    href: "/admin-pro",
    roles: ["admin"],
    description: "Kurumsal sistem yönetimi"
  }
];

const redisLinks: NavigationItem[] = [
  {
    title: "Redis Monitoring Engine",
    href: "/redis-monitoring",
    roles: ["admin", "network",
            "redis-viewer", "redis-operator"],
    description: "7/24 izleme, kalici grafikler ve alarmlar"
  },
  {
    title: "Redis Alerts & Slowlog",
    href: "/redis-operations",
    roles: ["admin", "network",
            "redis-viewer", "redis-operator"],
    description: "Canli alarmlar ve yavas komutlar"
  },
  {
    title: "Redis Storage & Capacity",
    href: "/redis-storage",
    roles: ["admin", "network",
            "redis-viewer", "redis-operator"],
    description: "Departman bellek butceleri ve grafikler"
  },
  {
    title: "Redis User Access",
    href: "/redis-users",
    roles: ["admin", "network"],
    description: "Kullanici bazli Redis yetkileri"
  },
  {
    title: "Redis Node Registry",
    href: "/redis-registry",
    roles: ["admin", "network",
            "redis-viewer", "redis-operator"],
    description: "Departman kaynak atamaları ve canlı node verileri"
  },
  {
    title: "Redis Access Manager",
    href: "/redis-access",
    roles: ["admin", "network"],
    description: "Departman bazli Redis erisim politikalari"
  },
  {
    title: "Redis Intelligence",
    href: "/redis-intelligence",
    roles: ["admin", "redis-viewer", "redis-operator"],
    description: "Anlık performans grafikleri"
  },
  {
    title: "Redis Node Fleet",
    href: "/redis-fleet",
    roles: ["admin", "redis-viewer", "redis-operator", "network"],
    description: "Cache ve Streams node envanteri"
  },
  {
    title: "Redis Diagnostics",
    href: "/redis-diagnostics",
    roles: ["admin", "redis-viewer", "redis-operator", "network"],
    description: "Kapasite, persistence ve sağlık"
  },
  {
    title: "Redis Streams Operations",
    href: "/redis-streams-ops",
    roles: ["admin", "redis-viewer", "redis-operator"],
    description: "Consumer, pending ve ACK"
  },
  {
    title: "Redis ACL Security",
    href: "/redis-acl",
    roles: ["admin", "redis-operator"],
    description: "ACL kullanıcıları ve yetki analizi"
  }
];

function hasAccess(
  item: NavigationItem,
  roles: string[]
): boolean {
  if (item.roles.length === 0) return true;

  return item.roles.some(role =>
    roles.some(r =>
      r.toLowerCase() === role.toLowerCase()
    )
  );
}

function roleLabel(roles: string[]): string {
  if (roles.includes("admin")) return "Admin Pro";
  if (roles.includes("redis-operator")) return "Redis Operator";
  if (roles.includes("redis-viewer")) return "Redis Viewer";
  if (roles.includes("network")) return "Network";
  if (roles.includes("it")) return "IT";
  if (roles.includes("hr")) return "İnsan Kaynakları";
  if (roles.includes("marketing")) return "Marketing";
  if (roles.includes("advertising")) return "Advertising";
  return roles[0] || "Kullanıcı";
}

export default function KoruNavigation() {
  const pathname = usePathname();

  const [identity, setIdentity] =
    useState<Identity | null>(null);

  const [ready, setReady] = useState(false);
  const [openMenu, setOpenMenu] =
    useState<MenuName>(null);

  const shellRef = useRef<HTMLElement>(null);

  const refreshIdentity = useCallback(async () => {
    const authority =
      process.env.NEXT_PUBLIC_OIDC_AUTHORITY;

    if (!authority) {
      setIdentity(null);
      setReady(true);
      return;
    }

    try {
      const manager = new UserManager({
        authority,
        client_id: "koru-web",
        redirect_uri: window.location.origin + "/callback",
        response_type: "code",
        scope: "openid profile email"
      });

      const session = await manager.getUser();

      if (!session || session.expired) {
        setIdentity(null);
        return;
      }

      const response = await fetch("/api/me", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        setIdentity(null);
        return;
      }

      // KORU_V831_USER_SYNC
      void fetch("/api/v8/redis/users/self", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        cache: "no-store"
      }).catch(() => undefined);

      const profile = await response.json() as {
        name?: string;
        roles?: string[];
      };

      const username = String(
        session.profile.preferred_username ||
        profile.name ||
        session.profile.name ||
        "Kurumsal Kullanıcı"
      );

      setIdentity({
        username,
        roles: Array.isArray(profile.roles)
          ? profile.roles.map(r => r.toLowerCase())
          : []
      });
    } catch {
      setIdentity(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();

    const timer = window.setInterval(
      () => void refreshIdentity(),
      30000
    );

    window.addEventListener("focus", refreshIdentity);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIdentity);
    };
  }, [refreshIdentity]);

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (
        shellRef.current &&
        !shellRef.current.contains(event.target as Node)
      ) {
        setOpenMenu(null);
      }
    }

    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const roles = identity?.roles ?? [];

  const availableCenters = centerLinks.filter(item =>
    hasAccess(item, roles)
  );

  const availableRedis = redisLinks.filter(item =>
    identity !== null && hasAccess(item, roles)
  );

  const redisAllowed = availableRedis.length > 0;

  const isRedisPage =
    pathname.startsWith("/redis-");

  function toggle(menu: Exclude<MenuName, null>) {
    setOpenMenu(previous =>
      previous === menu ? null : menu
    );
  }

  function menuLink(item: NavigationItem) {
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          styles.menuLink +
          (pathname === item.href
            ? " " + styles.selected
            : "")
        }
        onClick={() => setOpenMenu(null)}
      >
        <span className={styles.menuTitle}>
          {item.title}
        </span>
        {item.description && (
          <span className={styles.menuDescription}>
            {item.description}
          </span>
        )}
      </Link>
    );
  }

  return (
    <nav
      ref={shellRef}
      className={styles.shell}
      aria-label="KORU ONE ana navigasyon"
    >
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>K</span>
          <span>KORU <b>ONE</b></span>
        </Link>

        <div className={styles.primary}>
          {mainLinks
            .filter(item =>
              item.href === "/" ||
              (identity && hasAccess(item, roles))
            )
            .map(item => (
              <Link
                key={item.title}
                href={item.href}
                className={
                  styles.mainLink +
                  (pathname === item.href
                    ? " " + styles.active
                    : "")
                }
              >
                {item.title}
              </Link>
            ))}

          <div className={styles.dropdown}>
            <button
              type="button"
              className={styles.menuButton}
              aria-expanded={openMenu === "centers"}
              aria-haspopup="true"
              onClick={() => toggle("centers")}
            >
              Diğer Merkezler
              <span aria-hidden="true">⌄</span>
            </button>

            {openMenu === "centers" && (
              <div className={styles.panel}>
                <div className={styles.panelHeading}>
                  Departman Merkezleri
                </div>
                {availableCenters.map(menuLink)}
              </div>
            )}
          </div>
        </div>

        <div className={styles.right}>
          {identity ? (
            <div className={styles.dropdown}>
              <button
                type="button"
                className={styles.profileButton}
                aria-expanded={openMenu === "account"}
                aria-haspopup="true"
                onClick={() => toggle("account")}
              >
                <span className={styles.avatar}>
                  {identity.username
                    .slice(0, 2)
                    .toUpperCase()}
                </span>

                <span className={styles.profileText}>
                  <strong>{identity.username}</strong>
                  <small>{roleLabel(roles)}</small>
                </span>

                <span aria-hidden="true">⌄</span>
              </button>

              {openMenu === "account" && (
                <div className={styles.panel}>
                  <div className={styles.panelHeading}>
                    Aktif Oturum
                  </div>

                  <div className={styles.accountInfo}>
                    <strong>{identity.username}</strong>
                    <small>
                      Keycloak ile doğrulanan oturum
                    </small>
                  </div>

                  <div className={styles.roleList}>
                    {roles.map(role => (
                      <span
                        key={role}
                        className={styles.roleChip}
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link href="/" className={styles.guestLink}>
              {ready ? "Giriş Yap" : "Oturum Kontrolü"}
            </Link>
          )}

          {redisAllowed && (
            <div className={styles.dropdown}>
              <button
                type="button"
                className={
                  styles.redisButton +
                  (isRedisPage
                    ? " " + styles.redisActive
                    : "")
                }
                aria-expanded={openMenu === "redis"}
                aria-haspopup="true"
                onClick={() => toggle("redis")}
              >
                <span className={styles.redisDot}/>
                Redis Control
                <span aria-hidden="true">⌄</span>
              </button>

              {openMenu === "redis" && (
                <div className={styles.panel}>
                  <div className={styles.panelHeading}>
                    REDIS CONTROL PLANE
                  </div>

                  <div className={styles.panelIntro}>
                    İzleme, güvenlik ve operasyon yönetimi
                  </div>

                  {availableRedis.map(menuLink)}

                  <div className={styles.panelFooter}>
                    Erişimler rol bazlı denetlenir
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
