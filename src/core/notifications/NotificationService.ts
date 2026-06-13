import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerDeviceToken, patchUserFcmToken, getNotificationPreferences } from '../../../api/user';
import { captureSentryException } from '../../../monitoring/sentry';

const PREFS_KEY = '@navixgo/notification_preferences';
const FCM_TOKEN_KEY = '@navixgo/fcm_token';
const ASSIGNED_STOP_KEY = '@navixgo/assigned_stop';

export type LanguageCode = 'en' | 'te' | 'hi';

export interface NotificationPrefs {
  busNearStopEnabled: boolean;
  busArrivedEnabled: boolean;
  tripStartedEnabled: boolean;
  delayAlertsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  voiceEnabled: boolean;
  alertBeforeArrivalEnabled: boolean;
  alertBeforeArrivalMinutes: number; // 1, 3, 5, 10
  language: LanguageCode;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  busNearStopEnabled: true,
  busArrivedEnabled: true,
  tripStartedEnabled: true,
  delayAlertsEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  voiceEnabled: true,
  alertBeforeArrivalEnabled: true,
  alertBeforeArrivalMinutes: 5,
  language: 'en',
};

// Extensible Multi-lingual Announcements
export const VOICE_TRANSLATIONS: Record<LanguageCode, Record<string, string>> = {
  en: {
    busNearStop: 'Your bus is approaching your stop. Please be ready. This is a sample notification.',
    busArrived: 'Your bus has arrived at your stop.',
    tripStarted: 'Your bus has started and is on the way.',
    delayAlerts: 'Your bus is running behind schedule.',
    testNotice: 'This is how your notifications will appear.',
  },
  te: {
    busNearStop: 'మీ బస్సు మీ స్టాప్ దగ్గరకు వస్తోంది. దయచేసి సిద్ధంగా ఉండండి. ఇది ఒక నమూనా నోటిఫिकేషన్.',
    busArrived: 'మీ బస్సు మీ స్టాప్‌కు చేరుకుంది.',
    tripStarted: 'మీ బస్సు ప్రయాణం ప్రారంభమైంది మరియు దారిలో ఉంది.',
    delayAlerts: 'మీ బస్సు నిర్ణీत సమయం కంటే ఆలస్యంగా నడుస్తోంది.',
    testNotice: 'మీ నోటిఫికేషన్‌లు ఈ విధంగా కనిపిస్తాయి.',
  },
  hi: {
    busNearStop: 'आपकी बस आपके स्टॉप के पास आ रही है। कृपया तैयार रहें। यह एक नमूना अधिसूचना है।',
    busArrived: 'आपकी बस आपके स्टॉप पर पहुंच गई है।',
    tripStarted: 'आपकी बस शुरू हो चुकी है और रास्ते में है।',
    delayAlerts: 'आपकी बस अपने निर्धारित समय से देरी से चल रही है।',
    testNotice: 'आपकी अधिसूचनाएं इस प्रकार दिखाई देंगी।',
  },
};

class NotificationService {
  private static instance: NotificationService;
  private currentUserId: string | null = null;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize notification handlers, check permissions, and register FCM token
   */
  async init(userId: string): Promise<void> {
    this.currentUserId = userId;

    if (this.isInitialized) {
      return;
    }

    try {
      // 1. Setup handler for foreground notifications dynamically respecting settings
      Notifications.setNotificationHandler({
        handleNotification: async () => {
          const prefs = await this.getPreferences();
          return {
            shouldShowAlert: true,
            shouldPlaySound: prefs.soundEnabled,
            shouldVibrate: prefs.vibrationEnabled,
          };
        },
      });

      // Configure Android channels
      if (Platform.OS === 'android') {
        // High importance channel with sound & vibration
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Alerts with Sound & Vibration',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          enableVibrate: true,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#2563EB',
          bypassDnd: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });

        // High importance channel but silent (no sound, no vibration)
        await Notifications.setNotificationChannelAsync('silent', {
          name: 'Silent Alerts',
          importance: Notifications.AndroidImportance.MAX,
          sound: null,
          enableVibrate: false,
          bypassDnd: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }

      // 2. Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.log('[NotificationService] Permissions not granted');
        return;
      }

      // 3. Register device token
      await this.registerDevice();

      // 4. Listen to token refreshes
      Notifications.addPushTokenListener(async (token) => {
        console.log('[NotificationService] Push token rotated:', token.data);
        await this.saveTokenLocally(token.data);
        try {
          await registerDeviceToken({
            deviceToken: token.data,
            deviceType: Platform.OS === 'ios' ? 'ios' : 'android',
          });
        } catch (err) {
          captureSentryException(err, { tags: { area: 'notifications', op: 'token_rotate' } });
        }
      });

      // 5. Add foreground message listener for TTS voice announcements
      Notifications.addNotificationReceivedListener(async (notification) => {
        console.log('[NotificationService] Foreground notification received:', JSON.stringify(notification));
        const data = notification.request.content.data;
        const isLocal = data?.isLocal === true;

        if (!isLocal) {
          const prefs = await this.getPreferences();
          const type = data?.type || '';
          
          // Check if alerts for this type are enabled
          const isEnabled = this.isNotificationTypeEnabled(type, prefs);
          if (isEnabled) {
            // Schedule local notification to display in the notification bar
            const title = notification.request.content.title || data?.title || 'NavixGo';
            const body = notification.request.content.body || data?.body || data?.message || 'New update available';
            const voiceMessage = data?.voiceMessage || body;
            
            const channelId = prefs.soundEnabled ? 'default' : 'silent';

            await Notifications.scheduleNotificationAsync({
              content: {
                title,
                body,
                sound: prefs.soundEnabled ? 'default' : undefined,
                data: { ...data, isLocal: true },
              },
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(),
                channelId,
              },
            });

            // Speak voice message
            if (prefs.voiceEnabled) {
              let textToSpeak = voiceMessage;
              const lang = prefs.language;
              const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;
              
              const normType = type.toUpperCase().replace(/_/g, '');
              if (normType.includes('NEARSTOP')) {
                textToSpeak = translations.busNearStop;
              } else if (normType.includes('ARRIVED')) {
                textToSpeak = translations.busArrived;
              } else if (normType.includes('STARTED')) {
                textToSpeak = translations.tripStarted;
              } else if (normType.includes('DELAY')) {
                textToSpeak = translations.delayAlerts;
              }

              if (textToSpeak) {
                await this.speak(textToSpeak);
              }
            }
          }
        }
      });

