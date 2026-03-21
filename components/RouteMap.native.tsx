import polylineLib from "@mapbox/polyline";
import React, { useEffect, useMemo, useRef } from "react";
import MapView, { Marker, Polyline } from "react-native-maps";

type Coord = { latitude: number; longitude: number };
type StopStatus = "passed" | "next" | "upcoming";

type RouteMapProps = {
  /** Pre-decoded fallback coordinates. */
  coordinates: Coord[];
  stops?: (Coord & {
    name?: string;
    sequenceOrder?: number;
    status?: StopStatus;
  })[];
  currentLocation?: Coord;
  /**
   * The exact encodedPolyline stored by admin.
   * When provided this is decoded here and used as the route path,
   * ensuring the map always shows the stored route through all stops
   * regardless of what was pre-decoded upstream.
   */
  encodedPolyline?: string;
};

export default function RouteMap({
  coordinates: coordinatesProp,
  stops = [],
  currentLocation,
  encodedPolyline,
}: RouteMapProps) {
  const mapRef = useRef<MapView | null>(null);

  const isFiniteCoord = (point?: Partial<Coord> | null): point is Coord => {
    if (!point) {
      return false;
    }

    return (
      typeof point.latitude === "number" &&
      Number.isFinite(point.latitude) &&
      typeof point.longitude === "number" &&
      Number.isFinite(point.longitude)
    );
  };

  // Decode stored route polyline directly — this is the single source of truth.
  // Falls back to coordinatesProp only when no encodedPolyline is available.
  const coordinates = useMemo<Coord[]>(() => {
    if (encodedPolyline) {
      try {
        const decoded = polylineLib.decode(encodedPolyline) as [
          number,
          number,
        ][];
        if (decoded.length > 0) {
          const fromPolyline = decoded
            .map(([latitude, longitude]) => ({ latitude, longitude }))
            .filter((point) => isFiniteCoord(point));

          if (fromPolyline.length > 0) {
            return fromPolyline;
          }
        }
      } catch {
        // Fallback to upstream coordinates when backend polyline is malformed.
      }
    }
    return (coordinatesProp ?? []).filter((point) => isFiniteCoord(point));
  }, [encodedPolyline, coordinatesProp]);

  const validStops = useMemo(() => {
    return (stops ?? []).filter((stop) => isFiniteCoord(stop));
  }, [stops]);

  const validCurrentLocation = isFiniteCoord(currentLocation) ? currentLocation : undefined;

  const pointsForRegion = useMemo<Coord[]>(() => {
    return [
      ...coordinates,
      ...validStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
      ...(validCurrentLocation ? [validCurrentLocation] : []),
    ];
  }, [coordinates, validCurrentLocation, validStops]);

  const initialRegion = useMemo(() => {
    const routePoints: Coord[] = pointsForRegion;
    if (!routePoints.length) {
      return {
        latitude: 17.385,
        longitude: 78.4867,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      };
    }

    const latitudes = routePoints.map((p) => p.latitude);
    const longitudes = routePoints.map((p) => p.longitude);

    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    return {
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.01),
      longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.01),
    };
  }, [pointsForRegion]);

  useEffect(() => {
    if (!mapRef.current || !pointsForRegion.length) {
      return;
    }

    try {
      mapRef.current.fitToCoordinates(pointsForRegion, {
        animated: true,
        edgePadding: {
          top: 44,
          right: 44,
          bottom: 44,
          left: 44,
        },
      });
    } catch {
      // MapView can throw if called before fully mounted; initialRegion still keeps map visible.
    }
  }, [pointsForRegion]);

  const stopPinColor = (status?: StopStatus) => {
    if (status === "passed") return "#10b981";
    if (status === "next") return "#1847BA";
    return "#f59e0b";
  };

  return (
    <MapView
      ref={(instance) => {
        mapRef.current = instance;
      }}
      style={{ flex: 1 }}
      initialRegion={initialRegion}
    >
      {/* Start marker */}
      {coordinates[0] ? (
        <Marker
          coordinate={coordinates[0]}
          title="Start"
          pinColor="#22c55e"
          tracksViewChanges={false}
        />
      ) : null}

      {/* Stop markers — rendered at their exact stored coordinates */}
      {validStops.map((stop, index) => (
        <Marker
          key={`stop-${index}-${stop.sequenceOrder ?? "na"}`}
          coordinate={stop}
          title={`${stop.sequenceOrder != null ? `${stop.sequenceOrder}. ` : ""}${stop.name || `Stop ${index + 1}`}`}
          description={
            stop.status === "next"
              ? "Next Stop"
              : stop.status === "passed"
                ? "Passed"
                : "Upcoming"
          }
          pinColor={stopPinColor(stop.status)}
          tracksViewChanges={false}
        />
      ))}

      {/* End marker */}
      {coordinates.length > 1 ? (
        <Marker
          coordinate={coordinates[coordinates.length - 1]}
          title="Destination"
          pinColor="#ef4444"
          tracksViewChanges={false}
        />
      ) : null}

      {/* Route polyline — decoded from stored admin encodedPolyline, passes through every stop */}
      {coordinates.length > 1 ? (
        <Polyline
          coordinates={coordinates}
          strokeColor="#1a73e8"
          strokeWidth={4}
          geodesic
        />
      ) : null}

      {/* Live bus marker */}
      {validCurrentLocation ? (
        <Marker
          coordinate={validCurrentLocation}
          title="Bus"
          pinColor="#2563eb"
        />
      ) : null}
    </MapView>
  );
}
