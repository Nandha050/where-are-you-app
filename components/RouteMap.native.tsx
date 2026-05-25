import polylineLib from "@mapbox/polyline";
import React, { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
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

const stopColors = (status?: StopStatus) => {
  if (status === "passed") {
    return {
      halo: "rgba(16,185,129,0.2)",
      core: "#10b981",
    };
  }
  if (status === "next") {
    return {
      halo: "rgba(24,71,186,0.2)",
      core: "#1847BA",
    };
  }
  return {
    halo: "rgba(245,158,11,0.22)",
    core: "#f59e0b",
  };
};

const StopMarker = ({ status }: { status?: StopStatus }) => {
  const colors = stopColors(status);
  return (
    <View
      style={{
        width: 26,
        height: 26,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: colors.halo,
        }}
      />
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "rgba(15,23,42,0.08)",
        }}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: colors.core,
          }}
        />
      </View>
    </View>
  );
};

const LiveBusMarker = () => (
  <View
    style={{
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <View
      style={{
        position: "absolute",
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "rgba(59,130,246,0.35)",
      }}
    />
    <View
      style={{
        position: "absolute",
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "rgba(59,130,246,0.24)",
      }}
    />
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#0f172a",
        shadowOpacity: 0.25,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 6,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: "#2563eb",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: 5,
            borderRightWidth: 5,
            borderBottomWidth: 10,
            borderLeftColor: "transparent",
            borderRightColor: "transparent",
            borderBottomColor: "#FFFFFF",
            transform: [{ rotate: "18deg" }],
            marginLeft: 1,
          }}
        />
      </View>
    </View>
  </View>
);

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

  const focusPoint = useMemo<Coord>(() => {
    if (validCurrentLocation) {
      return validCurrentLocation;
    }

    if (validStops.length > 0) {
      return { latitude: validStops[0].latitude, longitude: validStops[0].longitude };
    }

    if (coordinates.length > 0) {
      return coordinates[Math.floor(coordinates.length / 2)];
    }

    return { latitude: 17.385, longitude: 78.4867 };
  }, [coordinates, validCurrentLocation, validStops]);

  const initialRegion = useMemo(() => {
    return {
      latitude: focusPoint.latitude,
      longitude: focusPoint.longitude,
      latitudeDelta: 0.003,
      longitudeDelta: 0.003,
    };
  }, [focusPoint]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    const pointsToFit = pointsForRegion.filter((point) => isFiniteCoord(point));

    if (pointsToFit.length > 1) {
      try {
        mapRef.current.fitToCoordinates(pointsToFit, {
          edgePadding: {
            top: 140,
            right: 48,
            bottom: 220,
            left: 48,
          },
          animated: true,
        });
        return;
      } catch {
        // Fall back to camera animation when fitToCoordinates is unavailable.
      }
    }

    try {
      mapRef.current.animateCamera(
        {
          center: focusPoint,
          zoom: 16,
          heading: 0,
          pitch: 0,
        },
        { duration: 450 },
      );
    } catch {
      try {
        mapRef.current.animateToRegion(
          {
            latitude: focusPoint.latitude,
            longitude: focusPoint.longitude,
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
          },
          450,
        );
      } catch {
        // Initial region remains as fallback.
      }
    }
  }, [focusPoint, pointsForRegion]);

  return (
    <MapView
      ref={(instance) => {
        mapRef.current = instance;
      }}
      style={{ flex: 1 }}
      mapType="standard"
      customMapStyle={STREET_MAP_STYLE}
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
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges
        >
          <StopMarker status={stop.status} />
        </Marker>
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
        <>
          <Polyline
            coordinates={coordinates}
            strokeColor={ROUTE_LINE_GLOW}
            strokeWidth={11}
            geodesic
          />
          <Polyline
            coordinates={coordinates}
            strokeColor={ROUTE_LINE_CORE}
            strokeWidth={5}
            geodesic
          />
          <Polyline
            coordinates={coordinates}
            strokeColor={ROUTE_LINE_ACCENT}
            strokeWidth={2.4}
            lineDashPattern={[3, 8]}
            geodesic
          />
        </>
      ) : null}

      {/* Live bus marker */}
      {validCurrentLocation ? (
        <Marker
          coordinate={validCurrentLocation}
          title="Bus"
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges
        >
          <LiveBusMarker />
        </Marker>
      ) : null}
    </MapView>
  );
}
