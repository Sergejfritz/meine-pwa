package de.sfritz.nahfunk

import android.app.Application
import de.sfritz.nahfunk.engine.Engine
import de.sfritz.nahfunk.service.Notifications

class NahfunkApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        Engine.init(this)
    }
}
