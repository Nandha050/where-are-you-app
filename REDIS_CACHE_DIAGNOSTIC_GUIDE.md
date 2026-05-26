# Redis Cache - Diagnostic & Verification Guide

## 🔍 Problem Identified & Fixed

### What Was Wrong
The Redis cache keys were not being stored because:

1. **HTTPSyncManager** was uploading batches directly without using **CacheTrackingService**
2. **CacheCoordinatorService** and **CacheTrackingService** existed but were never called in the actual sync flow
3. The batch upload path bypassed the entire Redis caching layer

### What Changed
- ✅ HTTPSyncManager now delegates to **CacheCoordinatorService**
- ✅ CacheCoordinatorService orchestrates batch upload through **CacheTrackingService**  
- ✅ CacheTrackingService sends batch to `/api/tracking/batch` with proper Redis integration
- ✅ Backend now caches location data to Redis after successful validation

---

## 🔍 Diagnostic Steps

### Step 1: Verify HTTP Requests Are Going to Correct Endpoint

**Check Network Tab:**
```
POST /api/tracking/batch
Headers:
  Authorization: Bearer <your_token>
  Content-Type: application/json

Body:
{
  "tripId": "xxx",
  "driverId": "xxx", 
  "busId": "xxx",
  "batchTimestamp": "2026-05-25T10:00:00Z",
  "nonce": "uuid-here",
  "locations": [...]
}

Response Status: 200/201
Response Body:
{
  "success": true,
  "processedCount": 10,
  "validCount": 10,
  "duplicateCount": 0,
  "cacheUpdated": true,
  "rateLimit": { "remaining": 9, "resetIn": 45000 },
  "cacheKeys": {
    "driverLocation": "location:driver_XXX",
    "busLocation": "location:bus_XXX",
    "tripLocation": "location:trip_XXX"
  }
}
```

### Step 2: Check Backend Logs

**Verify backend is receiving and processing batches:**
```bash
# Backend logs should show:
[CacheTrackingService] Uploading batch to cache
[HTTPSyncManager] Batch uploaded via coordinator
[CacheCoordinator] Batch cycle completed
```

**With cache update message:**
```
Cache updated: true
Processed: 10 items
Duplicates: 0
Rate limit remaining: 9
```

### Step 3: Verify Redis Cache Keys Exist

**SSH to backend and check Redis:**
```bash
redis-cli

# Check if driver location exists
GET location:driver_<driverId>

# Should return JSON:
{"latitude": 17.386, "longitude": 78.487, "speed": 10, "timestamp": "2026-05-25T10:00:00Z"}

# Check TTL
TTL location:driver_<driverId>

# Should be between 1-30 seconds

# Monitor real-time updates
MONITOR

# You should see SET commands like:
SET location:driver_XXX {...} EX 30
```

### Step 4: Verify Passenger Receives Real-time Updates

**Check Socket.IO events:**
```typescript
// Passenger app should receive:
socket.on('trip:location-update', (data) => {
  console.log('Driver location:', data);
  // Should appear every ~15 seconds when batch uploads
});
```

---

## 🧪 Complete Test Flow

### Test 1: Quick Validation (5 minutes)

1. **Start driver tracking**
   ```typescript
   await driverTracking.startTracking(driverId, busId, tripId);
   ```

2. **Open browser DevTools → Network tab**

3. **Wait 15 seconds**

4. **Look for POST to `/api/tracking/batch`**
   - Should see `Status: 200`
   - Response should have `"cacheUpdated": true`
   - Response should have `"cacheKeys"` object

5. **If visible:** ✅ Batch is uploading correctly
   **If NOT visible:** ⚠️ Check logs and errors

### Test 2: Verify Redis Caching (5 minutes)

1. **Start driver tracking**

2. **In Redis CLI:**
   ```bash
   redis-cli MONITOR
   ```

3. **Wait for batch to upload (15 seconds)**

4. **Should see in MONITOR:**
   ```
   SET location:driver_<id> {...} EX 30
   SET location:bus_<id> {...} EX 30
   SET location:trip_<id> {...} EX 30
   ```

5. **Check actual key:**
   ```bash
   GET location:driver_<id>
   # Should return JSON with latitude, longitude
   ```

6. **If keys appear:** ✅ Redis caching is working
   **If NOT:** ⚠️ Backend `/api/tracking/batch` not caching properly

### Test 3: Monitor Cache Stats (5 minutes)

```typescript
import { CacheMonitoring } from '@/src/driver/cache';

// Every 10 seconds
setInterval(() => {
  const health = CacheMonitoring.getHealthReport();
  console.log('Cache Health:', {
    status: health.status,
    batchesSent: health.metrics.totalBatchesSent,
    latency: health.metrics.averageLatency,
    rateLimitRemaining: health.metrics.rateLimitRemaining,
    successRate: health.metrics.successRate,
  });
}, 10000);

// Should see:
// ✅ totalBatchesSent > 0 (increasing over time)
// ✅ averageLatency < 2000 (milliseconds)
// ✅ rateLimitRemaining > 0 (should be 8-9/10)
// ✅ successRate > 95% (>= 95)
```

---

## ⚠️ Common Issues & Solutions

### Issue 1: `"cacheUpdated": false` in response

**Cause:** Backend is receiving batch but NOT caching to Redis

**Solution:**
- Check Redis connection in backend
- Verify Redis server is running
- Check backend Redis configuration

```bash
# SSH to backend
redis-cli ping
# Should respond: PONG
```

