/** Stored in `photo_urls` when the original image failed safety moderation (not a real URL). */
export const MISSION_PHOTO_CENSORED_PLACEHOLDER = 'censored://explicit/v1';

export function isCensoredMissionPhotoUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url) return false;
  return url.startsWith('censored://');
}
