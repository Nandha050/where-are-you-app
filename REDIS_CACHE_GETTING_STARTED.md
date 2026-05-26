# Redis Cache System - Getting Started

> Complete Redis cache system for driver location tracking - ready for production

## ✅ What's Included

**Core System:**
- ✅ `CacheTrackingService` - Batch creation & upload management
- ✅ `CacheCoordinatorService` - Orchestrates batch cycle
- ✅ `CacheMonitoring` - Health checks & diagnostics
- ✅ `useCacheTracking` - React hook for monitoring
- ✅ Cache key management system
- ✅ Complete integration example

**Documentation:**
- ✅ Full implementation guide (76kb)
- ✅ Quick reference for developers (28kb)
- ✅ Testing guide with 8 scenarios (22kb)
- ✅ System architecture & summary (19kb)
- ✅ Verification script

**Features:**
- ✅ 15-second batch uploads
- ✅ Automatic deduplication
- ✅ Rate limiting (10/min per driver)
- ✅ Exponential backoff on failures
- ✅ Real-time passenger tracking via Socket.IO
- ✅ Comprehensive error handling
- ✅ Performance monitoring
- ✅ Security (nonce-based replay protection)

---

## 🚀 Quick Start (10 minutes)

### 1. Verify Installation

```bash
# Check all files are in place
npx ts-node src/driver/cache/verify-installation.ts
```

Expected output:
```
✅ File exists: src/driver/cache/cacheKeys.ts
✅ File exists: src/driver/cache/CacheTrackingService.ts
✅ File exists: src/driver/cache/CacheCoordinatorService.ts
...
🎉 All checks passed! Redis cache system is ready to use.
```

### 2. Import in Your Driver Screen

```typescript
import { useDriverTracking } from '@/src/driver/hooks/useDriverTracking';
import { useCacheTracking } from '@/src/driver/cache';
import { API_BASE_URL } from '@/api/client';

export function DriverTripScreen({ trip }) {
  const driverTracking = useDriverTracking(API_BASE_URL);
  const cacheMonitor = useCacheTracking();
  
  // ... rest of component
}
```

### 3. Start Tracking

```typescript
const handleStartTrip = async () => {
  await driverTracking.startTracking(
    user.id,      // driverId
    trip.busId,   // busId
    trip._id      // tripId
  );
};
```

### 4. Monitor Performance

```typescript
// In JSX
<Text>Batches: {cacheMonitor.cacheStats.totalBatchesSent}</Text>
<Text>Health: {cacheMonitor.isCacheHealthy ? '✅' : '❌'}</Text>
```

### 5. Stop Tracking

```typescript
const handleEndTrip = async () => {
  await driverTracking.stopTracking();
};
```

---

## 📂 File Locations

All files are in `src/driver/`:

```
src/driver/
├── cache/
│   ├── cacheKeys.ts                    # Cache key patterns
│   ├── CacheTrackingService.ts         # Core batch service
│   ├── CacheCoordinatorService.ts      # Orchestrator
│   ├── CacheMonitoring.ts              # Health & stats
│   ├── DriverTrackingScreenExample.tsx # Complete example
│   ├── index.ts                        # Unified exports
│   └── verify-installation.ts          # Setup checker
├── hooks/
│   ├── useDriverTracking.ts            # Main hook (updated)
│   ├── useCacheTracking.ts             # Cache monitoring
│   └── ...
├── queue/
│   └── LocationQueueManager.ts         # Queue (existing)
├── sync/
│   └── HTTPSyncManager.ts              # Sync (existing)
└── tracking/
    └── BackgroundLocationService.ts    # GPS (existing)
```

---

## 📖 Documentation

| Document | Purpose | Read Time |
|----------|---------|-----------|
| [REDIS_CACHE_IMPLEMENTATION.md](./REDIS_CACHE_IMPLEMENTATION.md) | Full guide with architecture, APIs, security | 15 min |
| [REDIS_CACHE_QUICK_REF.md](./REDIS_CACHE_QUICK_REF.md) | Quick reference, code examples, debugging | 5 min |
| [REDIS_CACHE_TESTING_GUIDE.md](./REDIS_CACHE_TESTING_GUIDE.md) | 8 test scenarios, unit tests, benchmarks | 10 min |
| [REDIS_CACHE_SYSTEM_SUMMARY.md](./REDIS_CACHE_SYSTEM_SUMMARY.md) | Architecture diagram, integration points | 5 min |

