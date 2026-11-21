/* Google Kalender und Google Drive für das Journal.
   Zugriff über ein Google-Zugangstoken (Google Identity Services). Ein Token gilt eine Stunde;
   ist keins da, erscheint oben ein kleiner Knopf „Mit Google verbinden“.
   Die Antworten haben dieselbe Form wie die Claude-Verbindungen, damit der App-Code gleich bleibt. */
import { isNative, TwNative } from "/pz-native.js";
export const GOOGLE_CLIENT_ID = "516159234064-8j1n4v9i3t8i5ouhioqqk55bb4ivfien.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive"
].join(" ");
const TZ = "Europe/Berlin";
const err = (code, message) => Object.assign(new Error(message || code), { code });

/* ---------- Token ---------- */
let tok = null, tokExp = 0, client = null, waiting = [], hint = "";
try { const t = JSON.parse(localStorage.getItem("tw-gtok") || "null"); if (t && t.exp > Date.now() + 60000) { tok = t.tok; tokExp = t.exp; } } catch (e) {}

function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = res; s.onerror = () => rej(err("unavailable", "Google-Anmeldung nicht erreichbar")); document.head.appendChild(s); });
}
async function getClient() {
  if (client) return client;
  if (!GOOGLE_CLIENT_ID) throw err("not_granted", "Google ist noch nicht eingerichtet");
  await loadGis();
  client = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID, scope: SCOPES, hint, include_granted_scopes: true,
    callback: r => {
      if (r && r.access_token) {
        tok = r.access_token; tokExp = Date.now() + (r.expires_in || 3600) * 1000;
        try { localStorage.setItem("tw-gtok", JSON.stringify({ tok, exp: tokExp })); } catch (e) {}
        banner(false); waiting.splice(0).forEach(w => w.res(tok));
      } else waiting.splice(0).forEach(w => w.rej(err("not_granted", "Google-Zugriff abgelehnt")));
    },
    error_callback: e => { banner(true); waiting.splice(0).forEach(w => w.rej(err("not_granted", (e && e.type) || "Google-Zugriff abgebrochen"))); }
  });
  return client;
}
function banner(show) {
  let b = document.getElementById("tw-gbar");
  if (!show) { if (b) b.remove(); return; }
  if (b) return;
  b = document.createElement("button"); b.id = "tw-gbar"; b.type = "button";
  b.textContent = "Mit Google verbinden (Kalender und Drive)";
  b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));z-index:2147482000;border:0;border-radius:99px;padding:10px 16px;background:#3b2a20;color:#fffaf2;font:700 14px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer";
  b.addEventListener("click", async () => { try { if (isNative) await nativeToken(true); else (await getClient()).requestAccessToken({ prompt: "" }); } catch (e) {} });
  document.body.appendChild(b);
}
/* Android-App: Zugang still über das Gerät; nur beim allerersten Mal fragt Google nach */
async function nativeToken(interactive) {
  (window.__twDiag || (() => {}))("Google-Zugang " + (interactive ? "mit Zustimmung" : "still") + " …");
  const r = await TwNative.authorize({ scopes: SCOPES.split(" "), email: hint || undefined, silent: !interactive });
  tok = r.accessToken; tokExp = Date.now() + 50 * 60 * 1000;
  (window.__twDiag || (() => {}))("Google-Zugang erhalten");
  try { localStorage.setItem("tw-gtok", JSON.stringify({ tok, exp: tokExp })); } catch (e) {}
  banner(false); waiting.splice(0).forEach(w => w.res(tok));
  return tok;
}
async function token() {
  if (tok && tokExp > Date.now() + 60000) return tok;
  if (isNative) {
    try { return await nativeToken(false); }
    catch (e) {
      (window.__twDiag || (() => {}))("Google-Zugang: " + (e.code || "") + " " + (e.message || e), true);
      banner(true);
      return new Promise((res, rej) => { waiting.push({ res, rej }); setTimeout(() => rej(err("not_granted", "Google nicht verbunden")), 180000); });
    }
  }
  await getClient();
  banner(true);
  return new Promise((res, rej) => { waiting.push({ res, rej }); setTimeout(() => rej(err("not_granted", "Google nicht verbunden")), 120000); });
}
export async function connectGoogle() { if (isNative) return nativeToken(true); (await getClient()).requestAccessToken({ prompt: "" }); }
export function setGoogleHint(email) { hint = email || ""; }

