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

export type TripStatus =
  | "PENDING"
  | "STARTED"
  | "RUNNING"
  | "STOPPED"
  | "COMPLETED"
  | "CANCELLED";

export interface ActiveTrip {
  id: string;
  status: TripStatus | string;
  busId?: string;
  routeId?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
}

export interface DriverBus {
  id: string;
  numberPlate: string;
}

export interface DriverRoute {
  id: string;
  name: string;
  encodedPolyline: string;
  totalDistanceMeters?: number;
  estimatedDurationSeconds?: number;
  totalDistanceText?: string;
  estimatedDurationText?: string;
  etaToDestinationSeconds?: number;
  etaToDestinationText?: string;
  distanceToDestinationMeters?: number;
  distanceToDestinationText?: string;
  averageSpeedKmph?: number;
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
  distanceFromCurrentMeters?: number;
  distanceFromCurrentText?: string;
  etaFromCurrentSeconds?: number;
  etaFromCurrentText?: string;
  segmentDistanceMeters?: number;
  segmentDistanceText?: string;
  segmentEtaSeconds?: number;
  segmentEtaText?: string;
  isPassed?: boolean;
}

export interface DriverMyRouteResponse {
  bus: DriverBus;
  route: DriverRoute;
  stops: DriverStop[];
}

export interface DriverProfile {
  id: string;
  name: string;
  role: string;
}

export interface DriverMeResponse {
  driver?: DriverProfile;
  bus?: DriverBus | null;
  route?: DriverRoute | null;
  stops?: DriverStop[];
}

/* ── User-facing types ─────────────────────────────── */

export interface BusSearchResult {
  busId: string;
  numberPlate: string;
  routeName: string;
  routeId?: string;
  tripStatus?: TripStatus | string | null;
  lastUpdated?: string | null;
  isActive: boolean;
}

export interface BusLiveStatus {
  busId: string;
  numberPlate: string;
  routeName: string;
  routeId?: string;
  trip?: {
    id?: string;
    status?: TripStatus | string;
  };
  encodedPolyline: string;
  routeStartLat?: number | null;
  routeStartLng?: number | null;
  routeStartName?: string | null;
  routeEndLat?: number | null;
  routeEndLng?: number | null;
  routeEndName?: string | null;
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
  totalDistanceMeters?: number;
  estimatedDurationSeconds?: number;
  totalDistanceText?: string;
  estimatedDurationText?: string;
  etaToDestinationSeconds?: number;
  etaToDestinationText?: string;
  distanceToDestinationMeters?: number;
  distanceToDestinationText?: string;
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
