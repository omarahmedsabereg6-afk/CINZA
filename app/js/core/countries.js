/**
 * Country code normalization and localized names.
 * Supports ISO 3166-1 alpha-2 codes and full country names.
 */

export const KNOWN_COUNTRIES = [
  { code: 'US', name: 'United States', language: 'en-US' },
  { code: 'GB', name: 'United Kingdom', language: 'en-GB' },
  { code: 'CA', name: 'Canada', language: 'en-CA' },
  { code: 'AU', name: 'Australia', language: 'en-AU' },
  { code: 'DE', name: 'Germany', language: 'de-DE' },
  { code: 'FR', name: 'France', language: 'fr-FR' },
  { code: 'ES', name: 'Spain', language: 'es-ES' },
  { code: 'IT', name: 'Italy', language: 'it-IT' },
  { code: 'PT', name: 'Portugal', language: 'pt-PT' },
  { code: 'BR', name: 'Brazil', language: 'pt-BR' },
  { code: 'MX', name: 'Mexico', language: 'es-MX' },
  { code: 'AR', name: 'Argentina', language: 'es-AR' },
  { code: 'NL', name: 'Netherlands', language: 'nl-NL' },
  { code: 'SE', name: 'Sweden', language: 'sv-SE' },
  { code: 'PL', name: 'Poland', language: 'pl-PL' },
  { code: 'TR', name: 'Türkiye', language: 'tr-TR' },
  { code: 'EG', name: 'Egypt', language: 'ar-EG' },
  { code: 'SA', name: 'Saudi Arabia', language: 'ar-SA' },
  { code: 'AE', name: 'United Arab Emirates', language: 'ar-AE' },
  { code: 'KW', name: 'Kuwait', language: 'ar-KW' },
  { code: 'QA', name: 'Qatar', language: 'ar-QA' },
  { code: 'BH', name: 'Bahrain', language: 'ar-BH' },
  { code: 'OM', name: 'Oman', language: 'ar-OM' },
  { code: 'JO', name: 'Jordan', language: 'ar-JO' },
  { code: 'LB', name: 'Lebanon', language: 'ar-LB' },
  { code: 'IQ', name: 'Iraq', language: 'ar-IQ' },
  { code: 'MA', name: 'Morocco', language: 'ar-MA' },
  { code: 'DZ', name: 'Algeria', language: 'ar-DZ' },
  { code: 'TN', name: 'Tunisia', language: 'ar-TN' },
  { code: 'IN', name: 'India', language: 'hi-IN' },
  { code: 'JP', name: 'Japan', language: 'ja-JP' },
  { code: 'KR', name: 'South Korea', language: 'ko-KR' },
  { code: 'CH', name: 'Switzerland', language: 'de-CH' },
  { code: 'BE', name: 'Belgium', language: 'nl-BE' },
  { code: 'AT', name: 'Austria', language: 'de-AT' },
  { code: 'NO', name: 'Norway', language: 'no-NO' },
  { code: 'DK', name: 'Denmark', language: 'da-DK' },
  { code: 'FI', name: 'Finland', language: 'fi-FI' },
  { code: 'IE', name: 'Ireland', language: 'en-IE' },
  { code: 'NZ', name: 'New Zealand', language: 'en-NZ' },
  { code: 'ZA', name: 'South Africa', language: 'en-ZA' },
];

const COUNTRY_MAP = new Map();
for (const c of KNOWN_COUNTRIES) {
  COUNTRY_MAP.set(c.name.toLowerCase(), c.code);
  COUNTRY_MAP.set(c.code.toLowerCase(), c.code);
}

const COMMON_ALIASES = {
  usa: 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  uae: 'AE',
  emirates: 'AE',
  ksa: 'SA',
  turkey: 'TR',
  korea: 'KR',
  'republic of korea': 'KR',
  'مصر': 'EG',
  'السعودية': 'SA',
  'المملكة العربية السعودية': 'SA',
  'الإمارات': 'AE',
  'الامارات': 'AE',
  'الكويت': 'KW',
  'قطر': 'QA',
  'البحرين': 'BH',
  'عمان': 'OM',
  'الأردن': 'JO',
  'لبنان': 'LB',
  'العراق': 'IQ',
  'المغرب': 'MA',
  'الجزائر': 'DZ',
  'تونس': 'TN',
};

for (const [alias, code] of Object.entries(COMMON_ALIASES)) {
  COUNTRY_MAP.set(alias.toLowerCase(), code);
}

let displayNames = null;
try {
  if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
    displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  }
} catch {
  // fallback
}

export function countryFlag(code) {
  if (!code || typeof code !== 'string') return '🌐';
  const clean = code.trim().toUpperCase();
  if (clean.length !== 2) return '🌐';
  try {
    return String.fromCodePoint(
      127397 + clean.charCodeAt(0),
      127397 + clean.charCodeAt(1)
    );
  } catch {
    return '🌐';
  }
}

export function toCountryCode(input, fallback = 'US') {
  if (!input) return fallback;
  const raw = String(input).trim();
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  if (KNOWN_COUNTRIES.some((c) => c.code === upper)) {
    return upper;
  }
  const clean = raw.toLowerCase();
  if (COUNTRY_MAP.has(clean)) {
    return COUNTRY_MAP.get(clean);
  }
  for (const [name, code] of COUNTRY_MAP.entries()) {
    if (name === clean) return code;
  }
  for (const [name, code] of COUNTRY_MAP.entries()) {
    if (clean.startsWith(name) || name.startsWith(clean)) return code;
  }
  return fallback;
}

export function countryName(code) {
  if (!code) return 'Unknown country';
  const upper = String(code).trim().toUpperCase();
  const known = KNOWN_COUNTRIES.find((c) => c.code === upper);
  if (known) return known.name;
  if (displayNames) {
    try {
      const display = displayNames.of(upper);
      if (display && display !== upper) return display;
    } catch {
      // ignore
    }
  }
  return upper;
}

export default {
  KNOWN_COUNTRIES,
  toCountryCode,
  countryName,
  countryFlag,
};
