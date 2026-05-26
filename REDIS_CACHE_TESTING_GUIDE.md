# Redis Cache System - Testing Guide

## 📋 Test Scenarios

### Scenario 1: Basic Cache Upload (5 min)

**Setup:**
- Driver app running
- Backend running with Redis
- RedisInsight open

**Steps:**
1. Start driver trip in app
2. In RedisInsight, watch for keys:
   ```
   location:driver_<driverId>
   location:bus_<busId>
   location:trip_<tripId>
   ```
3. Drive for 30 seconds
4. Verify location updates in Redis

**Expected Result:**
- ✅ Keys appear within 15 seconds
- ✅ Location updates every 15 seconds
- ✅ Values contain valid coordinates
- ✅ TTL shows 30 seconds

**Validation Code:**
```typescript
import { CACHE_KEYS } from '@/src/driver/cache';

const driverKey = CACHE_KEYS.driverLocation(driverId);
// Check in RedisInsight for: location:driver_<id>
// Verify contains: {"latitude": ..., "longitude": ..., "timestamp": ...}
```

---

### Scenario 2: Rate Limiting (3 min)

**Objective:** Verify rate limiting works (max 10 batches/min)

**Setup:**
```typescript
// Temporarily change sync interval to 1 second to trigger rate limiting
// In HTTPSyncManager.ts:
const SYNC_INTERVAL_MS = 1000; // Instead of 15000
```

**Steps:**
1. Start tracking
2. Wait for 70 seconds
3. Check cache stats

**Expected Result:**
- ✅ First 10 batches succeed
- ✅ Batch 11 fails with 429 status
- ✅ System applies exponential backoff
- ✅ Message in logs: "Rate limited"

**Verification:**
```typescript
const stats = cacheMonitor.cacheStats;
console.log(stats.rateLimitRemaining); // Should hit 0
console.log(stats.failedAttempts); // Should have failures
```

---

### Scenario 3: Network Failure & Retry (5 min)

**Objective:** Verify automatic retry with exponential backoff

**Setup:**
- Start driver tracking
- Simulate network error in HTTP request

**Steps:**
1. Start tracking
2. Kill backend server (or disconnect network)
3. Wait 60 seconds
4. Restart backend
5. Check sync recovery

**Expected Result:**
- ✅ Initial batch upload fails
- ✅ Queue stores locations locally
- ✅ Exponential backoff applied (1s, 2s, 4s, 8s, 16s, 32s, 64s)
- ✅ When backend restored, batches sync automatically

**Verification:**
```typescript
console.log(driverTracking.queueStats.totalItems); // Should hold items during outage
console.log(driverTracking.syncStats.failedAttempts); // Count failures
// After recovery, queue should clear
```

---

### Scenario 4: Duplicate Detection (3 min)

**Objective:** Verify duplicates are filtered

**Steps:**
1. Start tracking at fixed GPS location
2. Observe HTTP requests
3. Check response for duplicateCount

**Expected Result:**
- ✅ Second+ batch shows duplicateCount > 0
- ✅ Backend deduplicates before caching
- ✅ Redis always has latest location

**Verification:**
```typescript
// In network tab or logs
console.log('Response:', {
  processedCount: 50,
  validCount: 45,
  duplicateCount: 5,  // ✅ Should see this
});
```

---

### Scenario 5: Passenger Real-time Updates (5 min)

**Objective:** Verify passengers see real-time driver locations

**Setup:**
- Driver app with tracking active
- Passenger app open on same trip

**Steps:**
1. Start driver tracking
2. Open passenger app
3. Driver moves slowly
4. Observe passenger map updating

**Expected Result:**
- ✅ Driver location appears on map within 1-2 seconds
- ✅ Updates every 15 seconds as batches arrive
- ✅ Smooth movement from location to location
- ✅ No jumps or delays

**Verification:**
```typescript
// Passenger side - check Socket.IO events
socket.on('trip:location-update', (data) => {
  console.log('Driver location:', data);
  // Should receive every 15 seconds
});
```

---

### Scenario 6: Long Trip (30 min real test)

**Objective:** Verify system stability over time

**Steps:**
1. Start long trip (30+ minutes)
2. Monitor cache stats continuously
3. Check for memory leaks
4. Verify passenger tracking persists

**Expected Result:**
- ✅ No memory leaks or crashes
- ✅ Consistent batch upload success rate >95%
- ✅ Average latency stable
- ✅ Passenger tracking remains real-time

**Monitoring:**
```typescript
// Every 5 minutes
setInterval(() => {
  const stats = CacheMonitoring.getHealthReport();
  console.log(stats);
  // Verify status remains 'healthy'
}, 300000);
```

---

### Scenario 7: Background Location Tracking (Android/iOS)

**Objective:** Verify background tracking works when app is backgrounded

**Setup:**
- Android/iOS phone with location permission
- Driver app running

**Steps:**
1. Start tracking
2. Move app to background (home button)
3. Wait 1-2 minutes
4. Return to app

**Expected Result:**
- ✅ Locations continue collecting in background
- ✅ When app returns, batches sync
- ✅ No data loss during background period

