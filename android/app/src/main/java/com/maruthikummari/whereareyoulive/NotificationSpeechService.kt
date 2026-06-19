package com.maruthikummari.whereareyoulive

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.*

class NotificationSpeechService : Service(), TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var voiceMessage: String? = null
    private var language: String = "en"
    private val NOTIFICATION_ID = 9001
    private val CHANNEL_ID = "tts_speech_channel"

    override fun onCreate() {
        super.onCreate()
        Log.d("TTS", "[TTS SERVICE] onCreate")
        Log.e("FCM_DEBUG", "[TTS SERVICE] onCreate")
        
        // Acquire WakeLock to keep CPU alive during speech
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NavixGo::TTSSpeechWakeLock")
        wakeLock?.acquire(10 * 60 * 1000L /* 10 minutes max */)
        Log.d("TTS", "[TTS SERVICE] WakeLock acquired")
        Log.e("FCM_DEBUG", "[TTS SERVICE] WakeLock acquired")

        createNotificationChannel()

        // Call startForeground immediately in onCreate to satisfy Android requirements
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NavixGo Alert")
            .setContentText("Speaking alert...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID, 
                notification, 
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        Log.d("TTS", "[TTS SERVICE] startForeground called")
        Log.e("FCM_DEBUG", "[TTS SERVICE] startForeground called")
        Log.d("TTS", "[TTS SERVICE] Foreground Started")
        Log.e("FCM_DEBUG", "[TTS SERVICE] Foreground Started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d("TTS", "[TTS SERVICE] onStartCommand")
        Log.e("FCM_DEBUG", "[TTS SERVICE] onStartCommand")
        voiceMessage = intent?.getStringExtra("voiceMessage")
        language = intent?.getStringExtra("language") ?: "en"

        // Update foreground notification with actual voice message
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NavixGo Alert")
            .setContentText(voiceMessage ?: "Speaking alert...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, notification)

        // Initialize TextToSpeech
        Log.d("TTS", "[TTS SERVICE] Initializing TextToSpeech")
        Log.e("FCM_DEBUG", "[TTS SERVICE] Initializing TextToSpeech")
        tts = TextToSpeech(this, this)

        return START_NOT_STICKY
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            Log.d("TTS", "[TTS SERVICE] TTS initialized successfully")
            Log.e("FCM_DEBUG", "[TTS SERVICE] TTS initialized successfully")
            val ttsEngine = tts ?: return
            
            val messageToSpeak = voiceMessage
            if (messageToSpeak.isNullOrEmpty()) {
                Log.e("TTS", "[TTS] ERROR: voiceMessage is null or empty in onInit")
                Log.e("FCM_DEBUG", "[TTS] ERROR: voiceMessage is null or empty in onInit")
                stopSpeechService()
                return
            }

            // Set language based on AsyncStorage preferences
            val locale = when (language) {
                "te" -> Locale("te", "IN")
                "hi" -> Locale("hi", "IN")
                else -> Locale.US
            }

            val result = ttsEngine.setLanguage(locale)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.e("TTS", "[TTS] Language not supported or missing data: $language. Defaulting to English.")
                Log.e("FCM_DEBUG", "[TTS] Language not supported or missing data: $language. Defaulting to English.")
                ttsEngine.language = Locale.US
            }

            ttsEngine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    Log.d("TTS", "[TTS SERVICE] Utterance started")
                    Log.e("FCM_DEBUG", "[TTS SERVICE] Utterance started")
                }

                override fun onDone(utteranceId: String?) {
                    Log.d("TTS", "[TTS SERVICE] Utterance completed")
                    Log.e("FCM_DEBUG", "[TTS SERVICE] Utterance completed")
                    stopSpeechService()
                }

                override fun onError(utteranceId: String?) {
                    Log.e("TTS", "[TTS] ERROR: Speech failed")
                    Log.e("FCM_DEBUG", "[TTS] ERROR: Speech failed")
                    stopSpeechService()
                }
            })

            // Speak the message
            Log.d("TTS", "[TTS SERVICE] Speaking message")
            Log.e("FCM_DEBUG", "[TTS SERVICE] Speaking message")
            Log.d("TTS", "[TTS SERVICE] Speaking message: $messageToSpeak")
            Log.e("FCM_DEBUG", "[TTS SERVICE] Speaking message: $messageToSpeak")
            val params = android.os.Bundle()
            params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "NavixGoTTSUtterance")
            ttsEngine.speak(messageToSpeak, TextToSpeech.QUEUE_FLUSH, params, "NavixGoTTSUtterance")

        } else {
            Log.e("TTS", "[TTS] ERROR: TextToSpeech initialization failed")
            Log.e("FCM_DEBUG", "[TTS] ERROR: TextToSpeech initialization failed")
            stopSpeechService()
        }
    }

    private fun stopSpeechService() {
        Log.d("TTS", "[TTS SERVICE] stopSelf called")
        Log.e("FCM_DEBUG", "[TTS SERVICE] stopSelf called")
        stopSelf()
    }

    override fun onDestroy() {
        Log.d("TTS", "[TTS SERVICE] onDestroy")
        Log.e("FCM_DEBUG", "[TTS SERVICE] onDestroy")
        // Shutdown TTS
        tts?.stop()
        tts?.shutdown()
        Log.d("TTS", "[TTS] TTS Engine Shut Down")
        Log.e("FCM_DEBUG", "[TTS] TTS Engine Shut Down")

        // Release WakeLock
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
            Log.d("TTS", "[TTS SERVICE] WakeLock released")
            Log.e("FCM_DEBUG", "[TTS SERVICE] WakeLock released")
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "Voice Announcements Channel",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(serviceChannel)
        }
    }
}
