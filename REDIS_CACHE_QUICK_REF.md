# Redis Cache System - Quick Reference

## 🚀 Quick Start (5 minutes)

### 1. Import and Setup

```typescript
import { useDriverTracking } from '@/src/driver/hooks/useDriverTracking';
import { useCacheTracking, CacheMonitoring } from '@/src/driver/cache';
import { API_BASE_URL } from '@/api/client';

// In your driver trip screen component
const driverTracking = useDriverTracking(API_BASE_URL);
const cacheMonitor = useCacheTracking();
```

### 2. Start Tracking

```typescript
const handleStartTrip = async () => {
  await driverTracking.startTracking(
    driverId,   // user.id
    busId,      // trip.busId
    tripId      // trip._id
  );
};
```

### 3. Monitor Performance

```typescript
// In JSX
<Text>Batches: {cacheMonitor.cacheStats.totalBatchesSent}</Text>
<Text>Health: {cacheMonitor.isCacheHealthy ? '✅' : '❌'}</Text>
```

### 4. Stop Tracking

```typescript
const handleEndTrip = async () => {
  await driverTracking.stopTracking();
};
```

---

## 📦 Core APIs

### useDriverTracking Hook

```typescript
interface UseDriverTrackingState {
  isTracking: boolean;           // Tracking active
  isSyncing: boolean;            // Sync in progress
  queueStats: QueueStats;        // Queue size, age, retries
  syncStats: SyncStats;          // Upload stats
  error: string | null;          // Last error
}

interface UseDriverTrackingActions {
  startTracking(driverId?, busId?, tripId?): Promise<void>;
  stopTracking(): Promise<void>;
  pauseTracking(): Promise<void>;
  resumeTracking(): Promise<void>;
  forceSyncNow(): Promise<void>;
}
```

### useCacheTracking Hook

```typescript
interface UseCacheTrackingState {
  cacheStats: CacheStats;        // Batch & cache metrics
  isCacheHealthy: boolean;       // Overall health
  lastCacheUpdate: string;       // Last update time
  rateLimitStatus: {
    remaining: number;           // Remaining calls
    limited: boolean;            // Rate limited?
  };
}

// Usage
const monitor = useCacheTracking();
console.log(monitor.cacheStats.totalBatchesSent);
```

### CacheMonitoring Static Methods

```typescript
// Get health report
CacheMonitoring.getHealthReport()
→ { status, metrics, warnings, recommendations }

// Display formatted stats
CacheMonitoring.formatCacheStatsForDisplay(verbose)
→ ASCII table with metrics

// Log to console
CacheMonitoring.logCacheStats(context)

// Export for analysis
CacheMonitoring.exportStatsAsJSON()
→ { health_report, detailed_stats }

// Reset stats
CacheMonitoring.resetMonitoring()
```

### CACHE_KEYS Utility

```typescript
import { CACHE_KEYS } from '@/src/driver/cache';

// Get cache keys for your trip
const keys = {
  driver: CACHE_KEYS.driverLocation(driverId),
  bus: CACHE_KEYS.busLocation(busId),
  trip: CACHE_KEYS.tripLocation(tripId),
};

// Get all keys for cleanup
const allDriverKeys = getDriverCacheKeys(driverId);
const allTripKeys = getTripCacheKeys(tripId);
```

---

## 🔄 Complete Workflow

```typescript
export function DriverTripScreen() {
  const { user } = useAuth();
  const driverTracking = useDriverTracking(API_BASE_URL);
  const cacheMonitor = useCacheTracking();

  // On component mount, initialize
  useEffect(() => {
    // Already done in useDriverTracking
  }, []);

  // Periodic health check
  useEffect(() => {
    const interval = setInterval(() => {
      const health = CacheMonitoring.getHealthReport();
      if (health.status !== 'healthy') {
        console.warn('Cache health degraded:', health.warnings);
      }
    }, 60000); // Every minute

    return () => clearInterval(interval);
  }, []);

  const startTrip = async (trip) => {
    // 1. Start tracking
    await driverTracking.startTracking(user.id, trip.busId, trip._id);

    // 2. Monitor in background
    const monitorInterval = setInterval(() => {
      console.log('Queue size:', driverTracking.queueStats.totalItems);
      console.log('Batches sent:', cacheMonitor.cacheStats.totalBatchesSent);
    }, 5000);

    // 3. On trip end
    return () => {
      clearInterval(monitorInterval);
      driverTracking.stopTracking();
    };
  };

  return (
    <View>
      <Button onPress={() => startTrip(trip)} title="Start Trip" />
      <Text>Status: {driverTracking.isTracking ? '🟢' : '⚫'}</Text>
      <Text>Batches: {cacheMonitor.cacheStats.totalBatchesSent}</Text>
    </View>
  );
}
```

