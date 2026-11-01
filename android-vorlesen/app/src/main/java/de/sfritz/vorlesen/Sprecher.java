package de.sfritz.vorlesen;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;

/** Eine gemeinsame Sprachausgabe für Knopf, Menü-Eintrag und App. */
public final class Sprecher implements TextToSpeech.OnInitListener {

    public interface Hoerer { void sprichtGerade(boolean spricht); }

    private static final String ENDE = "#ende";
    private static Sprecher instanz;

    public static synchronized Sprecher von(Context c) {
        if (instanz == null) instanz = new Sprecher(c.getApplicationContext());
        return instanz;
    }

    private final Context ctx;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    private final List<Hoerer> hoerer = new CopyOnWriteArrayList<>();
    private final TextToSpeech tts;
    private boolean bereit;
    private String wartend;
    private boolean spricht;
    private int lauf; // verwirft Ende-Meldungen alter Vorlesungen

    private Sprecher(Context c) {
        ctx = c;
        tts = new TextToSpeech(c, this);
    }

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("vorlesen", Context.MODE_PRIVATE);
    }

    @Override
    public void onInit(int status) {
        haupt.post(() -> {
            if (status != TextToSpeech.SUCCESS) {
                Toast.makeText(ctx, "Sprachausgabe nicht verfügbar – bitte in den Android-Einstellungen eine Sprachausgabe einrichten.", Toast.LENGTH_LONG).show();
                wartend = null;
                setze(false);
                return;
            }
            bereit = true;
            stimmeAnwenden();
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { if (id.endsWith(ENDE)) fertig(id); }
                @Override public void onError(String id) { fertig(id); }
                @Override public void onError(String id, int code) { fertig(id); }
            });
            if (wartend != null) { String t = wartend; wartend = null; sprich(t); }
        });
    }

    private void fertig(String id) {
        haupt.post(() -> { if (id.startsWith(lauf + "_")) setze(false); });
    }

    private void stimmeAnwenden() {
        String name = prefs(ctx).getString("stimme", "");
        if (!name.isEmpty()) {
            for (Voice v : sichereStimmen()) {
                if (v.getName().equals(name)) { tts.setVoice(v); return; }
            }
        }
        int r = tts.setLanguage(Locale.GERMANY);
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            Toast.makeText(ctx, "Keine deutsche Stimme installiert – in der App unter „Stimmen“ nachinstallieren.", Toast.LENGTH_LONG).show();
        }
    }

    private List<Voice> sichereStimmen() {
        try {
            return tts.getVoices() == null ? new ArrayList<>() : new ArrayList<>(tts.getVoices());
        } catch (RuntimeException e) {
            return new ArrayList<>();
        }
    }

    /** Deutsche Stimmen (offline zuerst), für die Auswahl in der App. */
    public List<Voice> deutscheStimmen() {
        List<Voice> out = new ArrayList<>();
        if (!bereit) return out;
        for (Voice v : sichereStimmen()) {
            if ("de".equals(v.getLocale().getLanguage())) out.add(v);
        }
        out.sort((a, b) -> {
            int na = a.isNetworkConnectionRequired() ? 1 : 0, nb = b.isNetworkConnectionRequired() ? 1 : 0;
            return na != nb ? na - nb : a.getName().compareTo(b.getName());
        });
        return out;
    }

    public boolean istBereit() { return bereit; }
    public boolean spricht() { return spricht; }

    public void hoererDazu(Hoerer h) { if (!hoerer.contains(h)) hoerer.add(h); }
    public void hoererWeg(Hoerer h) { hoerer.remove(h); }

    public void sprich(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (!bereit) { wartend = text; setze(true); return; }
        SharedPreferences p = prefs(ctx);
        stimmeAnwenden();
        tts.setSpeechRate(p.getFloat("tempo", 1f));
        tts.setPitch(p.getFloat("hoehe", 1f));
        tts.stop();
        lauf++;
        List<String> teile = stuecke(text, Math.min(1000, TextToSpeech.getMaxSpeechInputLength()));
        for (int i = 0; i < teile.size(); i++) {
            String id = lauf + "_" + i + (i == teile.size() - 1 ? ENDE : "");
            tts.speak(teile.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, new Bundle(), id);
        }
        setze(!teile.isEmpty());
    }

    public void stopp() {
        wartend = null;
        lauf++;
        if (bereit) tts.stop();
        setze(false);
    }

    private void setze(boolean an) {
        spricht = an;
        for (Hoerer h : hoerer) h.sprichtGerade(an);
    }

    /** Text in Sätze bzw. Stücke unter der Maximallänge der Sprachausgabe teilen. */
    static List<String> stuecke(String text, int max) {
        List<String> out = new ArrayList<>();
        StringBuilder akt = new StringBuilder();
        for (String satz : text.trim().split("(?<=[.!?;:])\\s+|\\n+")) {
            String s = satz.trim();
            if (s.isEmpty()) continue;
            while (s.length() > max) {
                int schnitt = s.lastIndexOf(' ', max);
                if (schnitt < max / 3) schnitt = max;
                if (akt.length() > 0) { out.add(akt.toString()); akt.setLength(0); }
                out.add(s.substring(0, schnitt).trim());
                s = s.substring(schnitt).trim();
            }
            if (akt.length() + s.length() + 1 > max && akt.length() > 0) { out.add(akt.toString()); akt.setLength(0); }
            if (akt.length() > 0) akt.append(' ');
            akt.append(s);
        }
        if (akt.length() > 0) out.add(akt.toString());
        return out;
    }
}
