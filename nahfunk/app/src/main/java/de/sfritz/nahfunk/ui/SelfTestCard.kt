package de.sfritz.nahfunk.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.sfritz.nahfunk.engine.SelfTestAction
import de.sfritz.nahfunk.engine.SelfTestItem
import de.sfritz.nahfunk.ui.theme.NfBlue
import de.sfritz.nahfunk.ui.theme.NfGreen
import de.sfritz.nahfunk.ui.theme.NfMuted
import de.sfritz.nahfunk.ui.theme.NfRed
import de.sfritz.nahfunk.ui.theme.NfText

@Composable
fun SelfTestCard(items: List<SelfTestItem>, onAction: (SelfTestAction) -> Unit) {
    NfCard {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (item in items) {
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                    val (mark, color) = when (item.ok) {
                        true -> "✓" to NfGreen
                        false -> "✗" to NfRed
                        null -> "–" to NfMuted
                    }
                    Text(mark, color = color, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(item.label, color = if (item.ok == false) NfText else NfMuted, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
                            if (item.action != null) {
                                Text(
                                    "→ ${item.action.label}",
                                    color = NfBlue,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .padding(start = 8.dp)
                                        .clickable { onAction(item.action) },
                                )
                            }
                        }
                        if (item.hint != null) {
                            Text(item.hint, color = NfMuted, fontSize = 13.sp, lineHeight = 18.sp)
                        }
                    }
                }
            }
        }
    }
}
