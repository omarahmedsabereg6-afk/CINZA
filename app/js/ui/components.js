/**
 * Shared UI builders.
 *
 * Every repeating piece of UI in the app is built here so the markup and the
 * accessibility attributes stay consistent, and so screens only contain behaviour.
 */
import { el, icon, clear, delegate, on, raf } from '../core/dom.js';
import { renderComponent } from '../core/template.js';
import { mountArtwork, mountAvatar } from './artwork.js';
import { year, mediaTypeLabel, voteAverage, relativeDate, seasonEpisode, list } from '../core/format.js';

/* ------------------------------------------------------------------ *
 * Notices
 * ------------------------------------------------------------------ */

const BANNER_ICON = { info: 'i-info', warn: 'i-warning', error: 'i-warning', mock: 'i-warning' };

export async function banner({ variant = 'info', title, text, icon: iconName, role = 'status' }) {
  const { root } = await renderComponent('banner', {
    variant,
    title,
    text,
    icon: iconName ?? BANNER_ICON[variant] ?? 'i-info',
    role,
  });
  return root;
}

/** The mock-mode disclosure. Rendered anywhere a result could be simulated. */
export async function mockNotice(text) {
  if (!text) return null;
  return banner({
    variant: 'mock',
    title: 'Simulated result',
    text,
  });
}

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

/** Poster card. `href` makes it a link; otherwise pass `onSelect`. */
export function posterCard(item, { onSelect } = {}) {
  const card = el('button', { class: 'poster-card', type: 'button' });
  card.setAttribute('aria-label', `${item.title}${item.year ? ` (${item.year})` : ''}`);

  const art = el('span', { class: 'poster-card__art' });
  mountArtwork(art, { url: item.posterUrl ?? item.posterPath, title: item.title });

  const rating = voteAverage(item.voteAverage ?? item.rating);
  if (rating) {
    art.append(el('span', { class: 'poster-card__rating', text: `★ ${rating}` }));
  }

  card.append(art);

  card.append(el('span', { class: 'poster-card__title', text: item.title ?? 'Untitled' }));

  const meta = [year(item.year), mediaTypeLabel(item.mediaType)].filter(Boolean).join(' · ');
  if (meta) card.append(el('span', { class: 'poster-card__meta', text: meta }));

  on(card, 'click', () => onSelect?.(item));
  return card;
}

/** Compact horizontal row (search results, person known-for, episode lists). */
export function mediaRow(item, { onSelect, trailing, subtitle } = {}) {
  const row = el('button', { class: 'media-row', type: 'button' });
  row.setAttribute('aria-label', item.title ?? item.name ?? 'Open');

  const art = el('span', { class: 'media-row__art' });
  mountArtwork(art, { url: item.posterUrl ?? item.posterPath, title: item.title ?? item.name, compact: true });
  row.append(art);

  const text = el('span', { class: 'media-row__text' });
  text.append(el('span', { class: 'media-row__title', text: item.title ?? item.name ?? 'Untitled' }));

  const meta =
    subtitle ??
    [year(item.year), mediaTypeLabel(item.mediaType), voteAverage(item.voteAverage) ? `${voteAverage(item.voteAverage)} ★` : null]
      .filter(Boolean)
      .join(' · ');
  if (meta) text.append(el('span', { class: 'media-row__meta', text: meta }));
  row.append(text);

  if (trailing) {
    const slot = el('span', { class: 'media-row__trailing' });
    slot.append(trailing);
    row.append(slot);
  }

  on(row, 'click', () => onSelect?.(item));
  return row;
}

export function personPill(person) {
  const node = el('button', { class: 'person', type: 'button' });
  node.setAttribute('aria-label', person.name ?? 'Person');

  const avatar = el('span', { class: 'person__avatar' });
  mountAvatar(avatar, { url: person.profileUrl ?? person.profilePath, name: person.name });
  node.append(avatar);

  node.append(el('span', { class: 'person__name', text: person.name ?? '' }));
  if (person.character) node.append(el('span', { class: 'person__role', text: person.character }));

  return node;
}

/* ------------------------------------------------------------------ *
 * Confidence
 * ------------------------------------------------------------------ */

/**
 * Confidence meter.
 *
 * Deliberately communicates through THREE channels — bar length, numeric value and
 * the verdict label — so the meaning survives greyscale, colour-blindness and a
 * screen reader (section 39).
 */
