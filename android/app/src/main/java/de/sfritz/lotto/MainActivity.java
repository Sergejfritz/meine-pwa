package de.sfritz.lotto;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

/**
 * Lotto-Simulator als Android-App. Die Web-App (Ordner lotto/) steckt als Assets in
 * der APK und läuft offline in einer WebView; neue Ziehungen lädt sie selbst live.
 * Dazu: Systemleisten passend zum Hell/Dunkel-Modus, Zurück-Taste, Benachrichtigungen.
 */
public class MainActivity extends Activity {
    // Eigene https-Adresse für die Assets: so funktionieren ES-Module, fetch() und
    // localStorage wie im Browser (file:// würde all das blockieren).
    static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_BENACHRICHTIGUNG = 1;
    private static final int BG_HELL = 0xFFF4F1EA;
    private static final int BG_DUNKEL = 0xFF262320;

    private WebView web;
    private FrameLayout root;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = Lotto.prefs(this);

        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        String theme = prefs.getString("theme", null);
        randAnpassen();
        leisten(theme != null ? "dark".equals(theme) : systemDunkel());

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "LottoApp");
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        Lotto.jobSicherstellen(this);
        web.loadUrl(START + anker(getIntent()));
    }

    // Tipp auf eine Benachrichtigung öffnet direkt den passenden Bereich
    private static String anker(Intent i) {
        String tab = i != null ? i.getStringExtra("tab") : null;
        return tab != null && tab.matches("[a-z]+") ? "#" + tab : "";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String a = anker(intent);
        if (!a.isEmpty()) {
            web.evaluateJavascript("window.lottoZeigeTab && lottoZeigeTab('" + a.substring(1) + "')", null);
        }
    }

    private boolean systemDunkel() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    // Ab Android 11 zeichnet die App randlos; Statusleiste, Navigation und Tastatur
    // werden als Innenabstand freigehalten. Darunter übernimmt das System das.
    private void randAnpassen() {
        if (Build.VERSION.SDK_INT < 30) return;
        getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    // Hintergrund und Symbolfarbe der Systemleisten passend zum Theme der Seite
    @SuppressWarnings("deprecation")
    private void leisten(boolean dunkel) {
        int bg = dunkel ? BG_DUNKEL : BG_HELL;
        root.setBackgroundColor(bg);
        web.setBackgroundColor(bg);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            w.setNavigationBarContrastEnforced(false);
            WindowInsetsController c = w.getInsetsController();
            int hell = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (c != null) c.setSystemBarsAppearance(dunkel ? 0 : hell, hell);
        } else {
            w.setStatusBarColor(bg);
            w.setNavigationBarColor(bg);
        }
        // Auch die alten Flags setzen: Android 11 ignoriert sonst den Wechsel der
        // Statusleisten-Symbole, wenn das Theme sie anfangs auf „hell“ gestellt hat.
        View d = w.getDecorView();
        int hellAlt = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        int f = d.getSystemUiVisibility();
        d.setSystemUiVisibility(dunkel ? (f & ~hellAlt) : (f | hellAlt));
    }

    // Zurück: erst zum Bereich „Mein Tipp“, von dort aus die App schließen
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.lottoZurueck ? window.lottoZurueck() : false", ergebnis -> {
            if (!"true".equals(ergebnis)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] rechte, int[] ergebnis) {
        if (code != REQ_BENACHRICHTIGUNG) return;
        boolean ok = ergebnis.length > 0 && ergebnis[0] == PackageManager.PERMISSION_GRANTED;
        Lotto.setBenachrichtigungen(this, ok);
        statusAnSeite();
    }

    private void statusAnSeite() {
        web.evaluateJavascript("window.lottoAppStatus && lottoAppStatus()", null);
    }

    /** Liefert die Web-App aus den Assets; alles andere (Live-Daten) geht ins Netz. */
    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String pfad = u.getPath();
            if (pfad == null || pfad.equals("/")) pfad = "/index.html";
            try {
                InputStream in = getAssets().open(pfad.substring(1));
                WebResourceResponse res = new WebResourceResponse(mimeTyp(pfad), "UTF-8", in);
                res.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return res;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        Collections.emptyMap(), null);
            }
        }

        // Fremde Links (falls es welche gibt) im normalen Browser öffnen
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            if (HOST.equals(r.getUrl().getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl()));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }
    }

    private static String mimeTyp(String pfad) {
        if (pfad.endsWith(".html")) return "text/html";
        if (pfad.endsWith(".js")) return "text/javascript";
        if (pfad.endsWith(".css")) return "text/css";
        if (pfad.endsWith(".json")) return "application/json";
        if (pfad.endsWith(".png")) return "image/png";
        if (pfad.endsWith(".svg")) return "image/svg+xml";
        return "text/plain";
    }

    /** Schnittstelle für lotto.js (window.LottoApp). */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        // für die Update-Prüfung (Vergleich mit downloads/version.json)
        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public void theme(String t) {
            boolean dunkel = "dark".equals(t);
            prefs.edit().putString("theme", dunkel ? "dark" : "light").apply();
            runOnUiThread(() -> leisten(dunkel));
        }

        // aktueller Tipp + gemerkte Tipps (JSON) – für die Benachrichtigung nach der Ziehung
        @JavascriptInterface
        public void tipps(String json) {
            prefs.edit().putString("tipps", json).apply();
        }

        @JavascriptInterface
        public boolean benachrichtigungen() {
            return Lotto.benachrichtigungenAn(MainActivity.this);
        }

        @JavascriptInterface
        public void setBenachrichtigungen(boolean an, String letzteZiehung) {
            runOnUiThread(() -> {
                if (an) {
                    Lotto.merkeGemeldet(MainActivity.this, letzteZiehung);
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(
                            Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                                REQ_BENACHRICHTIGUNG);
                        return;
                    }
                }
                Lotto.setBenachrichtigungen(MainActivity.this, an);
                statusAnSeite();
            });
        }

        // zeigt sofort eine Benachrichtigung zur letzten Ziehung (zum Ausprobieren)
        @JavascriptInterface
        public void testBenachrichtigung() {
            new Thread(() -> {
                try {
                    Lotto.pruefe(getApplicationContext(), true);
                } catch (Exception ignored) {
                }
            }).start();
        }
    }
}
