/* Service Worker: liefert /_blob/<id> aus dem geschützten Firebase-Speicher
   und hält einmal geladene Bilder auf dem Gerät vor (sie ändern sich nie). */
const CACHE = "pz-blob-v1";
/* Obergrenze für die Bild-Ablage auf dem Gerät; ältere Bilder fliegen zuerst raus (werden bei Bedarf neu geladen) */
const MAXB = 200 * 1024 * 1024;
let puts = 0, trimming = false;
async function trim() {
  if (trimming) return; trimming = true;
  try {
    const cache = await caches.open(CACHE), keys = await cache.keys(), sz = [];
    let sum = 0;
    for (const k of keys) { const r = await cache.match(k); const n = r ? +(r.headers.get("Content-Length") || 0) : 0; sz.push(n); sum += n; }
    for (let i = 0; i < keys.length && sum > MAXB * 0.85; i++) { await cache.delete(keys[i]); sum -= sz[i]; }
  } catch (e) {} finally { trimming = false; }
}
let AUTH = null, waiters = [];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim().then(() => trim())));

self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.tw === "auth" && d.token) { AUTH = d; waiters.splice(0).forEach(w => w(AUTH)); }
});

async function needAuth() {
  if (AUTH) return AUTH;
  const cs = await self.clients.matchAll({ type: "window" });
  cs.forEach(c => c.postMessage({ tw: "need-auth" }));
  return new Promise(res => { waiters.push(res); setTimeout(() => res(AUTH), 8000); });
}

async function serve(req, id) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match("/_blob/" + id);
  if (hit) return hit;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await needAuth();
    if (!a) return new Response("nicht angemeldet", { status: 401 });
    const url = `https://firebasestorage.googleapis.com/v0/b/${a.bucket}/o/${encodeURIComponent(`users/${a.uid}/pz_a/${id}`)}?alt=media`;
    const r = await fetch(url, { headers: { Authorization: "Firebase " + a.token }, cache: "no-store" }); /* nicht zusätzlich im Browser-Zwischenspeicher ablegen (sonst liegt jedes Bild doppelt) */
    if (r.status === 401 || r.status === 403) { AUTH = null; continue; }
    if (!r.ok) return new Response("nicht gefunden", { status: r.status });
    const blob = await r.blob();
    const out = new Response(blob, { status: 200, headers: { "Content-Type": r.headers.get("Content-Type") || blob.type || "application/octet-stream", "Content-Length": String(blob.size), "Cache-Control": "private, max-age=31536000, immutable" } });
    try { await cache.put("/_blob/" + id, out.clone()); if (++puts % 40 === 1) trim(); } catch (e) {}
    return out;
  }
  return new Response("keine Berechtigung", { status: 403 });
}

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const m = u.pathname.match(/^\/_blob\/([0-9a-f]{32})$/);
  if (m) e.respondWith(serve(e.request, m[1]));
});
