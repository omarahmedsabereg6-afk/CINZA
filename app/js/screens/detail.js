/**
 * DETAIL (sections 15, 16, 17, 19).
 *
 * Handles both movies and series from one screen, because 90% of the layout is
 * identical. The series-only parts (season picker, episode list) are populated
 * lazily and only when there are episodes to show.
 */
import { el, qs, on, clear, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { toast, toastError, hapticImpact, openSheet } from '../core/feedback.js';
import * as catalog from '../services/catalog.js';
import * as watchlistService from '../services/watchlist.js';
import * as capture from '../services/capture.js';
import settings from '../services/settings.js';
import { getCapabilities } from '../services/capabilities.js';
import { KNOWN_COUNTRIES, countryName } from '../core/countries.js';
import { AppError, Failure } from '../core/errors.js';
import { mountArtwork } from '../ui/artwork.js';
import {
  banner,
  providerGroups,
  personPill,
  posterCard,
  skeletonBlock,
  skeletonRail,
  episodeRow,
  ratingBadge,
} from '../ui/components.js';
import { year, runtime, mediaTypeLabel, seasonEpisode, duration } from '../core/format.js';

const OVERVIEW_CLAMP_LINES = 4;

const GENRE_MAP = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  Horror: 27,
  Mystery: 9648,
  Romance: 10749,
  'Sci-Fi': 878,
  'Science Fiction': 878,
  Thriller: 53,
  'Action & Adventure': 28,
  'Sci-Fi & Fantasy': 878,
  'War & Politics': 10752,
};