export function confidenceMeter({ confidence = 0, verdict = 'uncertain', showValue = true } = {}) {
  const wrapper = el('div', { class: 'confidence', dataset: { verdict } });
  wrapper.setAttribute('role', 'meter');
  wrapper.setAttribute('aria-valuenow', String(Math.round(confidence)));
  wrapper.setAttribute('aria-valuemin', '0');
  wrapper.setAttribute('aria-valuemax', '100');
  wrapper.setAttribute('aria-label', 'Recognition confidence');

  const bar = el('div', { class: 'confidence__bar' });
  const fill = el('div', { class: 'confidence__fill' });
  bar.append(fill);
  wrapper.append(bar);

  if (showValue) wrapper.append(el('span', { class: 'confidence__value', text: `${Math.round(confidence)}%` }));

  // Animate the width after paint so the transition actually runs.
  requestAnimationFrame(() => {
    fill.style.width = `${Math.max(2, Math.min(100, confidence))}%`;
  });

  return wrapper;
}

export function verdictPill({ verdict = 'uncertain', label }) {
  const cls = { strong: 'pill--strong', likely: 'pill--likely', uncertain: 'pill--uncertain', none: 'pill--danger' }[verdict] ?? 'pill--uncertain';
  return el('span', { class: `pill ${cls}`, text: label ?? 'Uncertain' });
}

/* ------------------------------------------------------------------ *
 * Signals ("Why this match")
 * ------------------------------------------------------------------ */

export async function signalList(signals = []) {
  const container = el('div', { class: 'card' });
  const body = el('div', { class: 'card__body' });

  const sorted = [...signals].sort((a, b) => b.weight - a.weight);
  for (const signal of sorted) {
    const { root } = await renderComponent('signal', {
      name: labelForSignal(signal.signal),
      score: Math.round(signal.score),
      detail: signal.detail ?? '',
    });
    body.append(root);
  }

  container.append(body);
  return container;
}

function labelForSignal(key) {
  return (
    {
      title: 'Title match',
      actors: 'Cast match',
      characters: 'Character match',
      clues: 'Visual clues',
      year: 'Release year',
      genres: 'Genre',
      visibleText: 'On-screen text',
      contentType: 'Format (film or series)',
    }[key] ?? String(key)
  );
}

/* ------------------------------------------------------------------ *
 * Where to Watch
 * ------------------------------------------------------------------ */

const CATEGORY_LABEL = { stream: 'Stream', rent: 'Rent', buy: 'Buy' };

export function providerGroups(availability) {
  const wrapper = el('div');

  if (!availability) {
    wrapper.append(skeletonBlock(3));
    return wrapper;
  }

  if (availability.notice && !availability.hasAny) {
    wrapper.append(
      el('div', { class: 'banner banner--info' }, [
        icon('i-info'),
        el('div', [el('span', { text: availability.notice })]),
      ])
    );
  }

  if (!availability.hasAny) {
    wrapper.append(
      el('p', { class: 't-body', style: { marginTop: '4px' }, text: 'Not currently available for streaming.' })
    );
    if (availability.isMock) {
      wrapper.append(
        el('p', {
          class: 't-meta',
          style: { marginTop: '8px' },
          text: 'Availability is simulated in this build and does not reflect real licensing.',
        })
      );
    }
    return wrapper;
  }

  for (const group of availability.groups) {
    const section = el('div', { class: 'provider-group' });
    section.append(el('p', { class: 'provider-group__label', text: CATEGORY_LABEL[group.category] ?? group.category }));

    const list_ = el('div', { class: 'provider-list' });
    for (const provider of group.providers) {
      const chip = el('div', { class: 'provider' });

      if (provider.logoUrl) {
        const img = el('img', {
          class: 'provider__logo',
          src: provider.logoUrl,
          alt: '',
          loading: 'lazy',
          decoding: 'async',
          referrerpolicy: 'no-referrer',
        });
        img.addEventListener('error', () => {
          img.replaceWith(el('span', { class: 'provider__logo', text: initialsOf(provider.name) }));
        });
        chip.append(img);
      } else {
        chip.append(el('span', { class: 'provider__logo', text: initialsOf(provider.name) }));
      }

      const text = el('div');
      text.append(el('span', { class: 'provider__name', text: provider.name }));
      if (provider.priceText) text.append(el('span', { class: 'provider__price', text: ` · ${provider.priceText}` }));
      chip.append(text);

      section.append(chip);
    }

    wrapper.append(section);
  }

  if (availability.isMock) {
    wrapper.append(
      el('p', {
        class: 't-meta',
        style: { marginTop: '12px' },
        text: 'Simulated availability — no AI or licensing provider is configured in this build.',
      })
    );
  }

  return wrapper;
}

