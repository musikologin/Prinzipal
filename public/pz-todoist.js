/* Todoist für Prinzipal: Projekte, offene Aufgaben je Projekt, anlegen, abhaken.
   Der persönliche Todoist-Schlüssel liegt geschützt in der eigenen Datenbank (users/<uid>/pz_sys/todoist).
   Antworten haben dieselbe Form wie beim Todoist-Connector von Claude. */
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
const API = "https://api.todoist.com/api/v1";
const err = (code, message) => Object.assign(new Error(message || code), { code });

export function todoistTools({ fs, uid }) {
  let key = null, asking = null;
  const keyDoc = doc(fs, `users/${uid}/pz_sys/todoist`);
  async function getKey() {
    if (key) return key;
    try { const s = await getDoc(keyDoc); if (s.exists() && s.data().token) return (key = s.data().token); } catch (e) {}
    throw err("server_not_connected", "Todoist nicht verbunden");
  }
  /* Einmaliges Verbinden: Feld für den persönlichen Schlüssel */
  function connect() {
    if (asking) return asking;
    asking = new Promise(res => {
      const el = document.createElement("div"); el.id = "pz-td";
      el.innerHTML = `<style>#pz-td{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:20px;background:rgba(35,42,51,.55);font:15px/1.45 Inter,system-ui,sans-serif;color:#232a33}
        #pz-td form{background:#fff;border-radius:16px;padding:20px;max-width:440px;width:100%;display:grid;gap:12px;border-top:6px solid #db4c3f}
        #pz-td h2{margin:0;font:700 19px Inter,system-ui,sans-serif}#pz-td input{font:15px ui-monospace,monospace;padding:11px;border:1px solid #c9cdd8;border-radius:10px;width:100%;box-sizing:border-box}
        #pz-td .b{display:flex;gap:8px;justify-content:flex-end}#pz-td button{border:0;border-radius:10px;padding:10px 16px;font:600 15px Inter,system-ui,sans-serif}#pz-td .ok{background:#333d4a;color:#fff}#pz-td small{color:#5b6472}#pz-td .e{color:#a8261b}</style>
        <form><h2>Todoist verbinden</h2><p style="margin:0">Den persönlichen Schlüssel findest du in Todoist unter Einstellungen → Integrationen → Entwickler → „API-Token kopieren“.</p>
        <input name="t" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="API-Token einfügen" aria-label="Todoist-API-Token"><small class="e" hidden>Das sieht nicht wie ein Todoist-Token aus (40 Zeichen, Ziffern und a–f).</small>
        <small>Der Schlüssel wird nur in deiner eigenen Datenbank gespeichert.</small><div class="b"><button type="button" class="no">Abbrechen</button><button class="ok">Verbinden</button></div></form>`;
      document.body.appendChild(el);
      const done = v => { el.remove(); asking = null; res(v); };
      el.querySelector(".no").onclick = () => done(false);
      el.querySelector("form").onsubmit = async ev => {
        ev.preventDefault(); const t = el.querySelector("input").value.trim();
        if (!/^[0-9a-f]{40}$/i.test(t)) { el.querySelector(".e").hidden = false; return; }
        try { await setDoc(keyDoc, { token: t }); } catch (e) {}
        key = t; done(true);
      };
    });
    return asking;
  }
  async function call(method, path, body) {
    const k = await getKey();
    const r = await fetch(API + path, { method, headers: { Authorization: "Bearer " + k, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 || r.status === 403) { key = null; try { await setDoc(keyDoc, { token: "" }); } catch (e) {} throw err("needs_reauth", "Todoist-Schlüssel ungültig"); }
    if (r.status === 429) throw Object.assign(err("rate_limited", "Todoist drosselt gerade"), { retryable: true });
    if (!r.ok) throw err("tool_error", "Todoist " + r.status);
    return r.status === 204 ? null : r.json();
  }
  async function all(path) {
    let out = [], cursor = null, n = 0;
    do { const r = await call("GET", path + (path.includes("?") ? "&" : "?") + "limit=200" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")); out = out.concat(r.results || []); cursor = r.next_cursor; n++; } while (cursor && n < 25);
    return out;
  }
  const conv = t => ({
    id: t.id, content: t.content, description: t.description || "", projectId: t.project_id, sectionId: t.section_id, parentId: t.parent_id,
    labels: t.labels || [], priority: "p" + (5 - (t.priority || 1)), checked: !!t.checked,
    dueDate: t.due ? String(t.due.date || "").slice(0, 10) : undefined, recurring: !!(t.due && t.due.is_recurring),
    due: t.due ? { date: t.due.date, isRecurring: !!t.due.is_recurring, string: t.due.string } : null,
    deadlineDate: t.deadline ? t.deadline.date : undefined
  });
  return {
    connect, connected: async () => { try { await getKey(); return true; } catch (e) { return false; } },
    tools: {
      "Todoist/find-projects": async () => ({ projects: (await all("/projects")).filter(p => !p.is_archived).map(p => ({ id: p.id, name: p.name, color: p.color, isFavorite: !!p.is_favorite, parentId: p.parent_id, inboxProject: !!p.inbox_project })) }),
      "Todoist/find-tasks": async a => ({ tasks: (await all("/tasks" + (a.projectId ? "?project_id=" + encodeURIComponent(a.projectId) : a.labels && a.labels[0] ? "?label=" + encodeURIComponent(a.labels[0]) : ""))).map(conv) }),
      "Todoist/complete-tasks": async a => { const ids = a.ids || []; for (const id of ids) await call("POST", "/tasks/" + encodeURIComponent(id) + "/close"); return { completed: ids }; },
      "Todoist/add-tasks": async a => {
        const out = [];
        for (const t of a.tasks || []) {
          const b = { content: t.content };
          if (t.projectId) b.project_id = t.projectId; if (t.description) b.description = t.description;
          if (t.dueString) { b.due_string = t.dueString; b.due_lang = "de"; } else if (t.dueDate) b.due_date = t.dueDate;
          if (t.priority) b.priority = 5 - (+String(t.priority).replace("p", "") || 4);
          if (t.labels) b.labels = t.labels;
          out.push(conv(await call("POST", "/tasks", b)));
        }
        return { tasks: out };
      }
    }
  };
}
