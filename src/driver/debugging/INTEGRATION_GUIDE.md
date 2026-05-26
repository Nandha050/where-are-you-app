# PRODUCTION DEBUGGING INTEGRATION GUIDE

## 🚀 Setup Instructions

### Step 1: Initialize Permission Debugger (App Startup)

```typescript
// In app.tsx or root navigation

import { permissionDebugger } from './src/driver/debugging/PermissionDebugger';

export default function App() {
  useEffect(() => {
    // CRITICAL: Register TaskManager handler EARLY
    permissionDebugger.registerTaskManagerHandler(async (taskData) => {
      // Background location task handler
      const { locations } = taskData as any;
      // ... handle locations
    });
  }, []);

  // ... rest of app
}
```

### Step 2: Start Debuggers in useDriverTracking

```typescript
import { appStateManager } from '../debugging/AppStateManager';
import { networkStateManager } from '../debugging/NetworkStateManager';
import { trackingHealthMonitor } from '../debugging/TrackingHealthMonitor';
import { permissionDebugger } from '../debugging/PermissionDebugger';

export function useDriverTracking(apiBaseUrl: string) {
  const { token } = useAuth();

  useEffect(() => {
    // 1. Verify permissions before starting
    permissionDebugger.verifyPermissions().then((info) => {
      if (!info.canStart) {
        logger.error('[useDriverTracking] Cannot start - permissions missing');
        // Show permission dialog
        permissionDebugger.requestMissingPermissions();
        return;
      }
    });

    // 2. Start monitoring
    appStateManager.start({
      onBackgrounded: async () => {
        logger.info('[useDriverTracking] App backgrounded');
      },
      onForegrounded: async () => {
        logger.info('[useDriverTracking] App foregrounded');
      },
    });

    networkStateManager.start();
    trackingHealthMonitor.start();

    return () => {
      appStateManager.stop();
      networkStateManager.stop();
    };
  }, []);

  // ... rest of hook
}
```

### Step 3: Add pause/resume to HTTPSyncManager

```typescript
// In HTTPSyncManager.ts

pause(): void {
  if (this.syncTimer) {
    clearInterval(this.syncTimer);
    this.syncTimer = null;
    logger.info('[HTTPSyncManager] Sync paused');
  }
}

resume(): void {
  this.start();
  logger.info('[HTTPSyncManager] Sync resumed');
}
```

### Step 4: Log Background Task Execution

```typescript
// In BackgroundLocationService.ts

private handleBackgroundLocation = async (taskData: TaskManager.TaskManagerTaskBody): Promise<void> => {
  try {
    const locations = (taskData as any).locations as Location.LocationObject[] | undefined;
    
    // Log execution
    trackingHealthMonitor.recordBackgroundTaskExecution(!!locations?.length);
    
    if (!locations || locations.length === 0) {
      logger.debug('[BackgroundLocationService] Background task: no locations');
      trackingHealthMonitor.recordBackgroundTaskExecution(false);
      return;
    }

    for (const location of locations) {
      await this.handleLocationUpdate(location);
    }

    await httpSyncManager.sync();
    trackingHealthMonitor.recordBackgroundTaskExecution(true);
  } catch (error) {
    logger.error('[BackgroundLocationService] Background task error', { error });
    trackingHealthMonitor.recordBackgroundTaskExecution(false);
  }
};
```

---

## 🔧 Debugging Dashboard Component

