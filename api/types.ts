// Define TypeScript interfaces for API responses

export interface LoginRequest {
  role: string;
  memberId: string;
  password: string;
  organizationSlug?: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    role: string;
  };
}

export interface DriverBus {
  id: string;
  numberPlate: string;
}

export interface DriverRoute {
  id: string;
  name: string;
  encodedPolyline: string;
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  isActive: boolean;
}

export interface DriverStop {
  id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  sequenceOrder?: number;
}

export interface DriverMyRouteResponse {
  bus: DriverBus;
  route: DriverRoute;
  stops: DriverStop[];
}

/* ── User-facing types ─────────────────────────────── */

export interface BusSearchResult {
  busId: string;
  numberPlate: string;
  routeName: string;
  routeId?: string;
  isActive: boolean;
}

export interface BusLiveStatus {
  busId: string;
  numberPlate: string;
  routeName: string;
  routeId?: string;
  encodedPolyline: string;
  routeStartLat?: number | null;
  routeStartLng?: number | null;
  routeEndLat?: number | null;
  routeEndLng?: number | null;
  stops: DriverStop[];
  currentLat: number | null;
  currentLng: number | null;
  nextStop: string | null;
  estimatedArrival: string | null;
  fleetStatus?: string | null;
  tripStatus?: string | null;
  status?: string | null;
  trackingStatus?: string | null;
  lastUpdated?: string | null;
  isActive: boolean;
}

export interface AdminRoute {
  id: string;
  name: string;
  encodedPolyline: string;
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserSubscriptionRequest {
  busId: string;
  stopId?: string;
  notifyOnBusStart: boolean;
  notifyOnNearStop: boolean;
  userLatitude?: number;
  userLongitude?: number;
  nearRadiusMeters?: number;
}

export interface UserSubscription {
  id: string;
  busId: string;
  stopId?: string;
  notifyOnBusStart?: boolean;
  notifyOnNearStop?: boolean;
  userLatitude?: number;
  userLongitude?: number;
  nearRadiusMeters?: number;
  bus?: {
    id?: string;
    numberPlate?: string;
    routeName?: string;
    routeId?: string;
  };
  stop?: {
    id?: string;
    name?: string;
  };
}

export interface UserNotification {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  createdAt?: string;
  readAt?: string | null;
  isRead?: boolean;
}
