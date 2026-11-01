package de.sfritz.vorlesen;

import android.accessibilityservice.AccessibilityService;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.ImageView;

import java.util.List;

/**
 * Bedienungshilfe: erkennt markierten Text in allen Apps und zeigt unten
 * rechts einen kleinen runden Knopf. Antippen = vorlesen, nochmal = stopp,
 * ziehen = verschieben, lange drücken = ausblenden.
 */
public class MarkierDienst extends AccessibilityService implements Sprecher.Hoerer {

    private static volatile boolean laeuft;
    public static boolean laeuft() { return laeuft; }

    private static final long AUTO_AUS_MS = 12000;

    private final Handler haupt = new Handler(Looper.getMainLooper());
    private final Runnable ausblenden = this::verstecken;
    private WindowManager wm;
    private ImageView blase;
    private WindowManager.LayoutParams lp;
    private boolean sichtbar;
    private String markiert = "";
    private int groesse;

    @Override
    protected void onServiceConnected() {
        laeuft = true;
        wm = getSystemService(WindowManager.class);
        groesse = dp(54);
        baueBlase();
        Sprecher.von(this).hoererDazu(this);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void baueBlase() {
        blase = new ImageView(this);
        blase.setImageResource(R.drawable.ic_lautsprecher);
        blase.setBackgroundResource(R.drawable.blase);
        blase.setScaleType(ImageView.ScaleType.CENTER);
        blase.setElevation(dp(6));
        blase.setContentDescription("Markierten Text vorlesen");
        int rand = dp(4); // Platz für den Schatten
        blase.setPadding(rand, rand, rand, rand);

        lp = new WindowManager.LayoutParams(groesse, groesse,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                android.graphics.PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;

        blase.setOnClickListener(v -> antippen());
        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        blase.setOnTouchListener(new View.OnTouchListener() {
            float startX, startY; int ausX, ausY; boolean gezogen, lang;
            final Runnable langDruck = () -> { lang = true; verstecken(true); };

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = e.getRawX(); startY = e.getRawY();
                        ausX = lp.x; ausY = lp.y; gezogen = false; lang = false;
                        blase.setAlpha(0.8f);
                        haupt.postDelayed(langDruck, 650);
                        haupt.removeCallbacks(ausblenden);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = e.getRawX() - startX, dy = e.getRawY() - startY;
                        if (!gezogen && Math.hypot(dx, dy) > slop) { gezogen = true; haupt.removeCallbacks(langDruck); }
                        if (gezogen && sichtbar) {
                            lp.x = ausX + (int) dx; lp.y = ausY + (int) dy;
                            wm.updateViewLayout(blase, lp);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        haupt.removeCallbacks(langDruck);
                        blase.setAlpha(1f);
                        if (!gezogen && !lang) v.performClick();
                        else { if (gezogen) positionMerken(); planeAusblenden(); }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        haupt.removeCallbacks(langDruck);
                        blase.setAlpha(1f);
                        return true;
                }
                return false;
            }
        });
    }

    private void antippen() {
        Sprecher s = Sprecher.von(this);
        if (s.spricht()) s.stopp();
        else s.sprich(markiert);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) return;
        AccessibilityNodeInfo knoten = e.getSource();
        if (e.isPassword() || (knoten != null && knoten.isPassword())) return;

        CharSequence voll = null;
        int von = e.getFromIndex(), bis = e.getToIndex();
        if (knoten != null && knoten.getText() != null) {
            voll = knoten.getText();
            int a = knoten.getTextSelectionStart(), b = knoten.getTextSelectionEnd();
            if (a >= 0 && b >= 0) { von = a; bis = b; }
        }
        if (voll == null) {
            List<CharSequence> t = e.getText();
            if (t != null && !t.isEmpty()) voll = t.get(0);
        }
        String auswahl = ausschnitt(voll, von, bis);
        if (auswahl.isEmpty()) {
            if (!Sprecher.von(this).spricht()) verstecken();
            return;
        }
        markiert = auswahl;
        zeigen();
    }

    static String ausschnitt(CharSequence voll, int von, int bis) {
        if (voll == null || von < 0 || bis < 0 || von == bis) return "";
        int a = Math.max(0, Math.min(von, bis)), b = Math.min(voll.length(), Math.max(von, bis));
        if (a >= b) return "";
        return voll.subSequence(a, b).toString().trim();
    }

    /** Immer an derselben Stelle: unten rechts in der Ecke (oder dort, wo man ihn hingezogen hat). */
    private void zeigen() {
        DisplayMetrics m = getResources().getDisplayMetrics();
        android.content.SharedPreferences p = Sprecher.prefs(this);
        int x = p.getInt("knopfX", m.widthPixels - groesse - dp(18));
        int y = p.getInt("knopfY", m.heightPixels - groesse - dp(110));
        lp.x = Math.max(0, Math.min(m.widthPixels - groesse, x));
        lp.y = Math.max(dp(24), Math.min(m.heightPixels - groesse - dp(24), y));
        try {
            if (sichtbar) wm.updateViewLayout(blase, lp);
            else { wm.addView(blase, lp); sichtbar = true; }
        } catch (RuntimeException ignored) { }
        sprichtGerade(Sprecher.von(this).spricht());
        planeAusblenden();
    }

    private void positionMerken() {
        Sprecher.prefs(this).edit().putInt("knopfX", lp.x).putInt("knopfY", lp.y).apply();
    }

    private void planeAusblenden() {
        haupt.removeCallbacks(ausblenden);
        if (!Sprecher.von(this).spricht()) haupt.postDelayed(ausblenden, AUTO_AUS_MS);
    }

    private void verstecken() { verstecken(false); }

    private void verstecken(boolean auchStopp) {
        haupt.removeCallbacks(ausblenden);
        if (auchStopp) Sprecher.von(this).stopp();
        if (sichtbar) {
            try { wm.removeView(blase); } catch (RuntimeException ignored) { }
            sichtbar = false;
        }
    }

    @Override
    public void sprichtGerade(boolean spricht) {
        if (blase == null) return;
        blase.setImageResource(spricht ? R.drawable.ic_stopp : R.drawable.ic_lautsprecher);
        blase.setContentDescription(spricht ? "Vorlesen stoppen" : "Markierten Text vorlesen");
        if (sichtbar) {
            haupt.removeCallbacks(ausblenden);
            if (!spricht) haupt.postDelayed(ausblenden, 4000);
        }
    }

    @Override
    public void onInterrupt() { Sprecher.von(this).stopp(); }

    @Override
    public void onDestroy() {
        laeuft = false;
        Sprecher.von(this).hoererWeg(this);
        verstecken();
        super.onDestroy();
    }
}
