package de.sfritz.vorlesen;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.List;

import org.junit.Test;

public class TextTest {

    @Test
    public void markierungWirdAusgeschnitten() {
        assertEquals("Welt", MarkierDienst.ausschnitt("Hallo Welt!", 6, 10));
        assertEquals("Welt", MarkierDienst.ausschnitt("Hallo Welt!", 10, 6)); // rückwärts markiert
        assertEquals("Hallo", MarkierDienst.ausschnitt("Hallo ", 0, 99));    // über das Ende hinaus
    }

    @Test
    public void leereMarkierungIstLeer() {
        assertEquals("", MarkierDienst.ausschnitt("Hallo", 2, 2));
        assertEquals("", MarkierDienst.ausschnitt("Hallo", -1, -1));
        assertEquals("", MarkierDienst.ausschnitt(null, 0, 3));
        assertEquals("", MarkierDienst.ausschnitt("a   b", 1, 4));
    }

    @Test
    public void kurzerTextBleibtEinStueck() {
        assertEquals(Arrays.asList("Erster Satz. Zweiter Satz!"),
                Sprecher.stuecke("Erster Satz.  Zweiter Satz!", 1000));
    }

    @Test
    public void langerTextWirdAnSatzgrenzenGeteilt() {
        List<String> s = Sprecher.stuecke("Eins zwei. Drei vier. Fünf sechs.", 12);
        assertEquals(Arrays.asList("Eins zwei.", "Drei vier.", "Fünf sechs."), s);
    }

    @Test
    public void ueberlangerSatzWirdAnLeerzeichenGeteilt() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 50; i++) b.append("wort ");
        for (String teil : Sprecher.stuecke(b.toString(), 40)) {
            assertEquals(true, teil.length() <= 40 && !teil.isEmpty());
        }
    }
}