export default {
  title: null,
  tab: null,
  showBack: true,

  async mount({ root, params }) {
    const mediaType = params.mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbId = params.tmdbId;

    const backdrop = qs('#detail-backdrop', root);
    const posterSlot = qs('#detail-poster', root);
    const titleNode = qs('#detail-title', root);
    const metaNode = qs('#detail-meta', root);
    const overview = qs('#detail-overview', root);
    const readMore = qs('#detail-readmore', root);
    const facts = qs('#detail-facts', root);
    const castRow = qs('#detail-cast', root);
    const castSection = qs('#detail-cast-section', root);
    const similarSection = qs('#detail-similar-section', root);
    const similarTrack = qs('#detail-similar', root);
    const seasonsSection = qs('#detail-seasons-section', root);
    const seasonSelect = qs('#detail-season-select', root);
    const episodesRoot = qs('#detail-episodes', root);
    const watchBody = qs('#detail-watch-body', root);
    const notices = qs('#detail-notices', root);
    const saveButton = qs('#detail-save', root);

    let detail = null;
    let savedState = { saved: false, id: null };
    let activeSeason = null;

    /* ------------------------------------------------------------------ *
     * Load
     * ------------------------------------------------------------------ */
    showSkeleton();

    try {
      detail = await catalog.detail(mediaType, tmdbId);
    } catch (error) {
      renderError(error);
      return () => {};
    }

    if (!detail) {
      renderError(new AppError(Failure.UNKNOWN, { message: 'That title could not be found.' }));
      return () => {};
    }

    hideSkeleton();
    paintHeader();

    /* ------------------------------------------------------------------ *
     * Header
     * ------------------------------------------------------------------ */
    function paintHeader() {
      titleNode.textContent = detail.title ?? 'Untitled';

      if (detail.backdropUrl) {
        backdrop.hidden = false;
        backdrop.alt = `${detail.title} backdrop`;
        backdrop.src = detail.backdropUrl;
      }

      mountArtwork(posterSlot, { url: detail.posterUrl, title: detail.title });

      const parts = [
        mediaType === 'tv'
          ? year(detail.year)
            ? `${detail.year}${detail.yearEnd && detail.yearEnd !== detail.year ? `–${detail.yearEnd}` : ''}`
            : null
          : year(detail.year),
        mediaTypeLabel(mediaType),
        detail.runtime ? runtime(detail.runtime) : null,
        mediaType === 'tv' && detail.seasonsCount ? `${detail.seasonsCount} season${detail.seasonsCount > 1 ? 's' : ''}` : null,
      ].filter(Boolean);

      for (const [index, part] of parts.entries()) {
        if (index > 0) metaNode.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
        metaNode.append(el('span', { text: part }));
      }

      const rating = ratingBadge(detail.voteAverage);
      if (rating) {
        metaNode.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
        metaNode.append(rating);
      }

      // Genre chips below the meta line
      if ((detail.genres ?? []).length > 0) {
        const genreRow = el('div', { class: 'detail__genres' });
        for (const g of detail.genres.slice(0, 4)) {
          const gid = GENRE_MAP[g] ?? 0;
          const chip = el('button', {
            class: 'detail__genre-chip',
            type: 'button',
            text: g,
            ariaLabel: `Browse ${g} titles`,
          });
          on(chip, 'click', (e) => {
            e.stopPropagation();
            hapticImpact('light');
            if (gid) {
              router.navigate(`/home?genre=${gid}`);
            } else {
              router.navigate('/home');
            }
          });
          genreRow.append(chip);
        }
        titleNode.closest('.detail__main').parentElement.insertBefore(genreRow, titleNode.closest('.detail__main').nextSibling);
      }
    }

    /* ------------------------------------------------------------------ *
     * Overview with expand
     * ------------------------------------------------------------------ */
    if (detail.overview) {
      overview.textContent = detail.overview;
      overview.classList.add('t-clamp-3');

      // Only offer "Read more" when the text is actually being clipped.
      requestAnimationFrame(() => {
        if (overview.scrollHeight > overview.clientHeight + 4) {
          readMore.hidden = false;
          readMore.addEventListener('click', () => {
            const clamped = overview.classList.toggle('t-clamp-3');
            readMore.textContent = clamped ? 'Read more' : 'Show less';
          });
        }
      });
    } else {
      overview.textContent = 'No synopsis is available for this title.';
      overview.style.color = 'var(--c-text-3)';
    }

    /* ------------------------------------------------------------------ *
     * Facts
     * ------------------------------------------------------------------ */
    const factEntries = [
      ['Director', (detail.directors ?? []).join(', ')],
      ['Writers', (detail.writers ?? []).slice(0, 3).join(', ')],
      ['Genres', (detail.genres ?? []).join(', ')],
      ['Release', detail.releaseDate ?? detail.firstAirDate ?? year(detail.year)],
      mediaType === 'tv' ? ['Episodes', detail.episodesCount ? String(detail.episodesCount) : '—'] : ['Runtime', detail.runtime ? runtime(detail.runtime) : '—'],
      ['Rating', detail.voteAverage ? `${detail.voteAverage.toFixed(1)} / 10` : '—'],
      ['Status', detail.status ?? '—'],
      ['Source', detail.isMock ? 'Fixture catalog (simulated)' : 'The Movie Database'],
    ].filter(([, value]) => value && value !== '—');

    for (const [label, value] of factEntries) {
      facts.append(
        el('div', { class: 'fact' }, [
          el('div', { class: 'fact__label', text: label }),
          el('div', { class: 'fact__value', text: value }),
        ])
      );
    }

    /* ------------------------------------------------------------------ *
     * Notices
     * ------------------------------------------------------------------ */
    if (detail.isMock) {
      notices.append(
        await banner({
          variant: 'mock',
          title: 'Simulated metadata',
          text: 'This title comes from the built-in fixture catalog because no movie database key is configured. Artwork is unavailable and a generated placeholder is shown instead.',
        })
      );
    }
    if (detail.stale) {
      notices.append(
        await banner({
          variant: 'info',
          text: 'The movie database was unreachable, so this is a previously cached copy.',
        })
      );
    }

    /* ------------------------------------------------------------------ *
     * Cast
     * ------------------------------------------------------------------ */
    const cast = detail.cast ?? [];
    if (cast.length > 0) {
      castSection.hidden = false;
      for (const person of cast.slice(0, 20)) {
        const pill = personPill(person);
        if (person.id) {
          pill.setAttribute('aria-label', `${person.name}${person.character ? ` as ${person.character}` : ''} — view actor`);
          on(pill, 'click', () => router.navigate(`/person/${person.id}`));
        } else {
          pill.disabled = true;
        }
        castRow.append(pill);
      }
    } else {
      castSection.hidden = true;
    }

    async function loadSimilar() {
      try {
        clear(similarTrack);
        similarTrack.append(skeletonRail(5));
        const items = await catalog.recommendations(mediaType, tmdbId);
        clear(similarTrack);
        // Filter out the current title if it somehow appears in its own recs
        const filtered = (items ?? []).filter(
          (item) => !(item.tmdbId === tmdbId && item.mediaType === mediaType)
        );
        if (filtered.length === 0) {
          similarSection.hidden = true;
          return;
        }
        similarSection.hidden = false;
        for (const item of filtered.slice(0, 10)) {
          const card = posterCard(item, {
            onSelect: (selected) => router.navigate(`/detail/${selected.mediaType ?? mediaType}/${selected.tmdbId}`),
          });
          similarTrack.append(card);
        }
      } catch {
        similarSection.hidden = true;
      }
    }

    loadSimilar();

    /* ------------------------------------------------------------------ *
     * Seasons + episodes (section 16)
     * ------------------------------------------------------------------ */
    if (mediaType === 'tv' && (detail.seasons ?? []).length > 0) {
      seasonsSection.hidden = false;
      renderSeasonPicker(detail.seasons);
    }

    function renderSeasonPicker(seasons) {
      clear(seasonSelect);

      // Prefer the season the recognition pointed at, else the first real season.
      const initial = seasons.find((s) => s.seasonNumber >= 1) ?? seasons[0];

      for (const season of seasons) {
        const isActive = season.seasonNumber === initial.seasonNumber;
        const chip = el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(isActive),
          text: season.name ?? `Season ${season.seasonNumber}`,
        });
        if (isActive) activeSeason = season;
        on(chip, 'click', () => {
          for (const sibling of seasonSelect.children) sibling.setAttribute('aria-pressed', 'false');
          chip.setAttribute('aria-pressed', 'true');
          activeSeason = season;
          loadSeason(season.seasonNumber);
        });
        seasonSelect.append(chip);
      }

      if (initial) loadSeason(initial.seasonNumber);
    }

    async function loadSeason(seasonNumber) {
      clear(episodesRoot);
      episodesRoot.append(skeletonBlock(3));

      try {
        const season = await catalog.season(tmdbId, seasonNumber);
        clear(episodesRoot);

        if (!season || season.episodes.length === 0) {
          episodesRoot.append(
            el('p', { class: 't-body', text: 'No episode data is available for this season.' })
          );
          return;
        }

        for (const episode of season.episodes) {
          const row = await episodeRow(episode, {
            onSelect: () => openEpisodeSheet(episode),
          });
          episodesRoot.append(row);
        }
      } catch (error) {
        clear(episodesRoot);
        episodesRoot.append(
          await banner({ variant: 'info', text: 'Episodes could not be loaded right now.' })
        );
      }
    }

    function openEpisodeSheet(episode) {
      const ref = seasonEpisode(episode.seasonNumber ?? activeSeason?.seasonNumber, episode.episodeNumber);

      openSheet({
        title: `${ref} · ${episode.name ?? 'Episode'}`,
        content: el('div', {}, [
          episode.overview ? el('p', { class: 't-body', text: episode.overview }) : null,
          el('p', {
            class: 't-meta',
            style: { marginTop: '10px' },
            text: [episode.airDate?.slice(0, 10), episode.runtime ? `${episode.runtime} min` : null]
              .filter(Boolean)
              .join(' · '),
          }),
        ].filter(Boolean)),
        actions: [
          {
            label: 'Save this episode',
            variant: 'secondary',
            onClick: async () => {
              try {
                await watchlistService.add({
                  mediaType: 'tv',
                  tmdbId,
                  title: `${detail.title} — ${episode.name}`,
                  posterUrl: detail.posterUrl,
                  year: detail.year,
                  seasonNumber: episode.seasonNumber ?? activeSeason?.seasonNumber,
                  episodeNumber: episode.episodeNumber,
                });
                toast(
                  watchlistService.isAuthenticated() ? 'Episode saved.' : 'Episode saved on this device.',
                  { variant: 'success' }
                );
              } catch (error) {
                toastError(error);
              }
            },
          },
          {
            label: 'Look up this episode by screenshot',
            variant: 'primary',
            onClick: () => {
              toast('Take a screenshot of the episode and recognise it to confirm the season and episode.', {
                variant: 'info',
                duration: 5000,
              });
              router.navigate('/camera');
            },
          },
        ],
      });
    }

    /* ------------------------------------------------------------------ *
     * Save button
     * ------------------------------------------------------------------ */
    try {
      savedState = await watchlistService.has({ mediaType, tmdbId });
    } catch {
      savedState = { saved: false, id: null };
    }
    paintSave();

    saveButton.addEventListener('click', async () => {
      hapticImpact('light');
      saveButton.disabled = true;
      try {
        if (savedState.saved && savedState.id) {
          await watchlistService.remove({ id: savedState.id, mediaType, tmdbId });
          savedState = { saved: false, id: null };
          toast('Removed from your watchlist.', { variant: 'info' });
        } else {
          const item = await watchlistService.add({
            mediaType,
            tmdbId,
            title: detail.title,
            posterUrl: detail.posterUrl,
            year: detail.year,
          });
          savedState = { saved: true, id: item?.id ?? null };
          toast(watchlistService.isAuthenticated() ? 'Saved to your watchlist.' : 'Saved on this device.', {
            variant: 'success',
          });
        }
        paintSave();
      } catch (error) {
        toastError(error);
      } finally {
        saveButton.disabled = false;
      }
    });

    function paintSave() {
      saveButton.setAttribute('aria-pressed', String(savedState.saved));
      saveButton.disabled = false;
      if (savedState.saved) {
        saveButton.innerHTML = `
          <span class="icon-heart-filled" aria-hidden="true"></span>
          <span>In Watchlist</span>
        `;
        saveButton.classList.add('btn--active');
      } else {
        saveButton.innerHTML = `
          <span class="icon-heart" aria-hidden="true"></span>
          <span>Add to Watchlist</span>
        `;
        saveButton.classList.remove('btn--active');
      }
    }

    /* ------------------------------------------------------------------ *
     * Where to Watch (section 17)
     * ------------------------------------------------------------------ */
    loadAvailability();

    async function loadAvailability({ refresh = false } = {}) {
      clear(watchBody);
      watchBody.append(skeletonBlock(2));

      try {
        const availability = await catalog.availability(mediaType, tmdbId, { refresh });
        clear(watchBody);

        watchBody.append(providerGroups(availability));

        const watchBtn = qs('#detail-watch', root);
        if (watchBtn) {
          if (!availability.hasAny) {
            watchBtn.classList.add('btn--muted');
          } else {
            watchBtn.classList.remove('btn--muted');
          }
        }
      } catch (error) {
        clear(watchBody);
        watchBody.append(
          await banner({
            variant: 'info',
            text: 'Viewing options could not be loaded right now. Please try again shortly.',
          })
        );
      }
    }

    const onRegionChanged = () => {
      loadAvailability({ refresh: true });
    };
    window.addEventListener('cinza:region-changed', onRegionChanged);

    const disposers = [
      () => window.removeEventListener('cinza:region-changed', onRegionChanged),
      on(qs('#detail-back', root), 'click', () => router.back('/search')),
      on(qs('#detail-watch', root), 'click', () => {
        hapticImpact('light');
        qs('#detail-watch-section', root)?.scrollIntoView({ behavior: 'smooth' });
      }),
      on(qs('#detail-share', root), 'click', async () => {
        const text = `${detail.title}${detail.year ? ` (${detail.year})` : ''} — via CINZA`;
        try {
          if (navigator.share) await navigator.share({ title: detail.title, text });
          else {
            await navigator.clipboard.writeText(text);
            toast('Copied to clipboard.', { variant: 'success' });
          }
        } catch {
          toast('Sharing is not available.', { variant: 'warn' });
        }
      }),
    ];

    announce(`${detail.title} details`);

    /* ------------------------------------------------------------------ *
     * Loading / error
     * ------------------------------------------------------------------ */
    function showSkeleton() {
      titleNode.textContent = 'Loading…';
      clear(castRow);
      castRow.append(skeletonBlock(1));
      clear(facts);
      facts.append(skeletonBlock(2));
      clear(similarTrack);
      similarTrack.append(skeletonRail(5));
    }

    function hideSkeleton() {
      clear(castRow);
      clear(facts);
      clear(similarTrack);
    }

    function renderError(error) {
      const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });
      clear(root);
      root.append(
        el('div', { class: 'view__pad' }, [
          el('h1', { class: 't-title', style: { marginBottom: '12px' }, text: appError.title ?? 'Not found' }),
          el('p', { class: 't-body', text: appError.text ?? 'That title could not be loaded.' }),
          el('div', { style: { marginTop: '20px' } }, [
            el('button', {
              class: 'btn btn--primary',
              type: 'button',
              text: 'Go back',
              on: { click: () => router.back('/home') },
            }),
          ]),
        ])
      );
    }

    return () => disposers.forEach((dispose) => dispose?.());
  },
};
