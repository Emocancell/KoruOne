"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function closestCard(el: HTMLElement | null): HTMLElement | null {
  let cur = el;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "section" || tag === "article") return cur;
    if (cur.className && /card|panel|block|container|section/i.test(String(cur.className))) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

function hideSectionByText(text: string) {
  const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,strong,span,div,p")) as HTMLElement[];
  const hit = nodes.find(n => (n.textContent || "").trim() === text);
  if (!hit) return;

  const card = closestCard(hit) || hit.parentElement;
  if (card) {
    (card as HTMLElement).style.display = "none";
  }
}


function patchWriteBanner() {
  const nodes = Array.from(
    document.querySelectorAll("div,p,span")
  ) as HTMLElement[];

  const hit = nodes.find(n =>
    n.children.length === 0 &&
    (n.textContent || "").includes("Write failed")
  );

  if (hit) {
    hit.classList.add("koru-redis-warning");
  }
}

function beautifyMultiRedis() {
  const nodes = Array.from(document.querySelectorAll("h1,h2,h3")) as HTMLElement[];
  const title = nodes.find(n => (n.textContent || "").includes("Multi-Redis Infrastructure"));
  if (!title) return;

  title.classList.add("koru-redis-title");

  const topContainer = closestCard(title) || title.parentElement;
  if (topContainer) {
    topContainer.classList.add("koru-redis-hero");
  }

  const subtitles = Array.from(document.querySelectorAll("p,span,div")) as HTMLElement[];
  const sub = subtitles.find(n =>
    (n.textContent || "").includes("Bağımsız instance'lar, departman ACL, gerçek metrikler")
  );
  if (sub) sub.classList.add("koru-redis-subtitle");

  const cards = Array.from(document.querySelectorAll("div")) as HTMLElement[];
  cards.forEach(card => {
    const txt = (card.textContent || "").trim();

    if (
      txt.includes("localhost:3001") ||
      txt.includes("localhost:3002") ||
      txt.includes("localhost:3003")
    ) {
      card.classList.add("koru-redis-nodecard");
    }

    if (
      txt.includes("Keyspace Explorer") ||
      txt.includes("Güvenli giriş") ||
      txt.includes("ACL kullanıcı")
    ) {
      card.classList.add("koru-redis-panel");
    }
  });
}

function improveButtons() {
  const buttons = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
  buttons.forEach(btn => {
    const txt = (btn.textContent || "").trim();

    if (/Yenile|Listele|Bağlan|Güncelle|Oku|Sil|Kaydet/i.test(txt)) {
      btn.classList.add("koru-redis-btn");
    }

    if (/Sil/i.test(txt)) {
      btn.classList.add("koru-redis-btn-danger");
    }

    if (/Bağlan|Güncelle|Kaydet/i.test(txt)) {
      btn.classList.add("koru-redis-btn-primary");
    }
  });

  const inputs = Array.from(document.querySelectorAll("input,textarea,select")) as HTMLElement[];
  inputs.forEach(i => i.classList.add("koru-redis-input"));
}

export default function RedisEnterpriseEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.includes("redis")) return;

    const run = () => {
      try {
        hideSectionByText("Department Storage Allocation");
        hideSectionByText("Storage Plan Manager");
        patchWriteBanner();
        beautifyMultiRedis();
        improveButtons();
      } catch {}
    };

    run();
    const t = setTimeout(run, 300);
    const t2 = setTimeout(run, 1200);

    const observer = new MutationObserver(() => run());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
