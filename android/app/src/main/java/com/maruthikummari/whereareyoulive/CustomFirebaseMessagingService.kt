package com.maruthikummari.whereareyoulive

import android.app.ActivityManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

class CustomFirebaseMessagingService : ExpoFirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // Detailed logging as requested by audit guidelines
        Log.d("TTS", "[FIREBASE] onMessageReceived entered")
        Log.e("FCM_DEBUG", "[FIREBASE] onMessageReceived entered")
        Log.e("FCM_DEBUG", "[FCM_DEBUG] onMessageReceived called")
        
        Log.d("TTS", "[FIREBASE] Full remoteMessage: $remoteMessage")
        Log.e("FCM_DEBUG", "[FIREBASE] Full remoteMessage: $remoteMessage")
        Log.e("FCM_DEBUG", "[FCM_DEBUG] Full payload: $remoteMessage")
        
        Log.d("TTS", "[FIREBASE] Notification payload: ${remoteMessage.notification}")
        Log.e("FCM_DEBUG", "[FIREBASE] Notification payload: ${remoteMessage.notification}")

        val data = remoteMessage.data
        Log.d("TTS", "[FIREBASE] Data payload: $data")
        Log.e("FCM_DEBUG", "[FIREBASE] Data payload: $data")
        Log.e("FCM_DEBUG", "[FCM_DEBUG] Data payload: $data")
        Log.e("FCM_DEBUG", "data = $data")

        val voiceMessage = data["voiceMessage"]
        Log.d("TTS", "[FIREBASE] voiceMessage received: $voiceMessage")
        Log.e("FCM_DEBUG", "[FIREBASE] voiceMessage received: $voiceMessage")

        val type = data["type"] ?: ""
        val busId = data["busId"] ?: ""
        val tripId = data["tripId"] ?: ""
        val title = data["title"] ?: remoteMessage.notification?.title ?: "NavixGo"
        val body = data["body"] ?: data["message"] ?: remoteMessage.notification?.body ?: "New update available"
        val notificationId = data["notificationId"] ?: remoteMessage.messageId ?: System.currentTimeMillis().toString()
        val timestampStr = data["timestamp"] ?: ""
        val timestamp = timestampStr.toLongOrNull() ?: System.currentTimeMillis()

        // 1. Load preferences natively from local storage SQLite backing
        val prefs = getPreferences(this)
        val voiceEnabled = prefs.first
        val soundEnabled = prefs.second
        val vibrationEnabled = prefs.third
        val language = getLanguage(this)

        Log.d("TTS", "[TTS] voiceEnabled: $voiceEnabled, soundEnabled: $soundEnabled, vibrationEnabled: $vibrationEnabled, language: $language, type: $type")
        Log.e("FCM_DEBUG", "[TTS] voiceEnabled: $voiceEnabled, soundEnabled: $soundEnabled, vibrationEnabled: $vibrationEnabled, language: $language, type: $type")

        // Check for duplicate notifications to prevent spam
        if (DuplicateSpeechDetector.isDuplicate(notificationId, voiceMessage ?: body, timestamp)) {
            Log.d("TTS", "[TTS] Duplicate message ignored: $voiceMessage")
            Log.e("FCM_DEBUG", "[TTS] Duplicate message ignored: $voiceMessage")
            return
        }

        // 2. If app is in background or screen off, manually display the notification banner
        if (!isAppInForeground(this)) {
            Log.d("TTS", "[TTS] App is in background. Displaying native notification banner.")
            Log.e("FCM_DEBUG", "[TTS] App is in background. Displaying native notification banner.")
            showNotification(this, title, body, busId, tripId, type, notificationId, soundEnabled, vibrationEnabled)
        } else {
            Log.d("TTS", "[TTS] App is in foreground. Delegating banner display to React Native.")
            Log.e("FCM_DEBUG", "[TTS] App is in foreground. Delegating banner display to React Native.")
        }

        // 3. If voiceEnabled and voiceMessage is present, trigger TTS announcement natively
        if (voiceEnabled && !voiceMessage.isNullOrEmpty()) {
            Log.d("TTS", "[FIREBASE] Starting NotificationSpeechService")
            Log.e("FCM_DEBUG", "[FIREBASE] Starting NotificationSpeechService")
            val serviceIntent = Intent(this, NotificationSpeechService::class.java).apply {
                putExtra("voiceMessage", voiceMessage)
                putExtra("language", language)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } else {
            Log.d("TTS", "[TTS] Speech skipped. voiceEnabled: $voiceEnabled, voiceMessage is null/empty: ${voiceMessage.isNullOrEmpty()}")
            Log.e("FCM_DEBUG", "[TTS] Speech skipped. voiceEnabled: $voiceEnabled, voiceMessage is null/empty: ${voiceMessage.isNullOrEmpty()}")
        }

        // 4. Delegate to Expo's FirebaseMessagingService to ensure JS events are still fired in the foreground
        super.onMessageReceived(remoteMessage)
    }

    private fun isAppInForeground(context: Context): Boolean {
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val appProcesses = activityManager.runningAppProcesses ?: return false
        val packageName = context.packageName
        for (appProcess in appProcesses) {
            if (appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                appProcess.processName == packageName) {
                return true
            }
        }
        return false
    }

    private fun showNotification(
        context: Context,
        title: String,
        body: String,
        busId: String,
        tripId: String,
        type: String,
        notificationId: String,
        soundEnabled: Boolean,
        vibrationEnabled: Boolean
    ) {
        val channelId = if (soundEnabled) {
            if (vibrationEnabled) "default_sound_v1" else "sound_only_v1"
        } else {
            if (vibrationEnabled) "vibration_only_v1" else "silent_v1"
        }

        // Set up notification tap intent for deep linking
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("busId", busId)
            putExtra("tripId", tripId)
            putExtra("type", type)
        }
        
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId.hashCode(),
            intent,
            pendingIntentFlags
        )

        val notificationBuilder = NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // System default icon
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            
        if (soundEnabled) {
            notificationBuilder.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI)
        }
        if (vibrationEnabled) {
            notificationBuilder.setVibrate(longArrayOf(0, 250, 250, 250))
        }

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(notificationId.hashCode(), notificationBuilder.build())
    }

    private fun getPreferences(context: Context): Triple<Boolean, Boolean, Boolean> {
        var voiceEnabled = true
        var soundEnabled = true
        var vibrationEnabled = true
        var db: android.database.sqlite.SQLiteDatabase? = null
        try {
            val dbPath = context.getDatabasePath("RKStorage")
            if (dbPath.exists()) {
                db = android.database.sqlite.SQLiteDatabase.openDatabase(
                    dbPath.absolutePath,
                    null,
                    android.database.sqlite.SQLiteDatabase.OPEN_READONLY
                )
                val cursor = db.rawQuery(
                    "SELECT value FROM catalystLocalStorage WHERE key = ?",
                    arrayOf("@navixgo/notification_preferences")
                )
                if (cursor.moveToFirst()) {
                    val jsonStr = cursor.getString(0)
                    if (jsonStr != null) {
                        Log.d("TTS", "[TTS] Loaded preferences JSON: $jsonStr")
                        if (jsonStr.contains("\"voiceEnabled\":false")) {
                            voiceEnabled = false
                        }
                        if (jsonStr.contains("\"soundEnabled\":false")) {
                            soundEnabled = false
                        }
                        if (jsonStr.contains("\"vibrationEnabled\":false")) {
                            vibrationEnabled = false
                        }
                    }
                }
                cursor.close()
            }
        } catch (e: Exception) {
            Log.e("TTS", "[TTS] Error reading preferences from RKStorage: ${e.message}")
        } finally {
            db?.close()
        }
        return Triple(voiceEnabled, soundEnabled, vibrationEnabled)
    }

    private fun getLanguage(context: Context): String {
        var language = "en"
        var db: android.database.sqlite.SQLiteDatabase? = null
        try {
            val dbPath = context.getDatabasePath("RKStorage")
            if (dbPath.exists()) {
                db = android.database.sqlite.SQLiteDatabase.openDatabase(
                    dbPath.absolutePath,
                    null,
                    android.database.sqlite.SQLiteDatabase.OPEN_READONLY
                )
                val cursor = db.rawQuery(
                    "SELECT value FROM catalystLocalStorage WHERE key = ?",
                    arrayOf("@navixgo/notification_preferences")
                )
                if (cursor.moveToFirst()) {
                    val jsonStr = cursor.getString(0)
                    if (jsonStr != null) {
                        if (jsonStr.contains("\"language\":\"te\"")) {
                            language = "te"
                        } else if (jsonStr.contains("\"language\":\"hi\"")) {
                            language = "hi"
                        }
                    }
                }
                cursor.close()
            }
        } catch (e: Exception) {
            Log.e("TTS", "[TTS] Error reading language from RKStorage: ${e.message}")
        } finally {
            db?.close()
        }
        return language
    }
}

object DuplicateSpeechDetector {
    private val processedNotificationIds = HashSet<String>()
    private val lastSpokenMessages = HashMap<String, Long>()

    @Synchronized
    fun isDuplicate(notificationId: String?, message: String, timestamp: Long): Boolean {
        if (!notificationId.isNullOrEmpty()) {
            if (processedNotificationIds.contains(notificationId)) {
                return true
            }
            processedNotificationIds.add(notificationId)
        }
        
        val lastSpokenTime = lastSpokenMessages[message]
        if (lastSpokenTime != null && (timestamp - lastSpokenTime) < 5000) {
            return true
        }
        lastSpokenMessages[message] = timestamp
        return false
    }
}