---

## ⚡ Performance Tuning

### Batch Interval (15 seconds default)

In `HTTPSyncManager.ts`, adjust `SYNC_INTERVAL_MS`:
```typescript
const SYNC_INTERVAL_MS = 15000; // Change to 10000, 20000, etc.
```

### Max Batch Size (100 locations default)

```typescript
const MAX_BATCH_SIZE = 100; // More = fewer batches, larger requests
```

### Queue Size (500 locations default)

In `LocationQueueManager.ts`:
```typescript
const MAX_QUEUE_SIZE = 500; // Increase for longer buffers
```

### Accuracy Filter

In `useLocation.ts`:
```typescript
const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 120; // Stricter = fewer invalid
```

---

## 🐛 Debugging

### View Current Stats in DevTools

```typescript
// In React Native debugger console
import { CacheMonitoring } from '@/src/driver/cache';
console.log(CacheMonitoring.formatCacheStatsForDisplay(true));
```

### Check Redis Cache

```bash
# SSH to backend
redis-cli

# View driver location
GET location:driver_<driverId>

# List all location keys
KEYS location:*

# Monitor in real-time
MONITOR
```

### Test Batch Upload

```http
POST http://localhost:3000/api/tracking/batch
Authorization: Bearer {token}
Content-Type: application/json

{
  "tripId": "123",
  "driverId": "456",
  "busId": "789",
  "batchTimestamp": "2026-05-25T10:00:00Z",
  "nonce": "abc-123",
  "locations": [
    {
      "latitude": 17.385,
      "longitude": 78.486,
      "speed": 10,
      "heading": 90,
      "accuracy": 5,
      "timestamp": "2026-05-25T10:00:00Z"
    }
  ]
}
```

Expected 200 response:
```json
{
  "success": true,
  "processedCount": 1,
  "validCount": 1,
  "duplicateCount": 0,
  "rateLimit": {"remaining": 9, "resetIn": 45000}
}
```

---

## ✅ Checklist for Production

- [ ] Set `REACT_APP_API_URL` environment variable
- [ ] Test with real location permissions
- [ ] Verify Redis cache keys in RedisInsight
- [ ] Monitor first 24 hours of passenger tracking
- [ ] Set up alerts for cache health degradation
- [ ] Configure error logging (Sentry, etc.)
- [ ] Test rate limiting edge cases
- [ ] Verify background tracking on Android/iOS
- [ ] Test with unreliable network (throttle in DevTools)
- [ ] Verify passenger real-time updates via Socket.IO

---

## 📊 Metric Thresholds

| Metric | Good | Warn | Critical |
|--------|------|------|----------|
| Avg Latency | <1s | <5s | >5s |
| Success Rate | >95% | >90% | <90% |
| Duplicate Rate | <1% | <5% | >5% |
| Queue Size | <50 | <200 | >200 |
| Rate Limit | >5 | >2 | ≤2 |

---

## 🔗 Files

- **Services**: `src/driver/cache/`
  - `CacheTrackingService.ts` - Batch creation
  - `CacheCoordinatorService.ts` - Orchestration
  - `CacheMonitoring.ts` - Health & diagnostics
  - `cacheKeys.ts` - Redis key patterns

- **Hooks**: `src/driver/hooks/`
  - `useDriverTracking.ts` - Main tracking
  - `useCacheTracking.ts` - Cache monitoring

- **Queue**: `src/driver/queue/`
  - `LocationQueueManager.ts` - Local buffering

- **Sync**: `src/driver/sync/`
  - `HTTPSyncManager.ts` - Batch uploads

- **Background**: `src/driver/tracking/`
  - `BackgroundLocationService.ts` - GPS collection

---

## 📚 Further Reading

- [Full Documentation](./REDIS_CACHE_IMPLEMENTATION.md)
- [Background Tracking](./BACKGROUND_LOCATION_TRACKING_GUIDE.md)
- [Production Deployment](./PRODUCTION_LOCATION_IMPLEMENTATION.md)
- [Socket.IO Real-time](./SOCKET_LOCATION_TRACKING.md)

---

**Last Updated**: May 25, 2026