export async function gfetch(url, opt = {}) {
  for (let k = 0; k < 2; k++) {
    const t = await token();
    const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + t } });
    if (r.status === 401) { tok = null; tokExp = 0; continue; }
    if (r.status === 403 || r.status === 429) { const x = await r.text(); throw err(/rate|quota/i.test(x) ? "rate_limited" : "not_granted", x.slice(0, 300)); }
    if (!r.ok) throw err(r.status === 404 ? "not_found" : "unavailable", (await r.text()).slice(0, 300));
    return r;
  }
  throw err("not_granted", "Google-Anmeldung abgelaufen");
}

/* ---------- Zeiten: "2026-11-12T00:00:00" als Berliner Ortszeit ---------- */
function offsetFor(local) {
  const d = new Date(local + "Z");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const g = t => +parts.find(p => p.type === t).value;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  const min = Math.round((asUtc - d.getTime()) / 60000);
  const s = min >= 0 ? "+" : "-", a = Math.abs(min);
  return s + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
}
const rfc = t => { if (!t) return t; if (/[zZ]|[+-]\d\d:\d\d$/.test(t)) return t; const x = t.length === 10 ? t + "T00:00:00" : t; return x + offsetFor(x); };

/* ---------- Kalender ---------- */
const CAL = "https://www.googleapis.com/calendar/v3/calendars/";
async function listEvents(a) {
  const p = new URLSearchParams({ singleEvents: "true", timeZone: TZ, maxResults: String(Math.min(a.pageSize || 100, 2500)) });
  if (a.startTime) p.set("timeMin", rfc(a.startTime));
  if (a.endTime) p.set("timeMax", rfc(a.endTime));
  if (a.fullText) p.set("q", a.fullText);
  if (a.pageToken) p.set("pageToken", a.pageToken);
  if (a.orderBy === "startTime") p.set("orderBy", "startTime");
  else if (a.orderBy === "lastModified") p.set("orderBy", "updated");
  (a.eventType && a.eventType.length ? a.eventType : ["default", "outOfOffice", "focusTime", "fromGmail"]).forEach(t => p.append("eventTypes", String(t).toLowerCase().replace(/_(\w)/g, (m, c) => c.toUpperCase())));
  const r = await (await gfetch(CAL + encodeURIComponent(a.calendarId || "primary") + "/events?" + p)).json();
  const out = { ...r, events: r.items || [] }; delete out.items;
  return out;
}
function evBody(a) {
  const b = {};
  if (a.summary !== undefined) b.summary = a.summary;
  if (a.description !== undefined) b.description = a.description;
  if (a.location !== undefined) b.location = a.location;
  if (a.startTime) {
    if (a.allDay || /^\d{4}-\d{2}-\d{2}$/.test(a.startTime)) { b.start = { date: a.startTime.slice(0, 10) }; b.end = { date: (a.endTime || a.startTime).slice(0, 10) }; }
    else { b.start = { dateTime: rfc(a.startTime), timeZone: TZ }; b.end = { dateTime: rfc(a.endTime || a.startTime), timeZone: TZ }; }
  }
  return b;
}
async function createEvent(a) { return (await gfetch(CAL + encodeURIComponent(a.calendarId || "primary") + "/events?sendUpdates=none", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evBody(a)) })).json(); }
async function updateEvent(a) { return (await gfetch(CAL + encodeURIComponent(a.calendarId || "primary") + "/events/" + encodeURIComponent(a.eventId) + "?sendUpdates=none", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evBody(a)) })).json(); }
async function deleteEvent(a) { await gfetch(CAL + encodeURIComponent(a.calendarId || "primary") + "/events/" + encodeURIComponent(a.eventId) + "?sendUpdates=none", { method: "DELETE" }); return { success: true }; }

