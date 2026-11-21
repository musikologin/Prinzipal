package de.musikologin.prinzipal;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Widget mit vier Reitern: Übersicht, Geburtstage, Zeit (Arbeitszeit), Schnell (Ablage).
 * Die Inhalte legt die App über TwNative.setWidget ab; das Widget zeigt den letzten Stand
 * und öffnet beim Antippen die App an der passenden Stelle (Extra "pz").
 */
public class PzWidget extends AppWidgetProvider {
    static final String TAB = "de.musikologin.prinzipal.TAB";
    static final int[] TABS = { R.id.tab0, R.id.tab1, R.id.tab2, R.id.tab3 };
    static final int[] LINES = { R.id.l0, R.id.l1, R.id.l2, R.id.l3, R.id.l4 };
    static final int[] BTNS = { R.id.b0, R.id.b1, R.id.b2, R.id.b3, R.id.b4, R.id.b5 };

    static void updateAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        for (int id : m.getAppWidgetIds(new ComponentName(ctx, PzWidget.class))) render(ctx, m, id);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (TAB.equals(intent.getAction())) {
            int id = intent.getIntExtra("id", 0), tab = intent.getIntExtra("tab", 0);
            ctx.getSharedPreferences("pz", Context.MODE_PRIVATE).edit().putInt("tab_" + id, tab).apply();
            render(ctx, AppWidgetManager.getInstance(ctx), id);
            return;
        }
        super.onReceive(ctx, intent);
    }

    private static PendingIntent open(Context ctx, int id, String action) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("pz." + action);
        i.putExtra("pz", action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, (id + ":" + action).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void btn(Context ctx, RemoteViews v, int id, int n, String text, String action, int bg) {
        v.setViewVisibility(BTNS[n], View.VISIBLE);
        v.setTextViewText(BTNS[n], text);
        v.setInt(BTNS[n], "setBackgroundResource", bg);
        v.setOnClickPendingIntent(BTNS[n], open(ctx, id, action));
    }

    static void render(Context ctx, AppWidgetManager m, int id) {
        SharedPreferences sp = ctx.getSharedPreferences("pz", Context.MODE_PRIVATE);
        int tab = sp.getInt("tab_" + id, 0);
        JSONObject d;
        try { d = new JSONObject(sp.getString("data", "{}")); } catch (Exception e) { d = new JSONObject(); }
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_pz);
        for (int t = 0; t < TABS.length; t++) {
            v.setInt(TABS[t], "setBackgroundResource", t == tab ? R.drawable.pzw_tab_on : R.drawable.pzw_tab_off);
            v.setTextColor(TABS[t], t == tab ? 0xFF232A33 : 0xFFF4F2EE);
            Intent ti = new Intent(ctx, PzWidget.class).setAction(TAB).putExtra("id", id).putExtra("tab", t);
            v.setOnClickPendingIntent(TABS[t], PendingIntent.getBroadcast(ctx, id * 10 + t, ti, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        for (int l : LINES) { v.setViewVisibility(l, View.GONE); v.setTextViewText(l, ""); }
        for (int b : BTNS) v.setViewVisibility(b, View.GONE);
        v.setViewVisibility(R.id.row1, View.GONE);
        v.setViewVisibility(R.id.row2, View.GONE);
        long at = sp.getLong("at", 0);
        String stand = at > 0 ? "Stand " + new SimpleDateFormat("EEE HH:mm", Locale.GERMANY).format(new Date(at)) : "App einmal öffnen, dann füllt sich das Widget";
        String head = stand;
        int n = 0;
        try {
            if (tab == 0) {
                JSONArray ev = d.optJSONArray("ev");
                StringBuilder k = new StringBuilder();
                JSONArray kp = d.optJSONArray("kpi");
                for (int i = 0; kp != null && i < kp.length() && i < 3; i++) { JSONObject o = kp.getJSONObject(i); if (k.length() > 0) k.append("  ·  "); k.append(o.optInt("n")).append(" ").append(o.optString("l")); }
                if (k.length() > 0) head = k.toString();
                for (int i = 0; ev != null && i < ev.length() && n < LINES.length; i++, n++) { JSONObject o = ev.getJSONObject(i); line(v, n, (o.optString("t").trim() + "  " + o.optString("s")).trim()); }
                if (n == 0) line(v, n++, at > 0 ? "Keine Termine in den nächsten Tagen" : "Noch keine Daten");
                v.setOnClickPendingIntent(R.id.body, open(ctx, id, "go:sensoren"));
            } else if (tab == 1) {
                JSONArray g = d.optJSONArray("geb");
                head = "Geburtstage in den nächsten 30 Tagen";
                for (int i = 0; g != null && i < g.length() && n < LINES.length; i++, n++) { JSONObject o = g.getJSONObject(i); String a = o.optString("a"); line(v, n, o.optString("d") + "  " + o.optString("n") + (a.length() > 0 && !"0".equals(a) ? " (" + a + ")" : "")); }
                if (n == 0) line(v, n++, "Keine Geburtstage eingetragen");
                v.setOnClickPendingIntent(R.id.body, open(ctx, id, "go:crew"));
            } else if (tab == 2) {
                JSONObject z = d.optJSONObject("zeit");
                JSONObject run = z != null ? z.optJSONObject("run") : null;
                head = "Heute erfasst: " + (z != null ? z.optString("heute", "0:00") : "0:00") + " h";
                v.setViewVisibility(R.id.row1, View.VISIBLE);
                if (run != null) {
                    line(v, n++, run.optString("name") + " läuft seit " + new SimpleDateFormat("HH:mm", Locale.GERMANY).format(new Date(run.optLong("ts"))) + " Uhr");
                    btn(ctx, v, id, 0, "Stopp", "zstop", R.drawable.pzw_btn_r);
                    btn(ctx, v, id, 1, "Übersicht", "go:zeit", R.drawable.pzw_btn);
                } else {
                    line(v, n++, "Antippen startet die Uhr:");
                    JSONArray f = z != null ? z.optJSONArray("fav") : null;
                    int[] bg = { R.drawable.pzw_btn, R.drawable.pzw_btn_b, R.drawable.pzw_btn_y };
                    int c = 0;
                    for (int i = 0; f != null && i < f.length() && c < 6; i++, c++) { JSONObject o = f.getJSONObject(i); btn(ctx, v, id, c, o.optString("n"), "zeit:" + o.optString("k"), bg[c % 3]); }
                    if (c == 0) btn(ctx, v, id, 0, "Arbeitszeit öffnen", "go:zeit", R.drawable.pzw_btn);
                    if (c > 3) v.setViewVisibility(R.id.row2, View.VISIBLE);
                }
                v.setOnClickPendingIntent(R.id.body, open(ctx, id, "go:zeit"));
            } else {
                head = "Schnell ablegen";
                line(v, n++, "Notiz, Scan oder Link landen in der Ablage.");
                v.setViewVisibility(R.id.row1, View.VISIBLE);
                v.setViewVisibility(R.id.row2, View.VISIBLE);
                btn(ctx, v, id, 0, "Notiz", "q:notiz", R.drawable.pzw_btn_y);
                btn(ctx, v, id, 1, "Scan / Foto", "q:scan", R.drawable.pzw_btn_b);
                btn(ctx, v, id, 2, "Link", "q:link", R.drawable.pzw_btn);
                btn(ctx, v, id, 3, "Aufgabe", "q:aufgabe", R.drawable.pzw_btn);
                btn(ctx, v, id, 4, "Termin", "q:termin", R.drawable.pzw_btn_b);
                btn(ctx, v, id, 5, "Öffnen", "go:bruecke", R.drawable.pzw_btn_y);
                v.setOnClickPendingIntent(R.id.body, open(ctx, id, "go:ablage"));
            }
        } catch (Exception e) {
            line(v, 0, "Widget-Daten nicht lesbar");
        }
        v.setTextViewText(R.id.head, head);
        m.updateAppWidget(id, v);
    }

    private static void line(RemoteViews v, int n, String text) {
        if (n < 0 || n >= LINES.length) return;
        v.setViewVisibility(LINES[n], View.VISIBLE);
        v.setTextViewText(LINES[n], text);
    }
}
