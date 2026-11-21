/* Firebase-Anbindung für Prinzipal (aus dem Journal übernommen).
   Bildet die Claude-Schnittstellen nach, damit der App-Code unverändert bleiben kann:
   db        → Firestore, Dokumente als JSON-Text unter users/<uid>/<pfad>
   assets    → Firebase Storage unter users/<uid>/a/<id>, Abruf über /_blob/<id> (Service Worker)
   downloads → Datei im Browser speichern
   mcp       → Ersatzdienste (Ortssuche über OpenStreetMap; Google/Todoist folgen) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, onIdTokenChanged, signOut } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, onSnapshot, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-storage.js";
import { mcpImpl } from "/pz-mcp.js";
import { isNative, TwNative } from "/pz-native.js";

const firebaseConfig = {
  apiKey: "AIzaSyAsh02b6WPTcHygRPU5yUR4uJX9Q4eynT8",
  authDomain: "journal-70fbc.firebaseapp.com",
  projectId: "journal-70fbc",
  storageBucket: "journal-70fbc.firebasestorage.app",
  messagingSenderId: "516159234064",
  appId: "1:516159234064:web:4d403ab81b379075b96a95"
};
const BUCKET = firebaseConfig.storageBucket;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app); auth.languageCode = "de";
/* Kleines Widget-Fenster (BuJo ?q= / ?wcfg=): eigener Speicher im Arbeitsspeicher und direkte Verbindung.
   Mit dem geteilten Gerätespeicher müsste es sonst warten, bis die (im Hintergrund schlafende) App die Daten weiterreicht. */
const QUICK = /^\/bujo/.test(location.pathname) && /[?&](q|wcfg)=/.test(location.search);
const fs = initializeFirestore(app, { localCache: QUICK ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const st = getStorage(app);

/* ---------- Fehler im Stil der Claude-Umgebung ---------- */
const err = (code, message) => Object.assign(new Error(message || code), { code });
const mapErr = e => {
  const c = (e && e.code) || "";
  if (/permission-denied|unauthenticated/.test(c)) return err("not_granted", e.message);
  if (/resource-exhausted|quota/.test(c)) return err("quota_exceeded", e.message);
  if (/unavailable|deadline/.test(c)) return err("unavailable", e.message);
  if (/invalid-argument/.test(c)) return err("invalid_argument", e.message);
  return e;
};

/* ---------- Datenbank ---------- */
function makeDb(uid) {
  const P = p => `users/${uid}/pz_` + String(p).replace(/^\/+|\/+$/g, "");
  const snapOf = s => {
    let cache, done = false;
    const ex = typeof s.exists === "function" ? s.exists() : !!s.exists;
    return {
      id: s.id, exists: ex,
      data() { if (!ex) return undefined; if (!done) { done = true; const raw = s.data(); try { cache = raw && typeof raw.j === "string" ? JSON.parse(raw.j) : raw; } catch (e) { cache = null; } } return cache && typeof cache === "object" ? JSON.parse(JSON.stringify(cache)) : cache; }
    };
  };
  const qsOf = qs => ({
    docs: qs.docs.map(snapOf), size: qs.size, empty: qs.empty,
    docChanges: () => qs.docChanges().map(c => ({ type: c.type, doc: snapOf(c.doc) })),
    forEach: f => qs.docs.map(snapOf).forEach(f)
  });
  const docApi = path => {
    const r = doc(fs, P(path));
    return {
      id: r.id, path,
      async get() { try { return snapOf(await getDoc(r)); } catch (e) { throw mapErr(e); } },
      async set(data) {
        const j = JSON.stringify(data === undefined ? null : data);
        if (j.length > 1000000) throw err("quota_exceeded", "Dokument zu groß");
        try { await setDoc(r, { j, t: serverTimestamp() }); } catch (e) { throw mapErr(e); }
      },
      async delete() { try { await deleteDoc(r); } catch (e) { throw mapErr(e); } },
      onSnapshot(cb, onErr) { return onSnapshot(r, s => cb(snapOf(s)), e => onErr && onErr(mapErr(e))); }
    };
  };
  const colApi = path => {
    const c = collection(fs, P(path));
    return {
      path,
      doc: id => docApi(String(path).replace(/\/+$/, "") + "/" + id),
      async get() { try { return qsOf(await getDocs(c)); } catch (e) { throw mapErr(e); } },
      onSnapshot(cb, onErr) { return onSnapshot(c, qs => cb(qsOf(qs)), e => onErr && onErr(mapErr(e))); }
    };
  };
  return { doc: docApi, collection: colApi };
}

/* ---------- Dateien (Bilder, Sticker, Videos) ---------- */
function makeAssets(uid) {
  const shard = id => doc(fs, `users/${uid}/pz_sys/assets_${id[0]}`);
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  return {
    async upload(blob, opt) {
      const id = hex(), type = (opt && opt.type) || blob.type || "application/octet-stream";
      try {
        await uploadBytes(sRef(st, `users/${uid}/pz_a/${id}`), blob, { contentType: type, cacheControl: "private, max-age=31536000, immutable" });
        await setDoc(shard(id), { m: { [id]: [blob.size, type, Date.now()] } }, { merge: true });
      } catch (e) { throw mapErr(e); }
      return { id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: type };
    },
    async delete(id) {
      if (!/^[0-9a-f]{32}$/.test(String(id))) return;
      try { await deleteObject(sRef(st, `users/${uid}/pz_a/${id}`)); } catch (e) { if (!/object-not-found/.test((e && e.code) || "")) throw mapErr(e); }
      try { await updateDoc(shard(id), { ["m." + id]: deleteField() }); } catch (e) {}
      try { (await caches.open("pz-blob-v1")).delete("/_blob/" + id); } catch (e) {}
    },
    async list() {
      const assets = []; let bytes = 0;
      const shards = await Promise.all("0123456789abcdef".split("").map(c => getDoc(doc(fs, `users/${uid}/pz_sys/assets_${c}`)).catch(() => null)));
      shards.forEach(s => { const m = s && s.exists() ? (s.data().m || {}) : {}; Object.entries(m).forEach(([id, v]) => { const [size, type, ts] = v || []; bytes += size || 0; assets.push({ id, url: "/_blob/" + id, sizeBytes: size || 0, contentType: type || "", createdAt: ts ? new Date(ts).toISOString() : null }); }); });
      assets.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { assets, usage: { bytes, maxBytes: 5 * 1024 ** 3, files: assets.length, maxFiles: 0 } };
    }
  };
}

/* ---------- Speichern auf dem Gerät ---------- */
const downloads = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    if (isNative) {
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(blob); });
      await TwNative.saveFile({ filename: filename || "Datei", mimeType: blob.type || "application/octet-stream", base64: b64 });
      return { ok: true };
    }
    const u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = filename || "Datei"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    return { ok: true };
  }
};

