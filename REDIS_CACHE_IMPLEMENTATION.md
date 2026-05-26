# Redis Cache System - Driver Implementation Guide

> Complete Redis cache system for driver location tracking with real-time passenger updates

## 📋 Overview

This Redis cache system provides:

- **✅ Batched Location Tracking**: Collects GPS data and sends batches to backend every 15 seconds
- **✅ Redis Caching**: Backend caches locations in Redis with 30-second TTL
- **✅ Deduplication**: Automatic duplicate detection and removal
- **✅ Rate Limiting**: Prevents excessive uploads (10 batches/minute per driver)
- **✅ Real-time Updates**: Passengers subscribe to Redis cache keys for live tracking
- **✅ Monitoring**: Built-in health checks, performance metrics, and diagnostics

## 🏗️ Architecture

```
Mobile Driver App
    ↓
1. GPS Data Collection (every 2-5 seconds)
    ↓
2. Location Queue (AsyncStorage buffer)
    ↓
3. Batch Formation (every 15 seconds)
    ↓
4. HTTP Upload → /api/tracking/batch (with auth token)
    ↓
Backend
    ↓
5. Validation & Deduplication
    ↓
6. MongoDB Storage
    ↓
7. Redis Cache (30s TTL)
    ├─ location:driver_{driverId}
    ├─ location:bus_{busId}
    └─ location:trip_{tripId}
    ↓
8. Socket.IO Broadcast to Passengers
    ↓
Passenger App (Real-time tracking)
```

## 📦 Core Components

### 1. **CacheTrackingService**
Manages batch creation and Redis cache uploads

```typescript
import { cacheTrackingService } from '@/src/driver/cache';

// Create batch payload
const payload = cacheTrackingService.createBatchPayload(
  locations,
  tripId,
  driverId,
  busId
);

// Upload to cache
const { success, response } = await cacheTrackingService.uploadBatchToCache(
  payload,
  apiBaseUrl,
  authToken
);

// Monitor performance
const stats = cacheTrackingService.getStats();
console.log(`Batches sent: ${stats.totalBatchesSent}`);
console.log(`Avg latency: ${stats.averageBatchLatency}ms`);
```

### 2. **CacheCoordinatorService**
Orchestrates the complete batch upload cycle

```typescript
import { cacheCoordinatorService } from '@/src/driver/cache';

// Complete batch cycle: queue → format → upload → cache
const result = await cacheCoordinatorService.coordinateBatchUpload(
  tripId,
  driverId,
  busId,
  apiBaseUrl,
  authToken
);

if (result) {
  console.log(`Processed: ${result.itemsProcessed}`);
  console.log(`Cache keys: ${result.cacheKeys?.driver}`);
}
```

### 3. **CacheMonitoring**
Health checks and diagnostics

```typescript
import { CacheMonitoring } from '@/src/driver/cache';

// Get health report
const health = CacheMonitoring.getHealthReport();
console.log(health.status); // 'healthy' | 'degraded' | 'unhealthy'

// Display formatted stats
console.log(CacheMonitoring.formatCacheStatsForDisplay(verbose = true));

// Export for analysis
const stats = CacheMonitoring.exportStatsAsJSON();
```

### 4. **useCacheTracking Hook**
React hook for monitoring cache metrics

```typescript
import { useCacheTracking } from '@/src/driver/cache';

function DriverCacheMonitor() {
  const { cacheStats, isCacheHealthy, rateLimitStatus } = useCacheTracking();

  return (
    <View>
      <Text>Batches: {cacheStats.totalBatchesSent}</Text>
      <Text>Health: {isCacheHealthy ? '✅' : '❌'}</Text>
      <Text>Rate Limit: {rateLimitStatus.remaining}/10</Text>
    </View>
  );
}
```

## 🚀 Implementation Steps

### Step 1: Start Driver Tracking

In your driver trip screen:

