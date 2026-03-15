type RouteMapProps = {
  coordinates: { latitude: number; longitude: number }[];
  stops?: {
    latitude: number;
    longitude: number;
    name?: string;
    sequenceOrder?: number;
    status?: "passed" | "next" | "upcoming";
  }[];
  currentLocation?: { latitude: number; longitude: number };
  encodedPolyline?: string;
};

export default function RouteMap(_props: RouteMapProps) {
  return null;
}