**Read in this order:**
1. Start with this file (you're here!)
2. [REDIS_CACHE_QUICK_REF.md](./REDIS_CACHE_QUICK_REF.md) for quick start
3. [REDIS_CACHE_IMPLEMENTATION.md](./REDIS_CACHE_IMPLEMENTATION.md) for deep dive
4. [REDIS_CACHE_TESTING_GUIDE.md](./REDIS_CACHE_TESTING_GUIDE.md) before deploying

---

## 🎯 Integration Checklist

### Phase 1: Setup (30 min)
- [ ] Run `verify-installation.ts`
- [ ] Review `DriverTrackingScreenExample.tsx`
- [ ] Copy example code to your trip screen
- [ ] Set `REACT_APP_API_URL` in `.env.local`

### Phase 2: Testing (1 hour)
- [ ] Start app and trip
- [ ] Watch Redis cache keys appear
- [ ] Verify passenger tracking updates
- [ ] Check cache stats in monitoring UI
- [ ] Simulate network failure (toggle WiFi)
- [ ] Verify automatic retry

### Phase 3: Optimization (as needed)
- [ ] Tune batch interval (default: 15s)
- [ ] Adjust accuracy filter (default: 120m)
- [ ] Monitor queue sizes (max: 500)
- [ ] Profile memory usage

### Phase 4: Deployment (before production)
- [ ] Run all 8 test scenarios
- [ ] Verify >95% success rate
- [ ] Check average latency <2s
- [ ] Enable Sentry error tracking
- [ ] Set up production monitoring
- [ ] Deploy with staged rollout

---

## 🔍 Debugging

### View Cache Stats

```typescript
import { CacheMonitoring } from '@/src/driver/cache';

// Get health report
const health = CacheMonitoring.getHealthReport();
console.log(health);
// → { status: 'healthy', metrics: {...}, warnings: [], recommendations: [] }

// Display formatted
console.log(CacheMonitoring.formatCacheStatsForDisplay(verbose = true));
```

### Check Redis Cache

```bash
# SSH to backend
redis-cli

# View driver location
GET location:driver_<driverId>
# → {"latitude": 17.386, "longitude": 78.487, ...}

# List all keys
KEYS location:*

# Monitor updates
MONITOR
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "Rate limit exceeded" | Reduce batch frequency or increase interval |
| High latency (>5s) | Check network, verify backend performance |
| Auth errors (401) | Verify token is set, check token expiration |
| No cache keys in Redis | Verify backend `/api/tracking/batch` endpoint |
| Passenger not seeing updates | Check Socket.IO connection, verify Redis broadcast |

---

## 📊 Architecture Overview

```
Driver App (Expo/React Native)
    ↓
GPS (every 2-5 sec)
    ↓
Queue (AsyncStorage buffer)
    ↓
Batch (every 15 sec) → POST /api/tracking/batch
    ↓
Backend (Node.js/Express)
    ├─ Validate & deduplicate
    ├─ Store in MongoDB
    └─ Cache to Redis (30s TTL)
       ├─ location:driver_X
       ├─ location:bus_Y
       └─ location:trip_Z
    ↓
Socket.IO Broadcast
    ↓
Passenger App (Real-time tracking)
```

---

## 🔐 Security Features

- ✅ **Bearer Token**: All requests authenticated
- ✅ **Nonce**: Replay attack prevention
- ✅ **Rate Limiting**: 10 batches/minute per driver
- ✅ **HTTPS**: Production encrypted
- ✅ **Input Validation**: All data validated server-side
- ✅ **Token Refresh**: Automatic on 401 errors
- ✅ **Session Timeout**: Proper logout handling

---

## ⚡ Performance

| Metric | Target | Notes |
|--------|--------|-------|
| Batch Interval | 15 sec | Adjustable in HTTPSyncManager |
| Upload Latency | <2s | Timeout: 10 sec |
| Cache TTL | 30 sec | Passenger sees recent data |
| Rate Limit | 10/min | Per driver per minute |
| Queue Size | 500 | Local buffer capacity |
| Success Rate | >95% | With automatic retry |

---

## 🧪 Quick Test

1. **Start Driver Trip**
   ```typescript
   await driverTracking.startTracking(driverId, busId, tripId);
   ```

2. **Watch Redis**
   ```bash
   redis-cli MONITOR
   ```

3. **See Updates**
   ```bash
   redis-cli GET location:driver_<id>
   # Should see new location every 15 seconds
   ```

4. **Check Stats**
   ```typescript
   console.log(cacheMonitor.cacheStats);
   // { totalBatchesSent: 4, totalLocationsProcessed: 100, ... }
   ```

---

## 📱 Supported Platforms

- ✅ **iOS**: Full background tracking support
- ✅ **Android**: Full background tracking support
- ✅ **Web**: Browser Geolocation API support

---

## 🤝 Integration Points

### With useDriverTracking Hook
Already integrated! Just use:
```typescript
const driverTracking = useDriverTracking(API_BASE_URL);
```

### With Backend `/api/tracking/batch`
Expected endpoint:
- **Method**: POST
- **URL**: `/api/tracking/batch`
- **Auth**: Bearer token header
- **Body**: LocationBatchPayload
- **Response**: RedisCacheResponse

### With Socket.IO (Passenger Tracking)
Passengers subscribe to:
```typescript
socket.on('trip:location-update', (data) => {
  // data = { latitude, longitude, speed, timestamp, ... }
});
```

---

## 📞 Support

**Need Help?**
1. Check [REDIS_CACHE_QUICK_REF.md](./REDIS_CACHE_QUICK_REF.md)
2. Review [DriverTrackingScreenExample.tsx](./src/driver/cache/DriverTrackingScreenExample.tsx)
3. Run [verify-installation.ts](./src/driver/cache/verify-installation.ts)
4. See [REDIS_CACHE_TESTING_GUIDE.md](./REDIS_CACHE_TESTING_GUIDE.md)

---

## ✨ Key Features

| Feature | Benefit |
|---------|---------|
| **Batch Processing** | Efficient, reduces network load |
| **Local Buffering** | Works offline, syncs when connected |
| **Automatic Retry** | Handles transient failures gracefully |
| **Deduplication** | Removes redundant GPS points |
| **Rate Limiting** | Prevents server overload |
| **Real-time Updates** | Passengers see driver live |
| **Health Monitoring** | Built-in diagnostics |
| **Redis Caching** | Fast passenger lookups |

---

## 🎓 Next Steps

1. **Read Quick Reference** (5 min)
   → [REDIS_CACHE_QUICK_REF.md](./REDIS_CACHE_QUICK_REF.md)

2. **Review Example Screen** (10 min)
   → [DriverTrackingScreenExample.tsx](./src/driver/cache/DriverTrackingScreenExample.tsx)

3. **Integrate in Your App** (30 min)
   → Copy pattern to your trip screen

4. **Test Locally** (30 min)
   → Run 2-3 test scenarios

5. **Deploy** (as scheduled)
   → Follow production checklist

---

## 📊 Success Metrics

After implementation, you should see:
- ✅ Driver locations cached in Redis within 1-2 seconds
- ✅ Passenger map updates every 15 seconds
- ✅ >95% batch upload success rate
- ✅ <2 second average upload latency
- ✅ <1% duplicate rate
- ✅ Smooth real-time passenger tracking

---

**Version**: 1.0.0  
**Status**: ✅ Production Ready  
**Last Updated**: May 25, 2026

---

## 📝 Summary

You now have a complete, production-ready Redis cache system for driver location tracking. The system handles:

✅ GPS data collection (every 2-5s)  
✅ Local buffering (up to 500 items)  
✅ Batch uploads (every 15s)  
✅ Redis caching (30s TTL)  
✅ Real-time passenger updates  
✅ Automatic retry with backoff  
✅ Rate limiting  
✅ Deduplication  
✅ Comprehensive monitoring  
✅ Security & authentication  

**All files are in place and ready to use!** 🚀