```typescript
import { useDriverTracking } from '@/src/driver/hooks/useDriverTracking';

export function DriverTripScreen({ trip }) {
  const driverTracking = useDriverTracking(API_BASE_URL);

  const handleStartTrip = async () => {
    await driverTracking.startTracking(
      driverId,      // Current driver ID
      trip.busId,    // Assigned bus
      trip._id       // Active trip
    );
  };

  const handleEndTrip = async () => {
    await driverTracking.stopTracking();
  };

  return (
    <View>
      <Button onPress={handleStartTrip} title="Start Trip" />
      <Button onPress={handleEndTrip} title="End Trip" />
    </View>
  );
}
```

### Step 2: Monitor Cache Performance

```typescript
import { useCacheTracking, CacheMonitoring } from '@/src/driver/cache';

export function CacheStatsScreen() {
  const monitor = useCacheTracking();

  useEffect(() => {
    // Log health periodically
    const interval = setInterval(() => {
      CacheMonitoring.logCacheStats('Periodic Check');
    }, 60000); // Every 60 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <ScrollView>
      <Text style={styles.title}>Cache Performance</Text>
      <Text>Batches Sent: {monitor.cacheStats.totalBatchesSent}</Text>
      <Text>Locations: {monitor.cacheStats.totalLocationsProcessed}</Text>
      <Text>Avg Latency: {monitor.cacheStats.averageBatchLatency}ms</Text>
      <Text>Health: {monitor.isCacheHealthy ? '✅ Healthy' : '⚠️ Issues'}</Text>

      {monitor.rateLimitStatus.limited && (
        <Text style={styles.warning}>
          Rate limit low: {monitor.rateLimitStatus.remaining} remaining
        </Text>
      )}
    </ScrollView>
  );
}
```

### Step 3: Handle Cache Errors

```typescript
import { cacheCoordinatorService } from '@/src/driver/cache';

async function syncWithErrorHandling() {
  const result = await cacheCoordinatorService.coordinateBatchUpload(
    tripId, driverId, busId, apiBaseUrl, authToken
  );

  if (!result) {
    // Batch failed - will be retried automatically
    console.log('Batch upload failed, will retry');
    return;
  }

  // Success - cache updated
  console.log(`✅ Cache updated: ${result.cacheKeys?.driver}`);

  // Check rate limiting
  if (result.rateLimitRemaining <= 2) {
    console.warn('⚠️  Rate limit approaching');
  }
}
```

## 🔍 Cache Keys Reference

All cache keys are stored in Redis and visible in **RedisInsight**:

```
location:driver_{driverId}           → Latest driver location (30s TTL)
location:bus_{busId}                 → Latest bus location (30s TTL)
location:trip_{tripId}               → Latest trip location (30s TTL)
driver:active_trip_{driverId}        → Driver's active trip reference
trip:metadata_{tripId}               → Trip metadata and route info
batch:ack_{nonce}                    → Batch acknowledgment for deduplication
ratelimit:driver_{driverId}          → Rate limit counter (60s TTL)
cache:health                         → System health check timestamp
batch:stats_{driverId}               → Batch upload statistics
```

Get cache keys for a trip:

```typescript
import { CACHE_KEYS } from '@/src/driver/cache';

const cacheKeys = {
  driver: CACHE_KEYS.driverLocation(driverId),
  bus: CACHE_KEYS.busLocation(busId),
  trip: CACHE_KEYS.tripLocation(tripId),
};

console.log('View in RedisInsight:', cacheKeys);
```

## 📊 Batch Payload Structure

```json
{
  "tripId": "6a141ae8edd5337f4564c0be",
  "driverId": "69bcf19e7d6fe4ee68d09477",
  "busId": "69bcf16f7d6fe4ee68d09471",
  "batchTimestamp": "2026-05-25T09:48:00Z",
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "locations": [
    {
      "latitude": 17.385,
      "longitude": 78.486,
      "speed": 10,
      "heading": 90,
      "accuracy": 5,
      "altitude": 500,
      "timestamp": "2026-05-25T09:48:00Z"
    },
    {
      "latitude": 17.386,
      "longitude": 78.487,
      "speed": 12,
      "heading": 90,
      "accuracy": 5,
      "altitude": 501,
      "timestamp": "2026-05-25T09:48:05Z"
    }
  ]
}
```

