/** Blocks contact exchange & off-platform deals in mission descriptions */

export const MISSION_DESCRIPTION_POLICY_ERROR =
  'Exchange of contact info or cash deals is forbidden. Use the platform for payments.';

/** 8+ consecutive digits (phone / long numbers) */
const PHONE_OR_LONG_DIGITS = /\d{8,}/;

/** URLs and common TLD hints */
const URL_LIKE =
  /https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b|\.co\b|\.app\b|\.me\b|\.eg\b|t\.me\/|telegram\.|wa\.me\/|@[a-z0-9._-]+\.[a-z]{2,}/i;

function hasForbiddenKeyword(s: string): boolean {
  const lower = s.toLowerCase();
  if (/\bcash\b/i.test(s) || /\bmoney\b/i.test(lower)) return true;
  if (/кеш/i.test(s) || /номер/i.test(s)) return true;
  return false;
}

/** Regexes for find-and-replace text filtering (applied automatically) */
const PHONE_INTL = /\+?\d{1,4}[\s\-\.()]*\d{2,4}[\s\-\.()]*\d{2,4}[\s\-\.()]*\d{2,4}[\s\-\.()]*\d{2,4}([\s\-\.()]*\d+)?/g;
const PHONE_EGYPT = /\b01[0125][\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/g;
const PHONE_UA = /\+380[\s\-\.()]*\d{2}[\s\-\.()]*\d{3}[\s\-\.()]*\d{2}[\s\-\.()]*\d{2}/g;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL =
  /https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]*|wa\.me\/[^\s]*|telegram\.me\/[^\s]*|wa\.whatsapp\.com\/[^\s]*|\b[a-zA-Z0-9][-a-zA-Z0-9.]*\.(com|net|org|io|co|me|eg|ru|ua)(\/[^\s]*)?/gi;

/** Cash / numbers (English, Russian, Arabic) — replace with *** */
const CASH_NUMBERS_PATTERNS: RegExp[] = [
  /\bcash\b/gi,
  /\b(кеш|кэш)\b/gi,
  /(كاش|كَاش)/gi,
  /\b(номер|номера|номерам)\b/gi,
  /(ارقام|أرقام|رقم)\b/gi,
];

/** Minimal blacklist (Russian/Arabic profanity) — replace with *** */
const PROFANITY_PATTERNS: RegExp[] = [
  /\b(сука|блять|хуй|пизда|ебать|ебал|хер|гондо|мудак)\b/gi,
  /\b(бля|бл[яа])\b/gi,
  /(كس|شرموطة|زبي|طيز)\b/gi,
];

/** Keywords that trigger textWarning (contacts/cash deals) — highlight description */
const WARNING_KEYWORDS = [
  /\bcash\b/i,
  /кеш/i,
  /\bobkhod\b/i,
  /в\s+обход/i,
  /\bcall\b/i,
  /звони/i,
  /\bномер\b/i,
  /\bphone\b/i,
  /\bтелефон\b/i,
  /\bwhatsapp\b/i,
  /\btelegram\b/i,
  /\bвацап\b/i,
  /\bватсап\b/i,
];

const CENSOR = '***';

function replaceAll(text: string, patterns: RegExp[], replacement: string): string {
  let out = text;
  for (const p of patterns) {
    out = out.replace(p, replacement);
  }
  return out;
}

/** i18n key for optional toast when description looks like contact solicitation */
export const DESCRIPTION_CONTACT_WARNING_I18N_KEY = 'descriptionContactWarning' as const;

export type FilterMissionDescriptionResult = {
  filteredText: string;
  /** Pass to `t(textWarningKey)` in UI — do not show raw strings */
  textWarningKey?: typeof DESCRIPTION_CONTACT_WARNING_I18N_KEY;
};

/** Clean text: replace phones, links, cash/numbers (EN/RU/AR) with ***. */
export function cleanText(text: string): string {
  const s = String(text || '');
  let out = s
    .replace(PHONE_INTL, CENSOR)
    .replace(PHONE_EGYPT, CENSOR)
    .replace(PHONE_UA, CENSOR)
    .replace(EMAIL, CENSOR)
    .replace(URL, CENSOR);
  out = replaceAll(out, CASH_NUMBERS_PATTERNS, CENSOR);
  out = replaceAll(out, PROFANITY_PATTERNS, CENSOR);
  return out;
}

/**
 * Filter mission description: uses cleanText; if warning keywords found, return textWarning.
 */
export function filterMissionDescription(text: string): FilterMissionDescriptionResult {
  const s = String(text || '');
  let filtered = cleanText(s);

  const hasWarning = WARNING_KEYWORDS.some((re) => re.test(s));
  const textWarningKey = hasWarning ? DESCRIPTION_CONTACT_WARNING_I18N_KEY : undefined;

  return { filteredText: filtered, textWarningKey };
}

/** True if text looks like a phone / long number / external contact (for live UI warnings). */
export function descriptionLooksLikeContactOrPhone(text: string): boolean {
  const s = String(text || '');
  if (PHONE_OR_LONG_DIGITS.test(s)) return true;
  if (/\+[\d\s().-]{6,}/.test(s)) return true;
  if (/\b01[0125][0-9]{8}\b/.test(s)) return true;
  return false;
}

export function validateMissionDescription(text: string): { ok: true } | { ok: false; error: string } {
  const s = String(text || '');
  if (PHONE_OR_LONG_DIGITS.test(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  if (URL_LIKE.test(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  if (hasForbiddenKeyword(s)) {
    return { ok: false, error: MISSION_DESCRIPTION_POLICY_ERROR };
  }
  return { ok: true };
}
