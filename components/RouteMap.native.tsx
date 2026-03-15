import polylineLib from "@mapbox/polyline";
import React, { useMemo } from "react";
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
  // Decode stored route polyline directly — this is the single source of truth.
  // Falls back to coordinatesProp only when no encodedPolyline is available.
  const coordinates = useMemo<Coord[]>(() => {
    if (encodedPolyline) {
      const decoded = polylineLib.decode(encodedPolyline) as [
        number,
        number,
      ][];
      if (decoded.length > 0) {
        return decoded.map(([latitude, longitude]) => ({
          latitude,
          longitude,
        }));
      }
    }
    return coordinatesProp;
  }, [encodedPolyline, coordinatesProp]);

  if (!coordinates.length) {
    return null;
  }

  const initialRegion = useMemo(() => {
    const routePoints: Coord[] = [...coordinates, ...stops];
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
  }, [coordinates, stops]);

  const stopPinColor = (status?: StopStatus) => {
    if (status === "passed") return "#10b981";
    if (status === "next") return "#1847BA";
    return "#f59e0b";
  };

  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={initialRegion}
    >
      {/* Start marker */}
      <Marker
        coordinate={coordinates[0]}
        title="Start"
        pinColor="#22c55e"
        tracksViewChanges={false}
      />

      {/* Stop markers — rendered at their exact stored coordinates */}
      {stops.map((stop, index) => (
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
      <Marker
        coordinate={coordinates[coordinates.length - 1]}
        title="Destination"
        pinColor="#ef4444"
        tracksViewChanges={false}
      />

      {/* Route polyline — decoded from stored admin encodedPolyline, passes through every stop */}
      <Polyline
        coordinates={coordinates}
        strokeColor="#1a73e8"
        strokeWidth={4}
        geodesic
      />

      {/* Live bus marker */}
      {currentLocation ? (
        <Marker
          coordinate={currentLocation}
          title="Bus"
          pinColor="#2563eb"
        />
      ) : null}
    </MapView>
  );
}
