/** Approximate centers for marketplace city filter (Montenegro) */

export type MarketplaceCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
};

export const MARKETPLACE_REGION_MONTENEGRO = 'montenegro';

export const MONTENEGRO_MARKETPLACE_CITIES: MarketplaceCity[] = [
  { id: 'podgorica', name: 'Podgorica', lat: 42.4411, lng: 19.2636, radiusKm: 25 },
  { id: 'budva', name: 'Budva', lat: 42.2864, lng: 18.84, radiusKm: 18 },
  { id: 'tivat', name: 'Tivat', lat: 42.4364, lng: 18.6961, radiusKm: 16 },
  { id: 'bar', name: 'Bar', lat: 42.0931, lng: 19.1003, radiusKm: 18 },
  { id: 'kotor', name: 'Kotor', lat: 42.4247, lng: 18.7712, radiusKm: 14 },
];

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function missionWithinCity(
  missionLat: number | null | undefined,
  missionLng: number | null | undefined,
  city: MarketplaceCity
): boolean {
  if (missionLat == null || missionLng == null) return false;
  if (!Number.isFinite(missionLat) || !Number.isFinite(missionLng)) return false;
  const d = haversineKm(missionLat, missionLng, city.lat, city.lng);
  return d <= city.radiusKm;
}