/* ---------- Service Worker für /_blob/ ---------- */
async function setupSw(user) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.register("/pz-sw.js", { scope: "/" });
  const send = async (force) => {
    try {
      const token = await user.getIdToken(force);
      const msg = { tw: "auth", token, uid: user.uid, bucket: BUCKET };
      (navigator.serviceWorker.controller || reg.active || reg.waiting || reg.installing)?.postMessage(msg);
    } catch (e) {}
  };
  navigator.serviceWorker.addEventListener("message", ev => { if (ev.data && ev.data.tw === "need-auth") send(false); });
  await send(false);
  onIdTokenChanged(auth, u => { if (u) send(false); });
  setInterval(() => send(true), 40 * 60 * 1000);
  if (!navigator.serviceWorker.controller) {
    /* Beim allerersten Besuch übernimmt der Service Worker erst nach einem Neuladen */
    await new Promise(r => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 4000); });
    if (!sessionStorage.getItem("tw-sw-reload")) { sessionStorage.setItem("tw-sw-reload", "1"); location.reload(); return new Promise(() => {}); }
  }
  await send(false);
}

/* ---------- Anmeldung ---------- */
function loginScreen(msg) {
  let el = document.getElementById("tw-login");
  if (!el) {
    el = document.createElement("div"); el.id = "tw-login";
    el.innerHTML = `<style>
      #tw-login{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;background:#e9eaf2;font:16px/1.45 Inter,system-ui,sans-serif;color:#232a33}
      #tw-login .twc{position:static;height:auto;overflow:visible;max-width:420px;width:100%;background:#fff;border:1px solid #d9dbe6;border-top:6px solid #333d4a;border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 10px 30px rgba(59,42,32,.12)}
      #tw-login h2{font:700 1.9rem/1.1 Inter,system-ui,sans-serif;margin:0}
      #tw-login button{border:0;background:#f1da3c;color:#232a33;font:700 1.05rem system-ui,sans-serif;padding:14px;border-radius:14px;cursor:pointer}
      #tw-login small{color:#5b6472}</style>
      <div class="twc"><h2>Prinzipal</h2><p>Bitte melde dich mit deinem Google-Konto an.</p><button type="button" id="tw-go">Mit Google anmelden</button><small id="tw-msg"></small></div>`;
    document.body.appendChild(el);
    el.querySelector("#tw-go").addEventListener("click", async () => {
      if (isNative) {
        try { await nativeSignIn(false); location.reload(); }
        catch (e) { twDiag("Anmeldung: " + (e.code || "") + " " + (e.message || e), true); el.querySelector("#tw-msg").textContent = "Anmeldung fehlgeschlagen: " + (e.code || "") + " " + (e.message || ""); }
        return;
      }
      const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      try { await signInWithPopup(auth, p); location.reload(); }
      catch (e) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) return signInWithRedirect(auth, p);
        if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") el.querySelector("#tw-msg").textContent = "Anmeldung fehlgeschlagen: " + (e.code || e.message);
      }
    });
  }
  if (msg) el.querySelector("#tw-msg").textContent = msg;
}

