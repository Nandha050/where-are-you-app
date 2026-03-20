import polylineLib from "@mapbox/polyline";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline as SvgPolyline } from "react-native-svg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LatLng = { lat: number; lng: number };
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
      ...(stops ?? []).map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
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
          stroke="#1d4ed8"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {routePoints[0] && (
          <Circle cx={routePoints[0].x} cy={routePoints[0].y} r={10} fill="#22c55e" />
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
          <Circle
            key={`stop-${i}`}
            cx={sp.x}
            cy={sp.y}
            r={6}
            fill={
              stops?.[i]?.status === "passed"
                ? "#10b981"
                : stops?.[i]?.status === "next"
                  ? "#1847BA"
                  : "#f59e0b"
            }
          />
        ))}
        {currentPoint && (
          <Circle cx={currentPoint.x} cy={currentPoint.y} r={8} fill="#2563eb" />
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
  const fallbackCenter: LatLng = { lat: 17.385, lng: 78.4867 };

  // Decode the stored route polyline — never calls Directions API
  const path = useMemo<LatLng[]>(() => {
    if (encodedPolyline) {
      try {
        const decoded = polylineLib.decode(encodedPolyline) as [number, number][];
        if (decoded.length > 0) {
          return decoded.map(([lat, lng]) => ({ lat, lng }));
        }
      } catch {
        // Fallback to pre-decoded coordinates when backend polyline is malformed.
      }
    }
    return coordinates.map(({ latitude, longitude }) => ({ lat: latitude, lng: longitude }));
  }, [encodedPolyline, coordinates]);

  const [mapsReady, setMapsReady] = useState(false);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const routePolylineRef = useRef<any>(null);
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
        center: path[Math.floor(path.length / 2)] ?? fallbackCenter,
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
    }

    // Replace the route polyline (drawn from the stored encodedPolyline — exact admin route)
    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }
    if (path.length > 1) {
      routePolylineRef.current = new g.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: "#1a73e8",
        strokeOpacity: 1.0,
        strokeWeight: 4,
      });
      routePolylineRef.current.setMap(mapRef.current);
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
      const fillColor =
        stop.status === "passed"
          ? "#10b981"
          : stop.status === "next"
            ? "#1847BA"
            : "#f59e0b";

      return new g.maps.Marker({
        position: { lat: stop.latitude, lng: stop.longitude },
        map: mapRef.current,
        title: `${stop.sequenceOrder != null ? `${stop.sequenceOrder}. ` : ""}${stop.name ?? `Stop ${index + 1}`}`,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
    });

    // Fit the viewport to the full route
    if (path.length > 0) {
      const bounds = new g.maps.LatLngBounds();
      path.forEach((p: LatLng) => bounds.extend(p));
      mapRef.current.fitBounds(bounds);
    } else {
      mapRef.current.setCenter(fallbackCenter);
      mapRef.current.setZoom(12);
    }
  }, [fallbackCenter, mapsReady, path, stops]);

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
        position: { lat: currentLocation.latitude, lng: currentLocation.longitude },
        map: mapRef.current,
        title: "Bus",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#1a73e8",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
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