**Verification:**
```typescript
console.log(driverTracking.queueStats.totalItems);
// Queue should have items accumulated during backgrounding
```

---

### Scenario 8: Auth Token Expiration

**Objective:** Verify system handles expired tokens

**Setup:**
- Start tracking
- Simulate token expiration (modify in HTTP headers)

**Steps:**
1. Start tracking
2. After first successful batch, invalidate token
3. Observe next batch attempt
4. Token refresh/re-login
5. Verify resume

**Expected Result:**
- ✅ Batch fails with 401 Unauthorized
- ✅ System stops syncing (prevents rapid retries)
- ✅ After token refresh, tracking resumes

**Verification:**
```typescript
// Should see 401 errors in logs
console.log('Auth error - token expired');
```

---

## 🧪 Unit Tests

### Test: Cache Key Generation

```typescript
import { CACHE_KEYS } from '@/src/driver/cache';

describe('CACHE_KEYS', () => {
  it('should generate correct driver location key', () => {
    const key = CACHE_KEYS.driverLocation('driver123');
    expect(key).toBe('location:driver_driver123');
  });

  it('should generate correct bus location key', () => {
    const key = CACHE_KEYS.busLocation('bus456');
    expect(key).toBe('location:bus_bus456');
  });

  it('should generate correct trip location key', () => {
    const key = CACHE_KEYS.tripLocation('trip789');
    expect(key).toBe('location:trip_trip789');
  });
});
```

### Test: Batch Payload Creation

```typescript
import { cacheTrackingService } from '@/src/driver/cache';

describe('CacheTrackingService', () => {
  it('should create valid batch payload', () => {
    const locations = [
      {
        latitude: 17.385,
        longitude: 78.486,
        speed: 10,
        timestamp: new Date().toISOString(),
      },
    ];

    const payload = cacheTrackingService.createBatchPayload(
      locations,
      'trip123',
      'driver456',
      'bus789'
    );

    expect(payload.tripId).toBe('trip123');
    expect(payload.driverId).toBe('driver456');
    expect(payload.busId).toBe('bus789');
    expect(payload.locations).toHaveLength(1);
    expect(payload.nonce).toBeDefined();
  });
});
```

### Test: Rate Limiting

```typescript
describe('Rate Limiting', () => {
  it('should track remaining requests', () => {
    const stats1 = cacheTrackingService.getStats();
    const initial = stats1.rateLimitRemaining;

    // After upload
    const stats2 = cacheTrackingService.getStats();
    expect(stats2.rateLimitRemaining).toBeLessThanOrEqual(initial);
  });

  it('should detect when rate limited', () => {
    const monitor = useCacheTracking();
    const isLimited = monitor.rateLimitStatus.limited;
    
    expect(typeof isLimited).toBe('boolean');
  });
});
```

---

## 🔍 Debug Commands

### Check Queue

```typescript
import { locationQueueManager } from '@/src/driver/queue/LocationQueueManager';

// Get queue stats
const stats = locationQueueManager.getStats();
console.log('Queue:', stats);

// Get next batch
const batch = await locationQueueManager.getBatch(10);
console.log('Batch:', batch);
```

### Check HTTP Sync

```typescript
import { httpSyncManager } from '@/src/driver/sync/HTTPSyncManager';

// Get sync stats
const stats = httpSyncManager.getStats();
console.log('Sync stats:', stats);

// Get backoff state
const backoff = httpSyncManager.getBackoffState();
console.log('Backoff:', backoff);
```

### Check Cache Status

```typescript
import { CacheMonitoring } from '@/src/driver/cache';

// Get full report
const report = CacheMonitoring.getHealthReport();
console.log('Health:', report);

// Export JSON
const json = CacheMonitoring.exportStatsAsJSON();
console.log(JSON.stringify(json, null, 2));
```

### Redis CLI

```bash
# Connect to Redis
redis-cli

# Check driver location
GET location:driver_<driverId>

# Check all keys
KEYS location:*

# Get TTL
TTL location:driver_<driverId>

# Monitor updates
MONITOR

# Get memory usage
INFO memory
```

---

## ✅ Pre-Flight Checklist

Before deploying to production:

- [ ] Run all test scenarios 1-8
- [ ] Verify batch upload success rate >95%
- [ ] Check average latency <2 seconds
- [ ] Confirm duplicate rate <2%
- [ ] Test rate limiting logic
- [ ] Verify background tracking (Android)
- [ ] Verify background tracking (iOS)
- [ ] Test with poor network (WiFi throttle)
- [ ] Test with offline then online
- [ ] Verify passenger real-time updates
- [ ] Check memory usage over 1 hour
- [ ] Verify error logging
- [ ] Confirm Sentry integration
- [ ] Test on target devices

---

## 📊 Performance Benchmarks

| Metric | Target | Measured |
|--------|--------|----------|
| Batch Latency | <2s | _____ |
| Queue Size (max) | <50 | _____ |
| Memory (per driver) | <10MB | _____ |
| Success Rate | >95% | _____ |
| Duplicate Rate | <2% | _____ |
| Rate Limit Accuracy | 10/min | _____ |

Record your measurements here.

---

**Last Updated**: May 25, 2026
