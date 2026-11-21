/* Ersatz für die Claude-Verbindungen (mcp) in der eigenen Fassung von Prinzipal.
   Google Kalender und Drive direkt über Google, Todoist mit persönlichem Schlüssel.
   Antworten und Fehler haben dieselbe Form wie bei Claude: { payload, cache:{storedAt} } bzw. Error mit .code. */
import { googleTools, setGoogleHint, gfetch } from "/pz-google.js";
import { todoistTools } from "/pz-todoist.js";
const err = (code, message) => Object.assign(new Error(message || code), { code });

async function listCalendars() {
  let items = [], token = null, n = 0;
  do {
    const r = await (await gfetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250" + (token ? "&pageToken=" + encodeURIComponent(token) : ""))).json();
    items = items.concat(r.items || []); token = r.nextPageToken; n++;
  } while (token && n < 5);
  return { calendars: items.map(c => ({ id: c.id, summary: c.summaryOverride || c.summary, description: c.description, backgroundColor: c.backgroundColor, primary: !!c.primary, accessRole: c.accessRole, timeZone: c.timeZone })) };
}

export function mcpImpl(ctx) {
  if (ctx && ctx.user) setGoogleHint(ctx.user.email);
  const td = todoistTools({ fs: ctx.fs, uid: ctx.user.uid });
  const tools = { ...googleTools, "Google Calendar/list_calendars": listCalendars, ...td.tools };
  const watches = new Set();
  async function callTool(server, tool, args) {
    const f = tools[server + "/" + tool];
    if (!f) throw err("server_not_connected", `${server} ist in dieser Fassung nicht verbunden`);
    try { return { payload: await f(args || {}, ctx), cache: { storedAt: Date.now() } }; }
    catch (e) { if (!e.code) e.code = "tool_error"; throw e; }
  }
  function watchTool(server, tool, input, handler, opt) {
    const w = { server, tool, alive: true, timer: 0, busy: false };
    w.run = async () => {
      if (!w.alive || w.busy) return; w.busy = true;
      try { const result = await callTool(server, tool, input); if (w.alive) handler({ type: "data", result }); }
      catch (error) { if (w.alive) handler({ type: "error", error }); }
      w.busy = false;
    };
    const every = opt && opt.refetchInterval;
    if (every) w.timer = setInterval(() => { if (document.visibilityState === "visible") w.run(); }, Math.max(60000, every));
    watches.add(w); w.run();
    return () => { w.alive = false; clearInterval(w.timer); watches.delete(w); };
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") watches.forEach(w => w.run()); });
  return {
    async listTools() { return Object.keys(tools).map(k => { const [server, name] = k.split("/"); return { server, name }; }); },
    callTool, watchTool,
    async invalidate(server, tool) { watches.forEach(w => { if (w.server === server && (!tool || w.tool === tool)) w.run(); }); },
    async describeTool() { return null; },
    /* nur in der eigenen Fassung: Todoist-Schlüssel einmalig hinterlegen */
    todoist: { connect: () => td.connect(), connected: () => td.connected() }
  };
}
