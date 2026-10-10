package de.sfritz.lotto;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/** Ziehungs-Prüfung im Hintergrund + Benachrichtigung („Hat mein Tipp gewonnen?“). */
final class Lotto {
    static final String LIVE = "https://www.westlotto.de/wlinfo/WL_InfoService?client=jsn&gruppe=ZahlenUndQuoten&spielart=LOTTO";
    private static final int JOB_ID = 4649;
    private static final int MELDUNG_ID = 1;
    private static final String KANAL = "ziehungen";
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

    private Lotto() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("lotto", Context.MODE_PRIVATE);
    }

    // ---------- Ein/Aus ----------

    static boolean benachrichtigungenAn(Context c) {
        if (!prefs(c).getBoolean("benachrichtigen", false)) return false;
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    static void setBenachrichtigungen(Context c, boolean an) {
        prefs(c).edit().putBoolean("benachrichtigen", an).apply();
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (an) planen(c, js);
        else js.cancel(JOB_ID);
    }

    static void jobSicherstellen(Context c) {
        if (prefs(c).getBoolean("benachrichtigen", false)) planen(c, c.getSystemService(JobScheduler.class));
    }

    // Alle 30 Minuten (bei Netz) kurz nachsehen – ins Internet geht es nur, wenn
    // laut Kalender eine neue Ziehung fällig ist, die noch nicht gemeldet wurde.
    private static void planen(Context c, JobScheduler js) {
        if (js.getPendingJob(JOB_ID) != null) return;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(c, ZiehungsJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(TimeUnit.MINUTES.toMillis(30), TimeUnit.MINUTES.toMillis(10))
                .setPersisted(true)
                .build();
        js.schedule(info);
    }

    // Ziehungen, die die App schon kennt, nicht noch einmal melden
    static void merkeGemeldet(Context c, String datum) {
        if (datum == null || !datum.matches("\\d{4}-\\d{2}-\\d{2}")) return;
        SharedPreferences p = prefs(c);
        if (datum.compareTo(p.getString("gemeldet", "")) > 0) p.edit().putString("gemeldet", datum).apply();
    }

    // ---------- Prüfen ----------

    // Letzter Ziehungstag (Mi 18:25 / Sa 19:25), dessen Zahlen schon online sein sollten
    static String letzteFaelligeZiehung(ZonedDateTime jetzt) {
        for (int i = 0; i < 8; i++) {
            LocalDate d = jetzt.toLocalDate().minusDays(i);
            DayOfWeek wt = d.getDayOfWeek();
            if (wt != DayOfWeek.WEDNESDAY && wt != DayOfWeek.SATURDAY) continue;
            ZonedDateTime ziehung = d.atTime(wt == DayOfWeek.WEDNESDAY ? 18 : 19, 25).atZone(BERLIN);
            if (i > 0 || !jetzt.isBefore(ziehung.plusMinutes(20))) return d.toString();
        }
        return jetzt.toLocalDate().toString();
    }

    /** @param test true = letzte Ziehung sofort melden (Knopf „Test“), sonst nur neue */
    static void pruefe(Context c, boolean test) throws Exception {
        SharedPreferences p = prefs(c);
        if (!test && !p.getBoolean("benachrichtigen", false)) return;
        String gemeldet = p.getString("gemeldet", "");
        if (!test && gemeldet.compareTo(letzteFaelligeZiehung(ZonedDateTime.now(BERLIN))) >= 0) return;

        Ziehung z = Ziehung.aus(new JSONObject(holeText(LIVE)));
        if (z == null) return;
        if (!test) {
            if (z.datum.compareTo(gemeldet) <= 0) return; // noch nicht veröffentlicht
            p.edit().putString("gemeldet", z.datum).apply();
        }
        melde(c, z, p.getString("tipps", null));
    }

    private static String holeText(String url) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setUseCaches(false);
        try (InputStream in = con.getInputStream()) {
            if (con.getResponseCode() != 200) throw new Exception("HTTP " + con.getResponseCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            con.disconnect();
        }
    }

    // ---------- Auswertung der Tipps ----------

    /** Ein Tipp: 6 Zahlen + optionale Superzahl (-1 = keine). */
    static final class Tipp {
        final int[] zahlen;
        final int sz;

        Tipp(int[] zahlen, int sz) {
            this.zahlen = zahlen;
            this.sz = sz;
        }

        String text() {
            StringBuilder b = new StringBuilder();
            for (int n : zahlen) b.append(b.length() > 0 ? " " : "").append(n);
            return sz >= 0 ? b + " · SZ " + sz : b.toString();
        }
    }

    // {"tipp":{"nums":[…],"sz":4},"favoriten":[{"nums":[…],"sz":null}, …]} → Liste ohne Doppelte
    static List<Tipp> tipps(String json) {
        Map<String, Tipp> alle = new LinkedHashMap<>();
        if (json == null) return new ArrayList<>();
        try {
            JSONObject o = new JSONObject(json);
            List<JSONObject> roh = new ArrayList<>();
            if (o.optJSONObject("tipp") != null) roh.add(o.getJSONObject("tipp"));
            JSONArray fav = o.optJSONArray("favoriten");
            for (int i = 0; fav != null && i < fav.length(); i++) {
                if (fav.optJSONObject(i) != null) roh.add(fav.getJSONObject(i));
            }
            for (JSONObject t : roh) {
                JSONArray a = t.optJSONArray("nums");
                if (a == null || a.length() != 6) continue;
                Set<Integer> s = new LinkedHashSet<>();
                for (int i = 0; i < 6; i++) {
                    int n = a.optInt(i, 0);
                    if (n >= 1 && n <= 49) s.add(n);
                }
                if (s.size() != 6) continue;
                int[] z = s.stream().mapToInt(Integer::intValue).sorted().toArray();
                int sz = t.isNull("sz") ? -1 : t.optInt("sz", -1);
                if (sz < -1 || sz > 9) sz = -1;
                Tipp tipp = new Tipp(z, sz);
                alle.put(tipp.text(), tipp);
            }
        } catch (Exception ignored) {
        }
        return new ArrayList<>(alle.values());
    }

    // Gewinnklasse nach heutigem Schema: Kurzform wie bei WestLotto („3 + SZ“) oder null
    static String klasse(int richtige, boolean szTreffer) {
        if (richtige >= 3) return szTreffer ? richtige + " + SZ" : String.valueOf(richtige);
        if (richtige == 2 && szTreffer) return "2 + SZ";
        return null;
    }

    static String langtext(String kurz) {
        return kurz.replaceFirst("^(\\d)", "$1 Richtige").replace("+ SZ", "+ Superzahl");
    }

    // ---------- Benachrichtigung ----------

    private static void melde(Context c, Ziehung z, String tippsJson) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel kanal = new NotificationChannel(KANAL, c.getString(R.string.kanal_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        kanal.setDescription(c.getString(R.string.kanal_beschreibung));
        nm.createNotificationChannel(kanal);

        String[] text = meldungsText(z, tippsJson);

        Intent oeffnen = new Intent(c, MainActivity.class).putExtra("tab", "tipp")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 0, oeffnen,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new Notification.Builder(c, KANAL)
                .setSmallIcon(R.drawable.ic_stat_lotto)
                .setColor(0xFFC1623C)
                .setContentTitle(text[0])
                .setContentText(text[1])
                .setStyle(new Notification.BigTextStyle().bigText(text[2]))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        try {
            nm.notify(MELDUNG_ID, n);
        } catch (SecurityException ignored) {
            // Berechtigung inzwischen entzogen
        }
    }

    /** Titel, Kurztext und ausführlicher Text der Meldung (ohne Android-Abhängigkeiten → testbar). */
    static String[] meldungsText(Ziehung z, String tippsJson) {
        NumberFormat euro = NumberFormat.getCurrencyInstance(Locale.GERMANY);
        StringBuilder zahlen = new StringBuilder();
        for (int n : z.zahlen) zahlen.append(zahlen.length() > 0 ? " · " : "").append(n);
        if (z.sz >= 0) zahlen.append("   Superzahl ").append(z.sz);

        List<Tipp> tipps = tipps(tippsJson);
        String kurz;
        StringBuilder lang = new StringBuilder(zahlen);
        if (tipps.isEmpty()) {
            kurz = zahlen.toString();
            lang.append("\n\nTipp in der App deine Zahlen ein – dann steht hier, ob du gewonnen hast.");
        } else {
            String bester = null;
            double besteQuote = -1;
            Set<Integer> gezogen = new HashSet<>();
            for (int n : z.zahlen) gezogen.add(n);
            lang.append('\n');
            for (Tipp t : tipps) {
                int r = 0;
                for (int n : t.zahlen) if (gezogen.contains(n)) r++;
                String k = klasse(r, t.sz >= 0 && t.sz == z.sz);
                lang.append('\n').append(t.text()).append(" → ");
                if (k == null) {
                    lang.append(r).append(" Richtige, kein Gewinn");
                    continue;
                }
                Double q = z.quoten.get(k);
                String betrag = q != null && q > 0 ? euro.format(q) : "Quote folgt";
                lang.append(langtext(k)).append(" · ").append(betrag);
                double wert = q != null ? q : 0;
                if (bester == null || wert > besteQuote) {
                    bester = "🎉 Gewinn: " + langtext(k) + (q != null && q > 0 ? " · " + euro.format(q) : "");
                    besteQuote = wert;
                }
            }
            kurz = bester != null ? bester : (tipps.size() == 1 ? "Dein Tipp" : "Deine Tipps") + ": diesmal kein Gewinn";
        }
        return new String[]{"Lottozahlen vom " + datumText(z.datum), kurz, lang.toString()};
    }

    static String datumText(String iso) {
        LocalDate d = LocalDate.parse(iso);
        String[] wt = {"Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"};
        return wt[d.getDayOfWeek().getValue() - 1] + ", " + d.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"));
    }

    /** Eine Ziehung aus der WestLotto-Antwort. */
    static final class Ziehung {
        final String datum;
        final int[] zahlen;
        final int sz;
        final Map<String, Double> quoten;

        private Ziehung(String datum, int[] zahlen, int sz, Map<String, Double> quoten) {
            this.datum = datum;
            this.zahlen = zahlen;
            this.sz = sz;
            this.quoten = quoten;
        }

        static Ziehung aus(JSONObject j) {
            JSONObject head = j.optJSONObject("head");
            String datum = head != null ? head.optString("datum", "") : "";
            if (!datum.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
            JSONObject zahlen = j.optJSONObject("zahlen");
            JSONObject haupt = zahlen != null ? zahlen.optJSONObject("hauptlotterie") : null;
            JSONArray ziehungen = haupt != null ? haupt.optJSONArray("ziehungen") : null;
            JSONObject zg = ziehungen != null ? ziehungen.optJSONObject(0) : null;
            JSONArray sortiert = zg != null ? zg.optJSONArray("zahlenSortiert") : null;
            if (sortiert == null || sortiert.length() != 6) return null;
            int[] n = new int[6];
            for (int i = 0; i < 6; i++) {
                try {
                    n[i] = Integer.parseInt(sortiert.optString(i, "").trim());
                } catch (NumberFormatException e) {
                    return null;
                }
                if (n[i] < 1 || n[i] > 49) return null;
            }
            Arrays.sort(n);
            for (int i = 1; i < 6; i++) if (n[i] == n[i - 1]) return null;
            int sz = -1;
            try {
                sz = Integer.parseInt(zg.optString("superzahl", "").trim());
                if (sz < 0 || sz > 9) sz = -1;
            } catch (NumberFormatException ignored) {
            }

            Map<String, Double> quoten = new HashMap<>();
            try {
                JSONObject q = j.getJSONObject("auswertung").getJSONObject("quoten")
                        .getJSONObject("hauptlotterie").getJSONArray("ziehungen").getJSONObject(0);
                if (!"DM".equals(q.optString("waehrung"))) {
                    JSONArray kl = q.getJSONArray("gewinnklassen");
                    for (int i = 0; i < kl.length(); i++) {
                        JSONObject k = kl.getJSONObject(i);
                        quoten.put(k.optString("kurzbeschreibung").trim().replaceAll("\\s+", " "),
                                k.optDouble("quote", 0));
                    }
                }
            } catch (Exception ignored) {
                // Quoten stehen erst ein paar Stunden nach der Ziehung fest
            }
            return new Ziehung(datum, n, sz, quoten);
        }
    }
}