## ✅ Backend Response

```json
{
  "success": true,
  "processedCount": 2,
  "validCount": 2,
  "invalidCount": 0,
  "duplicateCount": 0,
  "cacheUpdated": true,
  "rateLimit": {
    "remaining": 9,
    "resetIn": 45000
  },
  "nextExpectedBatch": "2026-05-25T09:48:15Z",
  "cacheKeys": {
    "driverLocation": "location:driver_69bcf19e7d6fe4ee68d09477",
    "busLocation": "location:bus_69bcf16f7d6fe4ee68d09471",
    "tripLocation": "location:trip_6a141ae8edd5337f4564c0be"
  }
}
```

## 🔐 Security Features

- **Authentication**: Bearer token in Authorization header
- **Nonce-based Replay Protection**: Unique nonce per batch prevents duplicate processing
- **Rate Limiting**: 10 batches/minute per driver (configurable)
- **Timeout Protection**: 10-second timeout on uploads
- **Data Validation**: Backend validates all coordinates and timestamps

## ⚠️ Common Issues & Solutions

### Issue: "Rate limit exceeded" error

**Solution:**
- Backend allows max 10 batches/minute per driver
- Current config: batch every 15 seconds = 4 batches/minute ✅
- Increase interval or implement queue-based throttling

### Issue: High duplicate rate

**Solution:**
- Check GPS accuracy (should be < 120m)
- Verify device time synchronization
- Check network for packet retransmission

### Issue: Long batch latency (>5s)

**Solution:**
- Check network connectivity (use 4G/WiFi)
- Verify backend server performance
- Check Redis connection pool

### Issue: Auth token errors

**Solution:**
```typescript
import { useAuth } from '@/hooks/useAuth';

const { token } = useAuth();
cacheTrackingService.setAuthToken(token);
```

## 🧪 Testing

### Manual Testing

1. Start driver trip tracking
2. Drive for 2-3 minutes
3. Check Redis:
   ```bash
   redis-cli get location:driver_<driverId>
   ```
4. Verify passenger app receives real-time updates

### Postman Testing

```http
POST http://localhost:3000/api/tracking/batch
Authorization: Bearer {authToken}
Content-Type: application/json

{
  "tripId": "...",
  "driverId": "...",
  "busId": "...",
  "batchTimestamp": "2026-05-25T09:48:00Z",
  "nonce": "unique-nonce",
  "locations": [...]
}
```

### Analytics

```typescript
// Export stats for analysis
const stats = CacheMonitoring.exportStatsAsJSON();
console.log(JSON.stringify(stats, null, 2));
```

## 📱 Environment Variables

```bash
# .env or .env.local
REACT_APP_API_URL=http://192.168.1.6:3000
# or production:
REACT_APP_API_URL=https://api.production.com
```

## 📚 Related Documentation

- [Background Location Tracking](./BACKGROUND_LOCATION_TRACKING_GUIDE.md)
- [Socket.IO Real-time Updates](./SOCKET_LOCATION_TRACKING.md)
- [Production Deployment](./PRODUCTION_LOCATION_IMPLEMENTATION.md)

## 🔗 Integration Checklist

- [ ] Import cache services in driver components
- [ ] Start tracking when trip begins
- [ ] Monitor cache health periodically
- [ ] Handle rate limiting gracefully
- [ ] Verify Redis keys in RedisInsight
- [ ] Test passenger real-time updates
- [ ] Configure environment variables
- [ ] Deploy with proper error handling
- [ ] Monitor production metrics

---

**Last Updated**: May 25, 2026
**Version**: 1.0.0