```typescript
import React, { useState, useEffect } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { trackingHealthMonitor } from '../debugging/TrackingHealthMonitor';
import { queueInspector } from '../debugging/QueueInspector';
import { permissionDebugger } from '../debugging/PermissionDebugger';

export function TrackingDebugDashboard() {
  const [metrics, setMetrics] = useState(trackingHealthMonitor.getMetrics());
  const [queueState, setQueueState] = useState<any>(null);
  const [permReport, setPermReport] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(trackingHealthMonitor.getMetrics());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleInspectQueue = async () => {
    const inspection = await queueInspector.inspect();
    setQueueState(inspection);
  };

  const handleCheckPermissions = async () => {
    const report = await permissionDebugger.getDetailedReport();
    setPermReport(report);
  };

  return (
    <ScrollView style={{ flex: 1, padding: 16, backgroundColor: '#f5f5f5' }}>
      {/* Health Score */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold' }}>
          Health Score: {metrics.healthScore}/100
        </Text>
        <Text style={{ color: metrics.healthScore >= 80 ? 'green' : 'red' }}>
          Status: {metrics.healthScore >= 80 ? '✅ HEALTHY' : '⚠️ WARNING'}
        </Text>
      </View>

      {/* Tracking Status */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'white', borderRadius: 8 }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>📍 Tracking Status</Text>
        <Text>Active: {metrics.isTracking ? '✅' : '❌'}</Text>
        <Text>Foreground: {metrics.isForegroundActive ? '✅' : '❌'}</Text>
        <Text>Background: {metrics.isBackgroundActive ? '✅' : '❌'}</Text>
        <Text>App State: {metrics.appState}</Text>
      </View>

      {/* Queue Status */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'white', borderRadius: 8 }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>📦 Queue Status</Text>
        <Text>Size: {metrics.queueSize}/500</Text>
        <Text>Health: {metrics.queueHealthy ? '✅ GOOD' : '⚠️ WARNING'}</Text>
        {metrics.oldestQueueItem && <Text>Oldest: {metrics.oldestQueueItem}</Text>}
        <Pressable onPress={handleInspectQueue} style={{ marginTop: 8, padding: 8, backgroundColor: '#007AFF', borderRadius: 4 }}>
          <Text style={{ color: 'white' }}>Inspect Queue</Text>
        </Pressable>
        {queueState && (
          <Text style={{ marginTop: 8, color: '#666' }}>
            Corruption: {queueState.corruption || 'None'} {queueState.warnings.join(', ')}
          </Text>
        )}
      </View>

      {/* Sync Metrics */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'white', borderRadius: 8 }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>🔄 Sync Metrics</Text>
        <Text>Success Rate: {metrics.successRate}%</Text>
        <Text>Successful: {metrics.successfulSyncs}</Text>
        <Text>Failed: {metrics.failedSyncs}</Text>
        <Text>Uploaded: {metrics.totalItemsUploaded}</Text>
      </View>

      {/* Network Status */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'white', borderRadius: 8 }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>🌐 Network Status</Text>
        <Text>Connected: {metrics.isConnected === true ? '✅' : '❌'}</Text>
        <Text>Type: {metrics.networkType}</Text>
        <Text>Recently Offline: {metrics.wasRecentlyOffline ? 'Yes' : 'No'}</Text>
      </View>

      {/* Permissions */}
      <View style={{ marginBottom: 16, padding: 12, backgroundColor: 'white', borderRadius: 8 }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>🔐 Permissions</Text>
        <Pressable onPress={handleCheckPermissions} style={{ padding: 8, backgroundColor: '#007AFF', borderRadius: 4 }}>
          <Text style={{ color: 'white' }}>Check Permissions</Text>
        </Pressable>
        {permReport && <Text style={{ marginTop: 8, fontSize: 12 }}>{permReport}</Text>}
      </View>

      {/* Issues */}
      {metrics.issues.length > 0 && (
        <View style={{ marginBottom: 16, padding: 12, backgroundColor: '#ffcccc', borderRadius: 8 }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>⚠️ Issues Detected</Text>
          {metrics.issues.map((issue, i) => (
            <Text key={i}>• {issue}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
```

---

## 🎯 Common Debugging Scenarios

### Scenario 1: Tracking stops when app backgrounded

**Steps:**
1. Open Debugging Dashboard
2. Click "Check Permissions"
3. Look for: "Background location permission NOT granted"

**Fix:**
- User must grant "Allow all the time" permission on Android
- User must enable "Always" permission on iOS

### Scenario 2: Queue keeps growing

**Steps:**
1. Click "Inspect Queue"
2. Check if `corruption` is not null
3. Look at `oldestItemAge` - if > 30 minutes, sync is stuck

**Fix:**
- Check network connectivity
- Check if auth token expired
- Restart app (clears corrupted queue)

### Scenario 3: Background task not executing

**Steps:**
1. Check "App State" in dashboard - should show "background"
2. Watch logs for `[BackgroundLocationService] Background task error`
3. Check if TaskManager handler registered

**Fix:**
- Call `permissionDebugger.registerTaskManagerHandler()` at app startup
- Verify background location permission granted

### Scenario 4: High battery drain

**Steps:**
1. Check "Sync Metrics" - if sync frequency too high
2. Check if "Foreground" stays active when backgrounded

**Fix:**
- AppState should pause sync when backgrounded
- Verify AppStateManager initialized correctly

---

## 📊 Logging Strategy

All logging already configured with:

```
[ServiceName] Log level [timestamp] Message with context
```

Examples:

```
INFO  [2026-05-26T07:30:00.000Z] [BackgroundLocationService] Started
DEBUG [2026-05-26T07:30:01.000Z] [HTTPSyncManager] Sync cycle {"queueSize":5}
ERROR [2026-05-26T07:30:05.000Z] [HTTPSyncManager] Upload failed {"error":"timeout"}
```

---

## 🔍 Key Metrics to Monitor

- **HealthScore**: Overall system health (0-100)
- **QueueSize**: How many items waiting (0-500)
- **SuccessRate**: % of syncs that succeeded
- **AppState**: foreground/background/inactive
- **NetworkType**: wifi/cellular/none
- **Issues**: Active problems detected

---

## ⚠️ Critical Alerts

System will flag critical issues:

- ❌ Queue > 400 items
- ❌ Success rate < 50%
- ❌ Tracking not active
- ❌ Network offline > 5 minutes
- ❌ Background task not executing
