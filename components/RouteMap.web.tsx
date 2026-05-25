import polylineLib from "@mapbox/polyline";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline as SvgPolyline } from "react-native-svg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LatLng = { lat: number; lng: number };
const DEFAULT_FALLBACK_CENTER: LatLng = { lat: 17.385, lng: 78.4867 };
type StopStatus = "passed" | "next" | "upcoming";

type RouteMapProps = {
  coordinates: { latitude: number; longitude: number }[];
  stops?: {
    latitude: number;
    longitude: number;
    name?: string;
    sequenceOrder?: number;
    status?: StopStatus;
  }[];
  currentLocation?: { latitude: number; longitude: number };
  /** Raw encoded polyline from backend. When provided it is decoded and used
   *  directly — no Directions API call is made. Falls back to `coordinates`. */
  encodedPolyline?: string;
};

const ROUTE_LINE_GLOW = "rgba(77,124,15,0.18)";
const ROUTE_LINE_CORE = "rgba(77,124,15,0.4)";
const ROUTE_LINE_ACCENT = "rgba(77,124,15,0.25)";
const STREET_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#eff3f8" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#334155" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d5deea" }],
  },
  {
    featureType: "poi",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#ffffff" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#f5f8fc" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#dce9ff" }],
  },
  {
    featureType: "transit",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#c7e2ff" }],
  },
];

const LIVE_BUS_MARKER_SVG = encodeURIComponent(`
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="24" r="20" fill="rgba(37,99,235,0.22)"/>
  <circle cx="24" cy="24" r="16" fill="#FFFFFF"/>
  <circle cx="24" cy="24" r="12" fill="#2563EB"/>
  <path d="M24 16 L29 26 L24 24 L19 26 Z" fill="#FFFFFF"/>
</svg>
`);

const STOP_MARKER_SVGS: Record<StopStatus, string> = {
  passed: encodeURIComponent(`
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="12" fill="rgba(16,185,129,0.2)"/>
      <circle cx="14" cy="14" r="9" fill="#FFFFFF" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>
      <circle cx="14" cy="14" r="5" fill="#10b981"/>
    </svg>
  `),
  next: encodeURIComponent(`
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="12" fill="rgba(24,71,186,0.2)"/>
      <circle cx="14" cy="14" r="9" fill="#FFFFFF" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>
      <circle cx="14" cy="14" r="5" fill="#1847BA"/>
    </svg>
  `),
  upcoming: encodeURIComponent(`
    <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="12" fill="rgba(245,158,11,0.22)"/>
      <circle cx="14" cy="14" r="9" fill="#FFFFFF" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>
      <circle cx="14" cy="14" r="5" fill="#f59e0b"/>
    </svg>
  `),
};

const stopMarkerFill = (status?: StopStatus) => {
  if (status === "passed") return "#10b981";
  if (status === "next") return "#1847BA";
  return "#f59e0b";
};

const stopMarkerHalo = (status?: StopStatus) => {
  if (status === "passed") return "rgba(16,185,129,0.2)";
  if (status === "next") return "rgba(24,71,186,0.2)";
  return "rgba(245,158,11,0.22)";
};

// ---------------------------------------------------------------------------
// Google Maps JS API loader (singleton promise)
// ---------------------------------------------------------------------------

let _mapsPromise: Promise<void> | null = null;

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (_mapsPromise) return _mapsPromise;

  _mapsPromise = new Promise<void>((resolve) => {
    // Already loaded by another part of the app
    if (typeof window !== "undefined" && (window as any).google?.maps) {
      resolve();
      return;
    }

    const callbackName = "__gmInitCb";
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      _mapsPromise = null; // allow retry on next mount
      resolve(); // resolve anyway so the component doesn't hang
    };
    document.head.appendChild(script);
  });

  return _mapsPromise;
}

// ---------------------------------------------------------------------------
// SVG fallback (no API key or load error)
// ---------------------------------------------------------------------------