/* ---------- Drive ---------- */
const DRV = "https://www.googleapis.com/drive/v3/files";
const FIELDS = "id,name,mimeType,parents,createdTime,modifiedTime,size,webViewLink,trashed,starred,thumbnailLink";
const toConn = f => ({ id: f.id, title: f.name, mimeType: f.mimeType, parentId: (f.parents || [])[0], viewUrl: f.webViewLink, createdTime: f.createdTime, modifiedTime: f.modifiedTime, fileSize: f.size, size: f.size, trashed: !!f.trashed, starred: !!f.starred, thumbnailLink: f.thumbnailLink });
function driveQuery(q) {
  let s = String(q || "");
  s = s.replace(/\bparentId\s*=\s*('(?:[^'\\]|\\.)*')/g, "$1 in parents").replace(/\bparentId\s*!=\s*('(?:[^'\\]|\\.)*')/g, "not $1 in parents");
  s = s.replace(/\btitle\b/g, "name");
  s = s.replace(/\bowner\s*=\s*'me'/g, "'me' in owners");
  if (!/\btrashed\b/.test(s)) s = s ? `(${s}) and trashed = false` : "trashed = false";
  return s;
}
async function searchFiles(a) {
  const p = new URLSearchParams({ q: driveQuery(a.query), pageSize: String(Math.min(a.pageSize || 100, 1000)), fields: `nextPageToken,files(${FIELDS})`, supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (a.pageToken) p.set("pageToken", a.pageToken);
  if (a.orderBy) p.set("orderBy", a.orderBy.replace(/^modifiedTime$/, "modifiedTime desc"));
  const r = await (await gfetch(DRV + "?" + p)).json();
  return { files: (r.files || []).map(toConn), nextPageToken: r.nextPageToken };
}
function b64(buf) { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function downloadFile(a) {
  const meta = await (await gfetch(`${DRV}/${encodeURIComponent(a.fileId)}?fields=${FIELDS}&supportsAllDrives=true`)).json();
  let r;
  if (/^application\/vnd\.google-apps\./.test(meta.mimeType)) {
    const exp = /spreadsheet/.test(meta.mimeType) ? "text/csv" : /presentation|drawing/.test(meta.mimeType) ? "application/pdf" : "text/plain";
    r = await gfetch(`${DRV}/${encodeURIComponent(a.fileId)}/export?mimeType=${encodeURIComponent(exp)}`);
  } else r = await gfetch(`${DRV}/${encodeURIComponent(a.fileId)}?alt=media&supportsAllDrives=true`);
  return { ...toConn(meta), content: b64(await r.arrayBuffer()) };
}
async function createFile(a) {
  const meta = { name: a.title || "Unbenannt" };
  if (a.parentId) meta.parents = [a.parentId];
  if (a.mimeType) meta.mimeType = a.mimeType;
  if (!a.base64Content && !a.textContent) {
    /* ohne Inhalt: Ordner bzw. leere Google-Datei – der Typ steht bei Claude in contentMimeType */
    if (!meta.mimeType && a.contentMimeType) meta.mimeType = a.contentMimeType;
    return toConn(await (await gfetch(`${DRV}?fields=${FIELDS}&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) })).json());
  }
  const type = a.contentMimeType || "application/octet-stream";
  const bin = a.base64Content ? Uint8Array.from(atob(a.base64Content), c => c.charCodeAt(0)) : new TextEncoder().encode(a.textContent);
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  fd.append("file", new Blob([bin], { type }));
  return toConn(await (await gfetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, { method: "POST", body: fd })).json());
}
async function fileMeta(a) { return toConn(await (await gfetch(`${DRV}/${encodeURIComponent(a.fileId)}?fields=${FIELDS}&supportsAllDrives=true`)).json()); }

/* Große Dateien (Videos) direkt in Drive hochladen – fortsetzbarer Upload, kein Umweg über Text */
async function uploadBlob(blob, name, mime, parentId) {
  const meta = { name: name || "Unbenannt" }; if (parentId) meta.parents = [parentId];
  const type = mime || blob.type || "application/octet-stream";
  const init = await gfetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${FIELDS}&supportsAllDrives=true`, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(blob.size) }, body: JSON.stringify(meta) });
  const loc = init.headers.get("Location");
  if (!loc) { /* Upload-Ziel nicht lesbar: einteilig hochladen */ const fd = new FormData(); fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" })); fd.append("file", blob.type === type ? blob : new Blob([blob], { type })); return toConn(await (await gfetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, { method: "POST", body: fd })).json()); }
  const r = await fetch(loc, { method: "PUT", headers: { "Content-Type": type }, body: blob });
  if (!r.ok) throw Object.assign(new Error("Drive-Upload " + r.status), { code: "unavailable" });
  const f = toConn(await r.json());
  if (f.fileSize != null && String(f.fileSize) !== String(blob.size)) throw Object.assign(new Error("Drive-Upload unvollständig"), { code: "unavailable" });
  return f;
}
async function downloadBlob(id) { const r = await gfetch(`${DRV}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`); return await r.blob(); }
if (typeof window !== "undefined") window.__twDrive = { upload: uploadBlob, download: downloadBlob };

export const googleTools = {
  "Google Calendar/list_events": listEvents,
  "Google Calendar/create_event": createEvent,
  "Google Calendar/update_event": updateEvent,
  "Google Calendar/delete_event": deleteEvent,
  "Google Drive/search_files": searchFiles,
  "Google Drive/download_file_content": downloadFile,
  "Google Drive/create_file": createFile,
  "Google Drive/get_file_metadata": fileMeta
};
