/* Erkennt, ob das Journal in der Android-App läuft, und stellt die nativen Helfer bereit.
   Bewusst ohne @capacitor/core: Aufrufe gehen direkt über die Brücke, die die App einblendet. */
const C = window.Capacitor;
export const isNative = !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : C.platform === "android"));
function call(method, opts) {
  const o = opts || {};
  if (typeof C.nativePromise === "function") return C.nativePromise("TwNative", method, o);
  const P = C.Plugins && C.Plugins.TwNative;
  if (P && typeof P[method] === "function") return P[method](o);
  if (typeof C.registerPlugin === "function") return C.registerPlugin("TwNative")[method](o);
  return Promise.reject(Object.assign(new Error("Android-Brücke fehlt"), { code: "NO_BRIDGE" }));
}
export const TwNative = isNative ? new Proxy({}, { get: (_, m) => o => call(String(m), o) }) : null;
/* für den App-Code (Kurzansicht, Widget): nur in der Android-App vorhanden */
if (isNative) window.__twNat = TwNative;
