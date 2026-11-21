package de.musikologin.prinzipal;

import android.view.MotionEvent;

/**
 * S Pen: Seitentaste gedrückt = Radierer. Android meldet das im WebView nicht zuverlässig weiter,
 * deshalb wird der Stift für diesen Strich als Radierer-Spitze gemeldet (in der App: pointerType "pen", buttons 32).
 */
final class PenFix {
    private boolean erasing = false;
    /** Taste von außen bekannt (Schwebe-/Tastenereignis vor dem Aufsetzen) */
    boolean ext = false;
    static final int BTN = MotionEvent.BUTTON_STYLUS_PRIMARY | MotionEvent.BUTTON_STYLUS_SECONDARY | MotionEvent.BUTTON_SECONDARY;

    /** liefert ein umgebautes Ereignis oder null, wenn nichts zu ändern ist */
    MotionEvent fix(MotionEvent ev) {
        int act = ev.getActionMasked();
        boolean stylus = false;
        for (int i = 0; i < ev.getPointerCount(); i++) if (ev.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS) stylus = true;
        if (!stylus) { if (act == MotionEvent.ACTION_DOWN) erasing = false; return null; }
        boolean btn = (ev.getButtonState() & BTN) != 0;
        if (act == MotionEvent.ACTION_DOWN) erasing = btn || ext;
        boolean conv = erasing;
        if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) erasing = false;
        if (!conv) return null;
        int n = ev.getPointerCount();
        MotionEvent.PointerProperties[] pp = new MotionEvent.PointerProperties[n];
        MotionEvent.PointerCoords[] pc = new MotionEvent.PointerCoords[n];
        for (int i = 0; i < n; i++) {
            pp[i] = new MotionEvent.PointerProperties(); ev.getPointerProperties(i, pp[i]);
            if (pp[i].toolType == MotionEvent.TOOL_TYPE_STYLUS) pp[i].toolType = MotionEvent.TOOL_TYPE_ERASER;
            pc[i] = new MotionEvent.PointerCoords(); ev.getPointerCoords(i, pc[i]);
        }
        return MotionEvent.obtain(ev.getDownTime(), ev.getEventTime(), ev.getAction(), n, pp, pc, ev.getMetaState(),
            ev.getButtonState() & ~BTN, ev.getXPrecision(), ev.getYPrecision(), ev.getDeviceId(), ev.getEdgeFlags(), ev.getSource(), ev.getFlags());
    }
}
