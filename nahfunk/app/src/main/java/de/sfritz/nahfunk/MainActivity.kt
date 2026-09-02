package de.sfritz.nahfunk

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import de.sfritz.nahfunk.engine.Engine
import de.sfritz.nahfunk.ui.NahfunkScreen
import de.sfritz.nahfunk.ui.theme.NahfunkTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        Engine.init(this)
        setContent {
            NahfunkTheme {
                NahfunkScreen()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        Engine.setAppVisible(true)
    }

    override fun onStop() {
        Engine.setAppVisible(false)
        super.onStop()
    }
}
