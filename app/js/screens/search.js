/**
 * SEARCH (section 20).
 *
 * Searches movies, series, actors and directors through the backend. Typing is
 * debounced and every in-flight request is aborted when a newer keystroke arrives,
 * so results can never arrive out of order and we do not spend API quota on
 * intermediate states.
 */
import { el, qs, on, clear, debounce, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { toast, toastError, hapticImpact } from '../core/feedback.js';
import * as catalog from '../services/catalog.js';
import { AppError, Failure } from '../core/errors.js';
import { posterCard, mediaRow, emptyState, skeletonBlock, banner } from '../ui/components.js';
import { year, mediaTypeLabel } from '../core/format.js';
import { mountArtwork, mountAvatar } from '../ui/artwork.js';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

export default {
  title: 'Search',
  tab: 'search',

  async mount({ root }) {
    const input = qs('#search-input', root);
    const clearButton = qs('#search-clear', root);
    const cancelButton = qs('#search-cancel', root);
    const tabs = qs('#search-tabs', root);
    const idle = qs('#search-idle', root);
    const results = qs('#search-results', root);
    const recentGroup = qs('#search-recent-group', root);
    const recentList = qs('#search-recent', root);
    const browseGroup = qs('#search-browse-group', root);
    const browseList = qs('#search-browse', root);

    const searchIconBtn = qs('#search-icon-btn', root);
    const recentClearBtn = qs('#search-recent-clear', root);

    let type = 'all';
    let query = '';
    let controller = null;
    let cachedDiscover = null;
    let isSearchActive = false;

    /* ------------------------------------------------------------------ *
     * Initial idle state
     * Search history is hidden until search box is focused / activated.
     * ------------------------------------------------------------------ */
    if (recentGroup) recentGroup.hidden = true;
    if (results) results.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    if (clearButton) clearButton.hidden = true;
    if (browseGroup) browseGroup.hidden = false;

    renderBrowse();

    function enterSearchMode() {
      isSearchActive = true;
      if (cancelButton) cancelButton.hidden = false;
      if (browseGroup) browseGroup.hidden = true;

      const trimmed = input.value.trim();
      if (trimmed.length < MIN_QUERY_LENGTH) {
        if (results) results.hidden = true;
        if (recentGroup) {
          recentGroup.hidden = false;
          renderRecent();
        }
      } else {
        if (recentGroup) recentGroup.hidden = true;
        if (results) results.hidden = false;
      }
    }

    function exitSearchMode() {
      isSearchActive = false;
      input.value = '';
      query = '';
      controller?.abort();
      debouncedSearch.cancel();
      input.blur();

      if (cancelButton) cancelButton.hidden = true;
      if (clearButton) clearButton.hidden = true;
      if (recentGroup) recentGroup.hidden = true;
      if (results) results.hidden = true;
      if (browseGroup) browseGroup.hidden = false;
    }

    async function renderRecent() {
      try {
        const items = catalog.selectedHistory();
        clear(recentList);
        if (!items || items.length === 0) {
          if (recentClearBtn) recentClearBtn.hidden = true;
          recentList.append(
            el('p', {
              class: 't-meta',
              style: { padding: '8px 0 16px', color: 'var(--c-text-3)' },
              text: 'No search history yet. Titles and people you select will appear here.',
            })
          );
          return;
        }

        if (recentClearBtn) recentClearBtn.hidden = false;

        for (const item of items.slice(0, 10)) {
          const row = el('div', { class: 'search-history-row' });
          const isPerson = item.mediaType === 'person' || item.type === 'person';
          const itemTitle = item.title || item.name || item.query || 'Untitled';

          const visualWrap = el('span', { class: isPerson ? 'search-history-row__avatar' : 'search-history-row__art' });
          if (isPerson) {
            mountAvatar(visualWrap, { url: item.profileUrl ?? item.profilePath, name: itemTitle });
          } else if (item.posterUrl || item.posterPath) {
            mountArtwork(visualWrap, { url: item.posterUrl ?? item.posterPath, title: itemTitle, compact: true });
          } else if (item.query && !item.mediaType) {
            visualWrap.className = 'search-history-row__icon';
            visualWrap.append(icon('i-history'));
          } else {
            mountArtwork(visualWrap, { url: null, title: itemTitle, compact: true });
          }

          const metaParts = [];
          if (isPerson) {
            metaParts.push('Person');
            if (item.department) metaParts.push(item.department);
          } else if (item.mediaType) {
            metaParts.push(mediaTypeLabel(item.mediaType));
            if (item.year) metaParts.push(year(item.year));
          } else if (item.query) {
            metaParts.push('Search');
          }
          const metaText = metaParts.join(' · ');

          const mainBtn = el(
            'button',
            {
              class: 'search-history-row__main',
              type: 'button',
              ariaLabel: itemTitle,
            },
            [
              visualWrap,
              el('span', { class: 'media-row__text' }, [
                el('span', { class: 'media-row__title', text: itemTitle }),
                metaText ? el('span', { class: 'media-row__meta', text: metaText }) : null,
              ].filter(Boolean)),
            ]
          );

          on(mainBtn, 'click', () => {
            hapticImpact('light');
            if (isPerson) {
              const personId = item.tmdbId || item.id;
              if (personId) router.navigate(`/person/${personId}`);
            } else if (item.mediaType && (item.tmdbId || item.id)) {
              router.navigate(`/detail/${item.mediaType}/${item.tmdbId || item.id}`);
            } else if (item.query) {
              input.value = item.query;
              query = item.query;
              if (clearButton) clearButton.hidden = false;
              runSearch();
            }
          });

          const delBtn = el(
            'button',
            {
              class: 'search-history-row__del',
              type: 'button',
              ariaLabel: `Remove ${itemTitle} from search history`,
              title: 'Remove',
            },
            [icon('i-close')]
          );

          on(delBtn, 'click', (e) => {
            e.stopPropagation();
            hapticImpact('light');
            catalog.removeSelectedItem(item);
            renderRecent();
          });

          row.append(mainBtn, delBtn);
          recentList.append(row);
        }
      } catch (err) {
        console.warn('[search] error rendering recent searches', err);
      }
    }

    async function renderBrowse() {
      clear(browseList);
      browseList.append(skeletonBlock(3));
      try {
        if (!cachedDiscover) {
          cachedDiscover = await catalog.discover({ limit: 12 });
        }
        renderBrowseContent();
      } catch {
        clear(browseList);
        browseList.append(await banner({ variant: 'info', text: 'Could not load suggestions right now.' }));
      }
    }

    function renderBrowseContent() {
      clear(browseList);
      if (!cachedDiscover) return;

      if (cachedDiscover.isMock) {
        banner({ variant: 'info', text: 'Browsing uses the local fixture catalog in this build.' })
          .then((b) => browseList.prepend(b));
      }

      if (type === 'person') {
        const people = cachedDiscover.people ?? [];
        if (people.length === 0) {
          browseList.append(el('p', { class: 't-meta', style: { padding: '16px 0' }, text: 'No suggested actors or directors right now.' }));
          return;
        }
        const group = el('div', { class: 'search-group' });
        group.append(el('h2', { class: 'search-group__label', text: 'Popular Actors & Directors' }));
        for (const p of people) {
          const row = el('button', { class: 'search-person-row', type: 'button' });
          row.setAttribute('aria-label', p.name);
          const avatarWrap = el('span', { class: 'search-person-row__avatar' });
          mountAvatar(avatarWrap, { url: p.profileUrl, name: p.name });
          row.append(avatarWrap);

          const text = el('span', { class: 'media-row__text' });
          text.append(el('span', { class: 'media-row__title', text: p.name }));
          const subtitle = [
            p.department ?? null,
            (p.knownFor ?? []).map((k) => k.title).filter(Boolean).join(', ') ? `Known for ${(p.knownFor ?? []).map((k) => k.title).filter(Boolean).join(', ')}` : null,
          ].filter(Boolean).join(' · ');
          if (subtitle) text.append(el('span', { class: 'media-row__meta', text: subtitle }));
          row.append(text);

          on(row, 'click', () => {
            catalog.saveSelectedItem({
              id: p.id,
              tmdbId: p.id,
              mediaType: 'person',
              title: p.name,
              name: p.name,
              profileUrl: p.profileUrl,
              department: p.department,
            });
            if (p.id) router.navigate(`/person/${p.id}`);
          });
          group.append(row);
        }
        browseList.append(group);
        return;
      }

      const allRails = cachedDiscover.rails ?? [];
      let railsToShow = [];

      if (type === 'movie') {
        const movieRail = allRails.find((r) => r.key === 'movies');
        const trendingRail = allRails.find((r) => r.key === 'trending');
        const trendingMovies = (trendingRail?.items ?? []).filter((i) => i.mediaType === 'movie');
        if (movieRail) railsToShow.push(movieRail);
        if (trendingMovies.length > 0) {
          railsToShow.push({ key: 'trending-movies', title: 'Trending movies', items: trendingMovies });
        }
      } else if (type === 'tv') {
        const seriesRail = allRails.find((r) => r.key === 'series');
        const trendingRail = allRails.find((r) => r.key === 'trending');
        const trendingSeries = (trendingRail?.items ?? []).filter((i) => i.mediaType === 'tv');
        if (seriesRail) railsToShow.push(seriesRail);
        if (trendingSeries.length > 0) {
          railsToShow.push({ key: 'trending-series', title: 'Trending series', items: trendingSeries });
        }
      } else {
        // 'all'
        railsToShow = allRails;
      }

      for (const rail of railsToShow) {
        const section = el('div', { style: { marginTop: '16px' } });
        section.append(el('p', { class: 'search-group__label', text: rail.title }));
        const track = el('div', { class: 'rail__track', style: { padding: '0' } });
        for (const item of rail.items.slice(0, 10)) {
          track.append(
            posterCard(item, {
              onSelect: (s) => {
                catalog.saveSelectedItem({
                  tmdbId: s.tmdbId,
                  id: s.tmdbId,
                  mediaType: s.mediaType,
                  title: s.title,
                  name: s.title,
                  posterPath: s.posterPath,
                  posterUrl: s.posterUrl,
                  year: s.year,
                  voteAverage: s.voteAverage,
                });
                router.navigate(`/detail/${s.mediaType}/${s.tmdbId}`);
              },
            })
          );
        }
        section.append(track);
        browseList.append(section);
      }
    }

    /* ------------------------------------------------------------------ *
     * Search
     * ------------------------------------------------------------------ */
    const debouncedSearch = debounce(() => runSearch(), SEARCH_DEBOUNCE_MS);

    async function runSearch() {
      const trimmed = input.value.trim();
      query = trimmed;

      if (trimmed.length < MIN_QUERY_LENGTH) {
        if (results) results.hidden = true;
        if (clearButton) clearButton.hidden = true;
        if (isSearchActive) {
          if (browseGroup) browseGroup.hidden = true;
          if (recentGroup) {
            recentGroup.hidden = false;
            renderRecent();
          }
        } else {
          if (recentGroup) recentGroup.hidden = true;
          if (browseGroup) {
            browseGroup.hidden = false;
            renderBrowseContent();
          }
        }
        return;
      }

      if (browseGroup) browseGroup.hidden = true;
      if (recentGroup) recentGroup.hidden = true;
      if (results) results.hidden = false;
      if (clearButton) clearButton.hidden = false;
      if (cancelButton) cancelButton.hidden = false;

      // Cancel any older in-flight search.
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;

      clear(results);
      results.append(skeletonBlock(4));

      try {
        const payload = await catalog.search({ query: trimmed, type, signal: currentController.signal });
        if (currentController.signal.aborted) return;
        renderResults(payload);
      } catch (error) {
        if (currentController.signal.aborted) return;
        clear(results);
        const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });
        results.append(
          await emptyState({
            art: appError.kind === Failure.OFFLINE ? 'i-offline' : 'i-warning',
            title: appError.title,
            text: appError.text,
            actions: appError.retryable ? [{ label: 'Try again', variant: 'primary', onClick: runSearch }] : [],
          })
        );
      }
    }

    function renderResults(payload) {
      clear(results);

      let titles = payload.titles ?? [];
      let people = payload.people ?? [];

      if (type === 'movie') {
        titles = titles.filter((t) => t.mediaType === 'movie');
        people = [];
      } else if (type === 'tv') {
        titles = titles.filter((t) => t.mediaType === 'tv');
        people = [];
      } else if (type === 'person') {
        titles = [];
      }

      if (titles.length === 0 && people.length === 0) {
        const typeWord = type === 'movie' ? 'movies' : type === 'tv' ? 'series' : type === 'person' ? 'people' : 'results';
        emptyState({
          art: 'i-search',
          title: `No ${typeWord} for “${payload.query}”`,
          text: type === 'all' ? 'Check the spelling, or try the original-language title.' : 'Try searching in "All" or check your spelling.',
        }).then((node) => {
          clear(results);
          results.append(node);
        });
        return;
      }

      if (payload.isMock) {
        banner({
          variant: 'info',
          text: 'Search is using the local fixture catalog in this build; only a small set of titles is available.',
        }).then((node) => results.prepend(node));
      }

      // ── People ─────────────────────────────────────────────────────────
      if (people.length > 0 && (type === 'all' || type === 'person')) {
        const group = el('div', { class: 'search-group' });
        group.append(el('h2', { class: 'search-group__label', text: 'People' }));

        for (const person of people.slice(0, 8)) {
          const knownForNames = (person.knownFor ?? [])
            .slice(0, 2)
            .map((k) => k.title)
            .filter(Boolean)
            .join(', ');
          const subtitle = [
            person.department ?? null,
            knownForNames ? `Known for ${knownForNames}` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          const row = el('button', { class: 'search-person-row', type: 'button' });
          row.setAttribute('aria-label', `${person.name}${person.department ? `, ${person.department}` : ''}`);

          const avatarWrap = el('span', { class: 'search-person-row__avatar' });
          mountAvatar(avatarWrap, { url: person.profileUrl, name: person.name });
          row.append(avatarWrap);

          const text = el('span', { class: 'media-row__text' });
          text.append(el('span', { class: 'media-row__title', text: person.name }));
          if (subtitle) text.append(el('span', { class: 'media-row__meta', text: subtitle }));
          row.append(text);

          on(row, 'click', () => {
            catalog.saveSelectedItem({
              id: person.id,
              tmdbId: person.id,
              mediaType: 'person',
              title: person.name,
              name: person.name,
              profileUrl: person.profileUrl,
              department: person.department,
            });
            if (person.id) router.navigate(`/person/${person.id}`);
          });
          group.append(row);
        }

        results.append(group);
      }

      // ── Movies & TV Shows ───────────────────────────────────────────────
      if (titles.length > 0 && type !== 'person') {
        const group = el('div', { class: 'search-group' });
        const heading = type === 'movie' ? 'Movies' : type === 'tv' ? 'Series' : people.length > 0 ? 'Movies & TV Shows' : 'Results';
        group.append(el('h2', { class: 'search-group__label', text: heading }));

        for (const title of titles) {
          const subtitle = [
            year(title.year),
            mediaTypeLabel(title.mediaType),
            title.voteAverage && title.voteAverage > 0 ? `${title.voteAverage.toFixed(1)} ★` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          group.append(
            mediaRow(title, {
              onSelect: (selected) => {
                catalog.saveSelectedItem({
                  tmdbId: selected.tmdbId,
                  id: selected.tmdbId,
                  mediaType: selected.mediaType,
                  title: selected.title,
                  name: selected.title,
                  posterPath: selected.posterPath,
                  posterUrl: selected.posterUrl,
                  year: selected.year,
                  voteAverage: selected.voteAverage,
                });
                router.navigate(`/detail/${selected.mediaType}/${selected.tmdbId}`);
              },
              subtitle,
            })
          );
        }
        results.append(group);
      }

      announce(`${titles.length + people.length} results for ${payload.query}`);
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */
    const disposers = [
      on(searchIconBtn, 'click', () => {
        hapticImpact('light');
        enterSearchMode();
        input.focus();
      }),

      on(input, 'focus', () => {
        enterSearchMode();
      }),

      on(cancelButton, 'click', () => {
        hapticImpact('light');
        exitSearchMode();
      }),

      on(input, 'input', () => {
        if (clearButton) clearButton.hidden = input.value.length === 0;
        const trimmed = input.value.trim();

        if (trimmed.length < MIN_QUERY_LENGTH) {
          controller?.abort();
          debouncedSearch.cancel();
          query = '';
          if (results) results.hidden = true;
          if (isSearchActive && recentGroup) {
            recentGroup.hidden = false;
            renderRecent();
          }
          return;
        }

        if (recentGroup) recentGroup.hidden = true;
        if (results) results.hidden = false;
        debouncedSearch();
      }),

      on(input, 'keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          debouncedSearch.cancel();
          input.blur();
          runSearch();
        }
      }),

      on(clearButton, 'click', () => {
        input.value = '';
        query = '';
        if (clearButton) clearButton.hidden = true;
        controller?.abort();
        debouncedSearch.cancel();
        if (results) results.hidden = true;
        if (isSearchActive && recentGroup) {
          recentGroup.hidden = false;
          renderRecent();
        }
        input.focus();
      }),

      on(recentClearBtn, 'click', async () => {
        hapticImpact('medium');
        try {
          await catalog.clearRecentSearches();
          renderRecent();
          toast('Search history cleared.', { variant: 'info' });
        } catch (error) {
          toastError(error);
        }
      }),
    ];

    // Tab switching
    for (const tab of tabs.querySelectorAll('[data-type]')) {
      disposers.push(
        on(tab, 'click', () => {
          type = tab.dataset.type;
          for (const sibling of tabs.children) sibling.setAttribute('aria-selected', 'false');
          tab.setAttribute('aria-selected', 'true');
          hapticImpact('light');
          const trimmed = input.value.trim();
          if (trimmed.length >= MIN_QUERY_LENGTH) {
            debouncedSearch.cancel();
            runSearch();
          } else {
            renderBrowseContent();
          }
        })
      );
    }

    return () => {
      disposers.forEach((dispose) => dispose?.());
      controller?.abort();
      debouncedSearch.cancel();
    };
  },
};