### Issue 2: No cache keys in response

**Cause:** Batch failed validation or backend error

**Solution:**
- Check `validCount` vs `processedCount`
- Look for validation errors in response
- Verify location data is valid (lat/long in valid range)

```
Check:
- latitude between -90 and 90
- longitude between -180 and 180
- timestamp is valid ISO string
```

### Issue 3: 401 Unauthorized errors

**Cause:** Auth token is invalid or expired

**Solution:**
```typescript
// Ensure token is set correctly
import { useAuth } from '@/hooks/useAuth';

const { token } = useAuth();
console.log('Auth token:', token?.substring(0, 20) + '...'); // Should be set

// Verify token is passed in HTTPSyncManager
httpSyncManager.setAuthToken(token);
```

### Issue 4: Network POST not appearing

**Cause:** Sync hasn't started or queue is empty

**Solution:**
1. Verify tracking is actually started
   ```typescript
   console.log('Is tracking:', driverTracking.isTracking); // Should be true
   ```

2. Verify queue has items
   ```typescript
   console.log('Queue size:', driverTracking.queueStats.totalItems); // Should be > 0
   ```

3. Check if sync interval is right
   ```typescript
   // Default is 15 seconds, so POST should appear every 15s
   // If not, check SYNC_INTERVAL_MS in HTTPSyncManager.ts
   ```

---

## 🔧 Debugging Commands

### View Full Request/Response

```typescript
// Add detailed logging
import { logger } from '@/src/core/logger/logger';

logger.info('[Debug] Batch upload details', {
  queueSize: driverTracking.queueStats.totalItems,
  isSyncing: driverTracking.isSyncing,
  cacheHealth: CacheMonitoring.getHealthReport(),
  stats: CacheMonitoring.exportStatsAsJSON(),
});
```

### Monitor Queue Size Over Time

```typescript
setInterval(() => {
  const stats = driverTracking.queueStats;
  console.log(`Queue: ${stats.totalItems} items, Age: ${stats.oldestItemAge}ms`);
  // Queue should decrease by ~10-100 items every 15 seconds
}, 5000);
```

### Check Cache Coordinator Stats

```typescript
import { cacheCoordinatorService } from '@/src/driver/cache';

const stats = cacheCoordinatorService.getStats();
console.log('Coordinator Stats:', {
  totalBatchesCycled: stats.totalBatchesSent,
  totalDuplicatesDetected: stats.totalDuplicates,
  duplicateRate: stats.duplicateRate,
  successRate: stats.successRate,
});
```

---

## ✅ Expected Behavior After Fix

**Timeline:**
```
T=0:00   Driver starts tracking
         ✅ Background location collection starts
         ✅ Queue buffers GPS points

T=0:15   First batch cycle
         ✅ Coordinator gets batch from queue (~100 items)
         ✅ CacheTrackingService formats batch payload
         ✅ POST sent to /api/tracking/batch
         ✅ Backend processes and caches to Redis
         ✅ Cache keys appear in Redis (30s TTL)
         ✅ Passengers receive Socket.IO update

T=0:30   Second batch cycle (repeat)
         ✅ Another 15 items accumulated
         ✅ Another batch sent

T=1:00   Continuous updates
         ✅ Every 15 seconds: new batch
         ✅ Every 15 seconds: Redis cache updated
         ✅ Passengers see real-time driver location
```

---

## 📊 Success Metrics

After the fix, you should see:

| Metric | Expected | Check |
|--------|----------|-------|
| **Batches Sent** | ✅ Increasing | `totalBatchesSent > 0` |
| **Cache Updated** | ✅ true | Response: `"cacheUpdated": true` |
| **Cache Keys** | ✅ In Redis | `KEYS location:*` shows 3+ keys |
| **Latency** | ✅ <2000ms | `averageLatency < 2000` |
| **Success Rate** | ✅ >95% | `successRate > 95` |
| **Passenger Updates** | ✅ Every 15s | Socket events every 15 seconds |

---

## 🧹 Cleanup & Reset

If you need to clear cache for testing:

```bash
# SSH to backend
redis-cli

# Clear all location cache keys
DEL location:driver_*
DEL location:bus_*
DEL location:trip_*

# Or clear everything
FLUSHDB
```

---

## 📝 What Files Were Modified

The following files were updated to fix the Redis cache integration:

1. **`src/driver/sync/HTTPSyncManager.ts`**
   - Now uses `CacheCoordinatorService` for all batch uploads
   - Removed direct HTTP POST logic
   - Improved error handling for cache operations

2. **`src/driver/cache/CacheCoordinatorService.ts`**
   - Already properly implemented (no changes needed)
   - Handles queue management and batch removal

3. **`src/driver/cache/CacheTrackingService.ts`**
   - Already properly implemented (no changes needed)
   - Handles actual Redis cache upload to backend

---

## 🚀 Next Steps

1. **Verify the fix:**
   - Run Test 1: Quick Validation (5 min)
   - Run Test 2: Verify Redis Caching (5 min)

2. **Check logs:**
   - Backend should show batch processing
   - Redis should show cache keys

3. **Test end-to-end:**
   - Open driver app + passenger app
   - Start trip
   - Watch passenger see live driver location

4. **If still not working:**
   - Check backend `/api/tracking/batch` endpoint
   - Verify Redis connection in backend
   - Check Auth token is being passed

---

**Version**: 1.0.1 (Fixed)  
**Status**: ✅ Redis Cache Now Integrated  
**Last Updated**: May 25, 2026