function SvgFallback({
  coordinates,
  stops,
  currentLocation,
}: Pick<RouteMapProps, "coordinates" | "stops" | "currentLocation">) {
  const projection = useMemo(() => {
    const allPoints = [
      ...coordinates,
      ...(stops ?? []).map((s) => ({
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      ...(currentLocation ? [currentLocation] : []),
    ];

    if (!allPoints.length) {
      return {
        routePoints: [],
        stopPoints: [],
        currentPoint: null,
      };
    }

    const lats = allPoints.map((p) => p.latitude);
    const lngs = allPoints.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latRange = Math.max(maxLat - minLat, 0.0001);
    const lngRange = Math.max(maxLng - minLng, 0.0001);

    const W = 1000;
    const H = 500;
    const P = 28;

    const toScreen = (p: { latitude: number; longitude: number }) => ({
      x: P + ((p.longitude - minLng) / lngRange) * (W - P * 2),
      y: H - P - ((p.latitude - minLat) / latRange) * (H - P * 2),
    });

    return {
      routePoints: coordinates.map(toScreen),
      stopPoints: (stops ?? []).map((s) => ({ ...toScreen(s), name: s.name })),
      currentPoint: currentLocation ? toScreen(currentLocation) : null,
    };
  }, [coordinates, stops, currentLocation]);

  const { routePoints, stopPoints, currentPoint } = projection;

  return (
    <View className="flex-1 bg-slate-100">
      <Svg width="100%" height="100%" viewBox="0 0 1000 500">
        <SvgPolyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ROUTE_LINE_GLOW}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <SvgPolyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ROUTE_LINE_CORE}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <SvgPolyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={ROUTE_LINE_ACCENT}
          strokeWidth={1.8}
          strokeDasharray="2 10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {routePoints[0] && (
          <Circle
            cx={routePoints[0].x}
            cy={routePoints[0].y}
            r={10}
            fill="#22c55e"
          />
        )}
        {routePoints[routePoints.length - 1] && (
          <Circle
            cx={routePoints[routePoints.length - 1].x}
            cy={routePoints[routePoints.length - 1].y}
            r={10}
            fill="#ef4444"
          />
        )}
        {stopPoints.map((sp, i) => (
          <React.Fragment key={`stop-${i}`}>
            <Circle
              cx={sp.x}
              cy={sp.y}
              r={10}
              fill={stopMarkerHalo(stops?.[i]?.status)}
            />
            <Circle
              cx={sp.x}
              cy={sp.y}
              r={7}
              fill="#FFFFFF"
            />
            <Circle
              cx={sp.x}
              cy={sp.y}
              r={4}
              fill={stopMarkerFill(stops?.[i]?.status)}
            />
          </React.Fragment>
        ))}
        {currentPoint && (
          <>
            <Circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={13}
              fill="rgba(37,99,235,0.22)"
            />
            <Circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={10}
              fill="#FFFFFF"
            />
            <Circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={7}
              fill="#2563eb"
            />
          </>
        )}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RouteMap({
  coordinates,
  stops = [],
  currentLocation,
  encodedPolyline,
}: RouteMapProps) {
  const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  // Decode the stored route polyline — never calls Directions API
  const path = useMemo<LatLng[]>(() => {
    if (encodedPolyline) {
      try {
        const decoded = polylineLib.decode(encodedPolyline) as [
          number,
          number,
        ][];
        if (decoded.length > 0) {
          return decoded.map(([lat, lng]) => ({ lat, lng }));
        }
      } catch {
        // Fallback to pre-decoded coordinates when backend polyline is malformed.
      }
    }
    return coordinates.map(({ latitude, longitude }) => ({
      lat: latitude,
      lng: longitude,
    }));
  }, [encodedPolyline, coordinates]);

  const [mapsReady, setMapsReady] = useState(false);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const routePolylineGlowRef = useRef<any>(null);
  const routePolylineCoreRef = useRef<any>(null);
  const stopMarkersRef = useRef<any[]>([]);
  const endpointMarkersRef = useRef<{ start?: any; end?: any }>({});
  const busMarkerRef = useRef<any>(null);

  // Load Google Maps JS API once
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || typeof window === "undefined") return;
    loadGoogleMapsApi(GOOGLE_MAPS_API_KEY).then(() => {
      if ((window as any).google?.maps) setMapsReady(true);
    });
  }, [GOOGLE_MAPS_API_KEY]);

  // Initialize map and draw the stored-route polyline
  useEffect(() => {
    if (!mapsReady || !mapDivRef.current) return;

    const g = (window as any).google;

    // Create map only once
    if (!mapRef.current) {
      mapRef.current = new g.maps.Map(mapDivRef.current, {
        center: path[Math.floor(path.length / 2)] ?? DEFAULT_FALLBACK_CENTER,
        mapTypeId: "roadmap",
        styles: STREET_MAP_STYLE,
        zoom: 18,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
        minZoom: 18,
        maxZoom: 21,
      });
    }

    // Force zoom immediately after any content changes
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.setZoom(18);
      }
    }, 0);

    // Replace the route polyline (drawn from the stored encodedPolyline — exact admin route)
    if (routePolylineGlowRef.current) {
      routePolylineGlowRef.current.setMap(null);
      routePolylineGlowRef.current = null;
    }
    if (routePolylineCoreRef.current) {
      routePolylineCoreRef.current.setMap(null);
      routePolylineCoreRef.current = null;
    }
    if (path.length > 1) {
      routePolylineGlowRef.current = new g.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: ROUTE_LINE_GLOW,
        strokeOpacity: 1,
        strokeWeight: 11,
        zIndex: 20,
      });
      routePolylineGlowRef.current.setMap(mapRef.current);

      routePolylineCoreRef.current = new g.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: ROUTE_LINE_CORE,
        strokeOpacity: 1,
        strokeWeight: 5,
        zIndex: 21,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeColor: ROUTE_LINE_ACCENT,
              strokeOpacity: 1,
              scale: 2,
            },
            offset: "0",
            repeat: "14px",
          },
        ],
      });
      routePolylineCoreRef.current.setMap(mapRef.current);
    }

    // Start/end markers
    endpointMarkersRef.current.start?.setMap(null);
    endpointMarkersRef.current.end?.setMap(null);
    endpointMarkersRef.current.start = undefined;
    endpointMarkersRef.current.end = undefined;
    if (path.length > 0) {
      endpointMarkersRef.current.start = new g.maps.Marker({
        position: path[0],
        map: mapRef.current,
        title: "Start",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      endpointMarkersRef.current.end = new g.maps.Marker({
        position: path[path.length - 1],
        map: mapRef.current,
        title: "Destination",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    }

    // Ordered stop markers
    stopMarkersRef.current.forEach((marker) => marker.setMap(null));
    stopMarkersRef.current = (stops ?? []).map((stop, index) => {
      const markerSvg =
        stop.status === "passed"
          ? STOP_MARKER_SVGS.passed
          : stop.status === "next"
            ? STOP_MARKER_SVGS.next
            : STOP_MARKER_SVGS.upcoming;

      return new g.maps.Marker({
        position: { lat: stop.latitude, lng: stop.longitude },
        map: mapRef.current,
        title: `${stop.sequenceOrder != null ? `${stop.sequenceOrder}. ` : ""}${stop.name ?? `Stop ${index + 1}`}`,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${markerSvg}`,
          scaledSize: new g.maps.Size(28, 28),
          anchor: new g.maps.Point(14, 14),
        },
      });
    });

    // Center on route without aggressive zoom-out from fitBounds
    if (path.length > 0) {
      const centerPoint = path[Math.floor(path.length / 2)];
      if (centerPoint) {
        mapRef.current.setCenter(centerPoint);
      }
      // Preserve zoom 18 - don't use fitBounds as it zooms out
      mapRef.current.setZoom(18);
    } else {
      mapRef.current.setCenter(DEFAULT_FALLBACK_CENTER);
      mapRef.current.setZoom(18);
    }
  }, [mapsReady, path, stops]);

  // Update live bus marker whenever currentLocation changes
  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;

    const g = (window as any).google;

    if (busMarkerRef.current) {
      busMarkerRef.current.setMap(null);
      busMarkerRef.current = null;
    }

    if (currentLocation) {
      busMarkerRef.current = new g.maps.Marker({
        position: {
          lat: currentLocation.latitude,
          lng: currentLocation.longitude,
        },
        map: mapRef.current,
        title: "Bus",
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${LIVE_BUS_MARKER_SVG}`,
          scaledSize: new g.maps.Size(48, 48),
          anchor: new g.maps.Point(24, 24),
        },
        zIndex: 999,
      });
    }
  }, [mapsReady, currentLocation]);

  // Fallback: no API key — render plain SVG polyline
  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <SvgFallback
        coordinates={path.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
        stops={stops}
        currentLocation={currentLocation}
      />
    );
  }

  // Google Maps JS API map container
  return React.createElement("div", {
    ref: mapDivRef,
    style: { width: "100%", height: "100%", minHeight: 280 },
  });
}