function initialsOf(name = '') {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/* ------------------------------------------------------------------ *
 * States
 * ------------------------------------------------------------------ */

export async function emptyState({ art = 'i-info', title, text, actions = [] } = {}) {
  const { root } = await renderComponent('empty-state', { art, title, text });
  const slot = root.querySelector('.empty__actions') ?? root;
  for (const action of actions) {
    const button = el('button', {
      class: `btn ${action.variant ? `btn--${action.variant}` : 'btn--secondary'}`,
      type: 'button',
      text: action.label,
    });
    on(button, 'click', () => action.onClick?.());
    slot.append(button);
  }
  if (actions.length === 0) slot.remove?.();
  return root;
}

export function skeletonBlock(rows = 4) {
  const wrapper = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  for (let i = 0; i < rows; i += 1) {
    wrapper.append(
      el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [
        el('div', { class: 'skeleton', style: { width: '56px', height: '84px', borderRadius: '10px', flex: '0 0 auto' } }),
        el('div', { style: { flex: '1 1 auto' } }, [
          el('div', { class: 'skeleton skeleton--line' }),
          el('div', { class: 'skeleton skeleton--line skeleton--line-sm' }),
        ]),
      ])
    );
  }
  return wrapper;
}

export function skeletonRail(count = 5) {
  const track = el('div', { class: 'rail__track' });
  for (let i = 0; i < count; i += 1) {
    track.append(el('div', { class: 'skeleton skeleton--poster' }));
  }
  return track;
}

export function inlineSpinner(label) {
  return el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, [
    el('span', { class: 'spinner' }),
    label ? el('span', { text: label }) : null,
  ]);
}

/* ------------------------------------------------------------------ *
 * Media meta line helpers
 * ------------------------------------------------------------------ */

export function mediaMetaLine(item) {
  const parts = [
    year(item.year) ? (item.yearEnd ? `${item.year}–${item.yearEnd}` : String(item.year)) : null,
    mediaTypeLabel(item.mediaType),
    item.runtime ? runtimeLabel(item.runtime) : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

function runtimeLabel(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ratingBadge(value) {
  const v = voteAverage(value);
  if (!v) return null;
  const node = el('span', { class: 'rating' });
  node.append(icon('i-star'), el('span', { text: v }));
  return node;
}

/** Episode row used by the TV detail screen. */
export async function episodeRow(episode, { onSelect, highlight = false } = {}) {
  const { root } = await renderComponent('episode', {
    number: episode.episodeNumber,
    title: episode.name ?? `Episode ${episode.episodeNumber}`,
    hasStill: Boolean(episode.stillUrl),
    meta: [episode.airDate?.slice(0, 10), episode.runtime ? `${episode.runtime}m` : null].filter(Boolean).join(' · '),
    overview: episode.overview ?? '',
  });

  if (episode.stillUrl) {
    const still = root.querySelector('.episode__still');
    if (still) {
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.style.opacity = '0';
      img.style.transition = 'opacity var(--dur-base) var(--ease-out)';
      img.addEventListener('load', () => {
        img.style.opacity = '1';
      });
      img.addEventListener('error', () => img.remove());
      still.append(img);
      // Set the source once mounted so `loading="lazy"` can take effect.
      window.setTimeout(() => {
        img.src = episode.stillUrl;
      }, 0);
    }
  }

  if (highlight) {
    root.style.background = 'var(--c-accent-soft)';
    root.style.borderRadius = 'var(--r-md)';
    root.style.padding = '12px';
  }

  on(root, 'click', () => onSelect?.(episode));
  return root;
}

export { year, mediaTypeLabel, relativeDate, seasonEpisode, list };
export default {
  banner,
  mockNotice,
  posterCard,
  mediaRow,
  personPill,
  confidenceMeter,
  verdictPill,
  signalList,
  providerGroups,
  emptyState,
  skeletonBlock,
  skeletonRail,
  inlineSpinner,
  mediaMetaLine,
  ratingBadge,
  episodeRow,
};