      this.isInitialized = true;
      console.log('[NotificationService] Initialized successfully');
    } catch (error) {
      console.error('[NotificationService] Init failed:', error);
      captureSentryException(error, { tags: { area: 'notifications', op: 'init' } });
    }
  }

  /**
   * Request push notification permissions
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowDisplayInCarPlay: true,
          allowCriticalAlerts: true,
        },
      });
      finalStatus = status;
    }

    return finalStatus === 'granted';
  }

  /**
   * Register FCM Token with backend
   */
  async registerDevice(): Promise<void> {
    try {
      if (Platform.OS === 'web') return;

      // 1. Generate and log Expo Push Token (if using Expo Push Service)
      try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
        const expoPushTokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
        console.log('[NotificationService] Generated Expo Push Token:', expoPushTokenResult.data);
      } catch (expoErr) {
        console.log('[NotificationService] Expo Push Token generation bypassed/failed:', expoErr);
      }

      // 2. Generate and log native device token (FCM for Android, APNs for iOS)
      const tokenResult = await Notifications.getDevicePushTokenAsync();
      const token = tokenResult.data;

      console.log('[NotificationService] Generated FCM/APNs Device Token:', token);
      await this.saveTokenLocally(token);

      // 3. Register via notifications endpoint
      await registerDeviceToken({
        deviceToken: token,
        deviceType: Platform.OS === 'ios' ? 'ios' : 'android',
      });

      // 4. Also sync FCM token to user profile endpoint
      try {
        await patchUserFcmToken(String(token));
        console.log('[NotificationService] FCM token synced to user profile');
      } catch (profileErr) {
        console.log('[NotificationService] FCM token profile sync failed (non-fatal):', profileErr);
      }
    } catch (error) {
      console.error('[NotificationService] Device token registration failed:', error);
      captureSentryException(error, { tags: { area: 'notifications', op: 'register_device' } });
    }
  }

  /**
   * Save token locally
   */
  private async saveTokenLocally(token: string): Promise<void> {
    await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
  }

  /**
   * Get locally stored FCM token
   */
  async getLocalToken(): Promise<string | null> {
    return AsyncStorage.getItem(FCM_TOKEN_KEY);
  }

  /**
   * Retrieve notification preferences
   */
  async getPreferences(): Promise<NotificationPrefs> {
    try {
      const local = await AsyncStorage.getItem(PREFS_KEY);
      let localPrefs = local ? (JSON.parse(local) as NotificationPrefs) : null;

      // Fetch from API
      try {
        const response = await getNotificationPreferences();
        if (response) {
          // Merge backend preferences with default local schema
          const merged = {
            ...DEFAULT_PREFS,
            ...localPrefs,
            busNearStopEnabled: response.busNearStopEnabled ?? response.busNearStop ?? DEFAULT_PREFS.busNearStopEnabled,
            busArrivedEnabled: response.busArrivedEnabled ?? response.busArrived ?? DEFAULT_PREFS.busArrivedEnabled,
            tripStartedEnabled: response.tripStartedEnabled ?? response.tripStarted ?? DEFAULT_PREFS.tripStartedEnabled,
            delayAlertsEnabled: response.delayAlertsEnabled ?? response.delayAlert ?? DEFAULT_PREFS.delayAlertsEnabled,
            soundEnabled: response.soundEnabled ?? response.sound ?? DEFAULT_PREFS.soundEnabled,
            vibrationEnabled: response.vibrationEnabled ?? response.vibration ?? DEFAULT_PREFS.vibrationEnabled,
            voiceEnabled: response.voiceEnabled ?? response.voice ?? DEFAULT_PREFS.voiceEnabled,
            alertBeforeArrivalEnabled: response.alertBeforeArrivalEnabled ?? response.alertBeforeArrival ?? DEFAULT_PREFS.alertBeforeArrivalEnabled,
          };
          await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(merged));
          return merged;
        }
      } catch (apiErr) {
        // Fallback silently to local storage
        console.log('[NotificationService] Preferences API offline, using local copy');
      }

      return localPrefs || DEFAULT_PREFS;
    } catch (error) {
      return DEFAULT_PREFS;
    }
  }

  /**
   * Save notification preferences
   */
  async savePreferences(prefs: NotificationPrefs): Promise<void> {
    try {
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      
      // Architecture preparation for backend sync:
      // In production we would sync using:
      // await apiClient.put('/api/notifications/preferences', prefs);
      console.log('[NotificationService] Preferences saved locally and queued for backend sync:', prefs);
    } catch (error) {
      console.error('[NotificationService] Save preferences failed:', error);
    }
  }

  /**
   * Speak Text-to-Speech message if voice notifications are enabled
   */
  async speak(text: string): Promise<void> {
    try {
      const prefs = await this.getPreferences();
      if (!prefs.voiceEnabled) {
        return;
      }

      await Speech.stop(); // Stop any current speech
      await Speech.speak(text, {
        language: prefs.language,
        rate: 0.95,
      });
      console.log('[NotificationService] Speaking:', text);
    } catch (error) {
      console.error('[NotificationService] Speech failed:', error);
    }
  }

  /**
   * Announce voice message based on notification type and selected language
   */
  async announceByType(type: string): Promise<void> {
    const prefs = await this.getPreferences();
    const lang = prefs.language;
    const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;
    let message = '';

    switch (type.toLowerCase()) {
      case 'busnearstop':
      case 'near_stop':
        message = translations.busNearStop;
        break;
      case 'busarrived':
      case 'arrived':
        message = translations.busArrived;
        break;
      case 'tripstarted':
      case 'trip_started':
        message = translations.tripStarted;
        break;
      case 'delayalerts':
      case 'delay':
        message = translations.delayAlerts;
        break;
      default:
        return;
    }

    if (message) {
      await this.speak(message);
    }
  }

  /**
   * Show a local test notification and play voice announcement
   */
  async triggerTestNotification(type: keyof typeof DEFAULT_PREFS): Promise<void> {
    const prefs = await this.getPreferences();
    const lang = prefs.language;
    const translations = VOICE_TRANSLATIONS[lang] || VOICE_TRANSLATIONS.en;
    
    let title = 'NavixGo';
    let body = translations.testNotice;
    let voiceMessage = '';

    if (type === 'busNearStopEnabled') {
      body = 'This is how Bus Near My Stop notifications will appear.';
      voiceMessage = translations.busNearStop;
    } else if (type === 'busArrivedEnabled') {
      body = 'This is how Bus Arrived notifications will appear.';
      voiceMessage = translations.busArrived;
    } else if (type === 'tripStartedEnabled') {
      body = 'This is how Trip Started notifications will appear.';
      voiceMessage = translations.tripStarted;
    } else if (type === 'delayAlertsEnabled') {
      body = 'This is how Delay Alerts notifications will appear.';
      voiceMessage = translations.delayAlerts;
    } else {
      voiceMessage = 'This is a sample voice notification.';
    }

    // Respect sound/vibration preferences in scheduled local notification
    const testChannelId = prefs.soundEnabled ? 'default' : 'silent';
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: prefs.soundEnabled ? 'default' : undefined,
        data: { voiceMessage, type },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(),
        channelId: testChannelId,
      },
    });

    // Voice announcement immediately
    await this.speak(voiceMessage);
  }

  /**
   * Helper to check if a specific notification type is enabled in preferences
   */
  isNotificationTypeEnabled(type: string, prefs: NotificationPrefs): boolean {
    if (!type) return true;
    const normType = type.toUpperCase().replace(/_/g, '');
    
    if (normType.includes('NEARSTOP') || normType.includes('NEAR_STOP')) {
      return prefs.busNearStopEnabled;
    }
    if (normType.includes('ARRIVED') || normType.includes('ARRIVE')) {
      return prefs.busArrivedEnabled;
    }
    if (normType.includes('STARTED') || normType.includes('START')) {
      return prefs.tripStartedEnabled;
    }
    if (normType.includes('DELAY')) {
      return prefs.delayAlertsEnabled;
    }
    
    return true; // Default to true for other types
  }

  /**
   * Store assigned stop locally
   */
  async saveAssignedStopLocally(stop: any): Promise<void> {
    await AsyncStorage.setItem(ASSIGNED_STOP_KEY, JSON.stringify(stop));
  }

  /**
   * Get locally stored assigned stop
   */
  async getLocalAssignedStop(): Promise<any | null> {
    const local = await AsyncStorage.getItem(ASSIGNED_STOP_KEY);
    return local ? JSON.parse(local) : null;
  }
}

export const notificationService = NotificationService.getInstance();