/* In der Android-App: Anmeldung über das Google-Konto des Geräts */
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what + " antwortet nicht"), { code: "timeout" })), ms))]);
async function nativeSignIn(silent) {
  twDiag("Anmeldung " + (silent ? "still" : "mit Auswahl") + " …");
  const r = await withTimeout(TwNative.signIn({ silent }), silent ? 10000 : 120000, "Google-Kontoauswahl");
  twDiag("Konto erhalten: " + (r.email || "?"));
  const c = await withTimeout(signInWithCredential(auth, GoogleAuthProvider.credential(r.idToken)), 20000, "Firebase-Anmeldung");
  twDiag("angemeldet");
  return c;
}
/* Kleine Statuszeile in der Android-App, solange etwas hakt (verschwindet nach dem Start) */
const TW_LOG = [];
function twDiag(m, isErr) {
  TW_LOG.push(new Date().toISOString().slice(11, 19) + " " + m); console[isErr ? "warn" : "log"]("[tw]", m);
  if (!isNative || !isErr) return;
  /* Nur Fehler zeigen, und erst nach einer Weile – was klappt, braucht keinen Hinweis */
  twDiag.err = true; if (twDiag.t) return;
  twDiag.t = setTimeout(() => {
    twDiag.t = 0; if (!twDiag.err) return;
    const put = () => {
      let el = document.getElementById("tw-diag");
      if (!el) { el = document.createElement("div"); el.id = "tw-diag"; el.style.cssText = "position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:2147483600;background:rgba(59,42,32,.92);color:#fffaf2;font:12px/1.35 system-ui,sans-serif;padding:8px 10px;border-radius:10px;max-height:30vh;overflow:auto;white-space:pre-wrap"; el.onclick = () => { el.remove(); twDiag.err = false; }; document.body.appendChild(el); }
      el.textContent = TW_LOG.slice(-12).join("\n") + "\n(Antippen schließt)";
    };
    document.body ? put() : addEventListener("DOMContentLoaded", put);
  }, 8000);
}
window.__twDiag = twDiag;
if (isNative) {
  twDiag("Android-App erkannt, Version Web " + (document.lastModified || ""));
  addEventListener("error", e => { if (/ResizeObserver loop/i.test(e.message || "")) return; /* harmlose Browser-Meldung */ twDiag("Fehler: " + (e.message || e), true); });
  addEventListener("unhandledrejection", e => twDiag("Fehler: " + ((e.reason && (e.reason.code || e.reason.message)) || e.reason), true));
}

if (!isNative) getRedirectResult(auth).then(r => { if (r && r.user) location.reload(); }).catch(() => {});

let started = false;
onAuthStateChanged(auth, async user => {
  if (started) { if (!user) location.reload(); return; }
  if (!user) {
    if (isNative && !window.__twTriedSilent) { window.__twTriedSilent = true; try { await nativeSignIn(true); return; } catch (e) { twDiag("Stille Anmeldung: " + (e.code || "") + " " + (e.message || e), true); } }
    const go = () => loginScreen(); document.body ? go() : addEventListener("DOMContentLoaded", go); return;
  }
  started = true;
  try { await setupSw(user); } catch (e) { console.warn("Service Worker", e); }
  const impl = {
    db: makeDb(user.uid),
    assets: makeAssets(user.uid),
    downloads,
    mcp: mcpImpl({ user, auth, fs }),
    sample: null,      /* Claude-Funktionen: in dieser Fassung noch nicht angebunden */
    dictation: null,
    user: { id: user.uid, name: user.displayName, email: user.email }
  };
  window.__twAuth = { auth, signOut: () => signOut(auth), user };
  window.__twReady.resolve(impl);
  if (isNative) { twDiag("bereit"); /* Anmeldung geklappt: frühere Anmelde-Hänger nicht mehr melden */ if (!TW_LOG.some(l => /Fehler:/.test(l))) twDiag.err = false; }
});
