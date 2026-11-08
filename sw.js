// Service worker: кэш статики и офлайн-страница (CLAUDE.md, п. 9).
// Страницы — «сначала сеть» (правки из админки видны сразу), статика с хэшем — «сначала кэш».
// /api/* не перехватывается никогда: заявки, чат и админка всегда идут на сервер.

const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const OFFLINE = { ru: "/offline", en: "/en/offline" };
const MAX_PAGES = 30;

/** Офлайн-страницы и их стили/скрипты кладём в кэш при установке */
async function precache() {
  const cache = await caches.open(STATIC);
  await cache.addAll(["/favicon.svg", "/icon-192.png"]);
  for (const url of Object.values(OFFLINE)) {
    const res = await fetch(url, { cache: "reload" });
    if (!res.ok) continue;
    const html = await res.clone().text();
    await cache.put(url, res);
    const assets = [...new Set(html.match(/\/_astro\/[^"'\s)]+/g) || [])];
    await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimPages() {
  const cache = await caches.open(PAGES);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((k) => cache.delete(k)));
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") {
      const cache = await caches.open(PAGES);
      await cache.put(request, res.clone());
      trimPages();
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const lang = new URL(request.url).pathname.startsWith("/en") ? "en" : "ru";
    return (await caches.match(OFFLINE[lang])) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") (await caches.open(STATIC)).put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith("/_astro/") || /\.(png|svg|jpg|jpeg|webp|avif|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
