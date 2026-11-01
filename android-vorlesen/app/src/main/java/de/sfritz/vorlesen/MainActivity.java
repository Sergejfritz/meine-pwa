package de.sfritz.vorlesen;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.Voice;
import android.text.TextUtils;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity implements Sprecher.Hoerer {

    private TextView status, statusHilfe, gesperrt, tempoText, hoeheText;
    private Button einschalten, allesVorlesen;
    private EditText text;
    private Spinner stimme;
    private Sprecher sprecher;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    private List<Voice> stimmen = new ArrayList<>();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.haupt);
        sprecher = Sprecher.von(this);

        status = findViewById(R.id.status);
        statusHilfe = findViewById(R.id.statusHilfe);
        gesperrt = findViewById(R.id.gesperrt);
        einschalten = findViewById(R.id.einschalten);
        allesVorlesen = findViewById(R.id.allesVorlesen);
        text = findViewById(R.id.text);
        stimme = findViewById(R.id.stimme);
        tempoText = findViewById(R.id.tempoText);
        hoeheText = findViewById(R.id.hoeheText);

        einschalten.setOnClickListener(v -> {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            Toast.makeText(this, "„Vorlesen – runder Knopf“ auswählen und einschalten", Toast.LENGTH_LONG).show();
        });
        gesperrt.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName()))));

        allesVorlesen.setOnClickListener(v -> {
            if (sprecher.spricht()) { sprecher.stopp(); return; }
            int a = text.getSelectionStart(), e = text.getSelectionEnd();
            String t = text.getText().toString();
            if (a >= 0 && e > a) t = t.substring(a, e);
            sprecher.sprich(t);
        });
        findViewById(R.id.einfuegen).setOnClickListener(v -> {
            ClipboardManager cm = getSystemService(ClipboardManager.class);
            ClipData c = cm.getPrimaryClip();
            if (c == null || c.getItemCount() == 0 || c.getItemAt(0).coerceToText(this).length() == 0) {
                Toast.makeText(this, "Zwischenablage ist leer.", Toast.LENGTH_SHORT).show();
                return;
            }
            text.setText(c.getItemAt(0).coerceToText(this));
        });
        findViewById(R.id.stimmenInstallieren).setOnClickListener(v -> {
            try {
                startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
            } catch (RuntimeException ex) {
                startActivity(new Intent(android.speech.tts.TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
            }
        });

        SharedPreferences p = Sprecher.prefs(this);
        SeekBar tempo = findViewById(R.id.tempo), hoehe = findViewById(R.id.hoehe);
        tempo.setProgress(Math.round((p.getFloat("tempo", 1f) - 0.5f) * 10));
        hoehe.setProgress(Math.round((p.getFloat("hoehe", 1f) - 0.5f) * 10));
        zeigeWerte();
        SeekBar.OnSeekBarChangeListener l = new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int v, boolean user) {
                p.edit().putFloat(s == tempo ? "tempo" : "hoehe", 0.5f + v / 10f).apply();
                zeigeWerte();
            }
            @Override public void onStartTrackingTouch(SeekBar s) { }
            @Override public void onStopTrackingTouch(SeekBar s) { }
        };
        tempo.setOnSeekBarChangeListener(l);
        hoehe.setOnSeekBarChangeListener(l);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        ladeStimmen(0);
    }

    private void zeigeWerte() {
        SharedPreferences p = Sprecher.prefs(this);
        tempoText.setText(String.format(Locale.GERMANY, "Tempo: %.1f×", p.getFloat("tempo", 1f)));
        hoeheText.setText(String.format(Locale.GERMANY, "Tonhöhe: %.1f", p.getFloat("hoehe", 1f)));
    }

    /** Stimmen erst nach dem Start der Sprachausgabe verfügbar → kurz nachfragen. */
    private void ladeStimmen(int versuch) {
        if (!sprecher.istBereit()) {
            if (versuch < 20) haupt.postDelayed(() -> ladeStimmen(versuch + 1), 300);
            return;
        }
        stimmen = sprecher.deutscheStimmen();
        List<String> namen = new ArrayList<>();
        namen.add("Standard (Deutsch)");
        String gewaehlt = Sprecher.prefs(this).getString("stimme", "");
        int pos = 0;
        for (int i = 0; i < stimmen.size(); i++) {
            Voice v = stimmen.get(i);
            namen.add(v.getLocale().getDisplayCountry(Locale.GERMANY) + " · " + v.getName()
                    + (v.isNetworkConnectionRequired() ? " (online)" : ""));
            if (v.getName().equals(gewaehlt)) pos = i + 1;
        }
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, namen);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        stimme.setAdapter(a);
        stimme.setSelection(pos, false);
        stimme.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> av, View v, int i, long id) {
                Sprecher.prefs(MainActivity.this).edit()
                        .putString("stimme", i == 0 ? "" : stimmen.get(i - 1).getName()).apply();
            }
            @Override public void onNothingSelected(AdapterView<?> av) { }
        });
    }

    private boolean dienstAn() {
        if (MarkierDienst.laeuft()) return true;
        String an = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (an == null) return false;
        ComponentName ich = new ComponentName(this, MarkierDienst.class);
        TextUtils.SimpleStringSplitter s = new TextUtils.SimpleStringSplitter(':');
        s.setString(an);
        for (String eintrag : s) {
            ComponentName c = ComponentName.unflattenFromString(eintrag);
            if (ich.equals(c)) return true;
        }
        return false;
    }

    @Override
    protected void onResume() {
        super.onResume();
        sprecher.hoererDazu(this);
        sprichtGerade(sprecher.spricht());
        boolean an = dienstAn();
        status.setText(an ? "✅ Runder Knopf ist an" : "⚪ Runder Knopf ist aus");
        statusHilfe.setText(an
                ? "Markiere jetzt in irgendeiner App Text – der Knopf erscheint neben der Markierung. Ziehen = verschieben, lange drücken = ausblenden."
                : "Einmalig einschalten: „Knopf einschalten“ → „Installierte Apps“ / „Heruntergeladene Apps“ → „Vorlesen – runder Knopf“ → An.");
        einschalten.setText(an ? "Einstellungen öffnen" : "Knopf einschalten");
        gesperrt.setVisibility(an ? View.GONE : View.VISIBLE);
    }

    @Override
    protected void onPause() {
        sprecher.hoererWeg(this);
        super.onPause();
    }

    @Override
    public void sprichtGerade(boolean spricht) {
        allesVorlesen.setText(spricht ? "■ Stopp" : "▶ Vorlesen");
    }
}
