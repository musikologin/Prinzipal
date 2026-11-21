package de.musikologin.prinzipal;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final PenFix penFix = new PenFix();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TwNativePlugin.class);
        super.onCreate(savedInstanceState);
        /* Inhalt nicht unter Statusleiste und Navigationsleiste legen */
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#333D4A"));
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(false);
        c.setAppearanceLightNavigationBars(false);
        View web = getBridge().getWebView();
        View host = (View) web.getParent();
        ViewCompat.setOnApplyWindowInsetsListener(host, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(host);
    }

    /* Knopf im Widget angetippt, während die App schon offen ist */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String p = intent != null ? intent.getStringExtra("pz") : null;
        if (p != null && p.matches("[a-z]+(:[A-Za-z0-9_-]+)?")) {
            intent.removeExtra("pz");
            js("window.__pzDo&&window.__pzDo('" + p + "')");
        }
    }

    private void js(String code) {
        try { getBridge().getWebView().post(() -> { try { getBridge().getWebView().evaluateJavascript(code, null); } catch (Exception e) {} }); } catch (Exception e) {}
    }

    /* S Pen: Seitentaste = Radierer (siehe PenFix) */
    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        MotionEvent f = penFix.fix(ev);
        if (f == null) return super.dispatchTouchEvent(ev);
        try { return super.dispatchTouchEvent(f); } finally { f.recycle(); }
    }
}
