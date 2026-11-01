package de.sfritz.vorlesen;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

/** „Vorlesen“ im Markier-Menü (⋮) bzw. Teilen-Menü jeder App. Unsichtbar. */
public class VorlesenActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent i = getIntent();
        CharSequence text = i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text == null) text = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null || text.toString().trim().isEmpty()) {
            Toast.makeText(this, "Kein Text zum Vorlesen.", Toast.LENGTH_SHORT).show();
        } else {
            SprechDienst.starte(this, text.toString());
        }
        finish();
    }
}
