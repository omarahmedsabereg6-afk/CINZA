/**
 * Presentation formatters. Every one tolerates null/undefined and returns an em
 * dash or empty string rather than "undefined" or "NaN" appearing in the UI.
 */

const DASH = '—';

export function year(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? String(n) : '';
}

/** "2008 · Movie · 2h 32m" pieces, so callers can insert their own separators. */
export function runtime(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const hours = Math.floor(n / 60);
  const mins = n % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function mediaTypeLabel(type) {
  return type === 'tv' ? 'Series' : type === 'movie' ? 'Movie' : '';
}

export function yearRange(start, end) {
  const from = year(start);
  if (!from) return '';
  const to = year(end);
  if (!to || to === from) return from;
  return `${from}–${to}`;
}

/** "2.1k", "18k" — keeps vote counts from stretching layouts. */
export function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function voteAverage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(1);
}

const DATE_FORMAT = { day: 'numeric', month: 'short' };
const DATE_TIME_FORMAT = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

/** "Just now", "12m ago", "Yesterday", "3 Mar", "3 Mar 2024". */
export function relativeDate(input) {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - date.getTime()) / 86_400_000);
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 6) return `${dayDiff} days ago`;

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? DATE_FORMAT : { ...DATE_FORMAT, year: 'numeric' });
}

export function shortDateTime(input) {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, DATE_TIME_FORMAT);
}

/** Seconds -> "01:21:43" (used only when a real timestamp exists). */
export function timestamp(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '';
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Milliseconds -> "917 ms" / "2.4 s". */
export function duration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} s`;
}

export function fileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function dimensions(width, height) {
  if (!width || !height) return '';
  return `${width}×${height}`;
}

export function percent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DASH;
  return `${n.toFixed(digits)}%`;
}

export function list(values, { limit = 3, fallback = DASH } = {}) {
  const items = (values ?? []).filter(Boolean);
  if (items.length === 0) return fallback;
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} +${items.length - limit}`;
}

export function seasonEpisode(seasonNumber, episodeNumber) {
  if (seasonNumber == null && episodeNumber == null) return '';
  const s = seasonNumber != null ? `S${String(seasonNumber).padStart(2, '0')}` : '';
  const e = episodeNumber != null ? `E${String(episodeNumber).padStart(2, '0')}` : '';
  return `${s}${e}`;
}

/** Confidence band -> the class suffix used by .pill--* / .confidence[data-verdict]. */
export function verdictClass(verdict) {
  return ['strong', 'likely', 'uncertain', 'none'].includes(verdict) ? verdict : 'uncertain';
}

export function verdictIcon(verdict) {
  if (verdict === 'strong' || verdict === 'likely') return 'i-eye';
  return 'i-info';
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Human label for the media type badge on provider groups. */
export function categoryLabel(category) {
  return { stream: 'Stream', rent: 'Rent', buy: 'Buy' }[category] ?? category;
}

export { DASH };
export default {
  year,
  runtime,
  mediaTypeLabel,
  yearRange,
  compactNumber,
  voteAverage,
  relativeDate,
  shortDateTime,
  timestamp,
  duration,
  fileSize,
  dimensions,
  percent,
  list,
  seasonEpisode,
  verdictClass,
  verdictIcon,
  initials,
  categoryLabel,
};
