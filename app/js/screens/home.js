/**
 * HOME (section 6).
 *
 * The recognition button is the single focal point. Everything else on the screen
 * is either a secondary way to reach it, or content that gives the empty screen
 * something to say.
 */
import { el, qs, on, clear, icon, enableHorizontalScroll } from '../core/dom.js';
import { router } from '../core/router.js';
import { store, actions } from '../core/store.js';
import { toast, toastError, hapticImpact, openSheet } from '../core/feedback.js';
import { can, isSimulated, mockNotice as mockNoticeText } from '../services/capabilities.js';
import * as capture from '../services/capture.js';
import * as history from '../services/history.js';
import * as catalog from '../services/catalog.js';
import { AppError, Failure } from '../core/errors.js';
import { banner, posterCard, skeletonRail } from '../ui/components.js';
import { placeholder } from '../ui/artwork.js';
import { relativeDate } from '../core/format.js';

const GENRES = [
  { id: 0, name: 'All' },
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
];

const SORTS = [
  { id: 'popularity.desc', label: 'Most Popular', icon: 'i-sparkle' },
  { id: 'vote_average.desc', label: 'Top Rated', icon: 'i-star' },
  { id: 'release_date.desc', label: 'Latest Releases', icon: 'i-clock' },
  { id: 'vote_count.desc', label: 'Most Voted', icon: 'i-users' },
];

export default {
  title: null,
  tab: 'home',

  async mount({ root, params = {} }) {
    const button = qs('#recognize-btn', root);
    const actionDescribe = qs('#action-describe', root);
    const describeClose = qs('#describe-close', root);
    const describePanel = qs('#describe-panel', root);
    const describeInput = qs('#describe-input', root);
    const recentSection = qs('#home-recent', root);
    const recentTrack = qs('#home-recent-track', root);
    const noticeSlot = qs('#home-notice', root);
    const genresRoot = qs('#home-genres', root);
    const sortsRoot = qs('#home-sorts', root);
    const railsRoot = qs('#home-rails', root);

    let busy = false;

    /* ---------------- notice about simulated providers ---------------- */
    if (isSimulated() && noticeSlot) {
      const notice = await banner({
        variant: 'mock',
        title: 'Simulated result',
        text: mockNoticeText() ?? 'Some services are simulated in this build, so results are labelled.',
      });
      noticeSlot.append(notice);
    }

    /* ---------------- guarded async runner ---------------- */
    async function run(label, task) {
      if (busy) return;
      busy = true;
      button?.setAttribute('aria-disabled', 'true');
      try {
        await task();
      } catch (error) {
        if (error?.kind === Failure.CANCELLED) return; // user backed out of the picker
        toastError(error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error }));
      } finally {
        busy = false;
        button?.removeAttribute('aria-disabled');
      }
    }

    const goToPreview = () => router.navigate('/preview');

    /* ---------------- primary paths ---------------- */

    const fromGallery = () =>
      run('gallery', async () => {
        hapticImpact('light');
        await capture.captureFromGallery();
        goToPreview();
      });

    /* ---------------- describe the scene ---------------- */
    const submitDescription = () =>
      run('describe', async () => {
        const text = describeInput?.value?.trim() ?? '';
        if (!text) {
          describeInput?.focus();
          return;
        }
        capture.prepareDescription(text);
        router.navigate('/preview');
      });

    const toggleDescribe = (forceState) => {
      const isExpanded = typeof forceState === 'boolean'
        ? !forceState
        : actionDescribe?.getAttribute('aria-expanded') === 'true';
      const nextState = !isExpanded;
      actionDescribe?.setAttribute('aria-expanded', String(nextState));
      if (describePanel) describePanel.hidden = !nextState;
      if (nextState) setTimeout(() => describeInput?.focus(), 120);
    };

    /* ---------------- wiring ---------------- */

    const disposers = [
      on(button, 'click', fromGallery),
      on(actionDescribe, 'click', () => toggleDescribe()),
      on(describeClose, 'click', () => toggleDescribe(false)),
      on(qs('#describe-submit', root), 'click', submitDescription),
    ];

    // Enter (with modifier) submits the description without adding a click target.
    on(describeInput, 'keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitDescription();
      }
    });

    if (!can('describeScene')) {
      actionDescribe?.remove();
      describePanel?.closest('.describe')?.remove();
    }

    /* ---------------- recent strip ---------------- */
    renderRecent();
    function renderRecent() {
      const items = history.localItems();
      const session = store.getState().session;
      if (!recentSection || (items.length === 0 && session.status !== 'authenticated')) return;

      if (items.length === 0) {
        // Authenticated but nothing cached locally yet: fetch a short page quietly.
        history
          .list({ limit: 8 })
          .then((result) => {
            if (result.items.length) paint(result.items);
          })
          .catch(() => null);
        return;
      }
      paint(items);
    }

    function paint(items) {
      clear(recentTrack);
      recentSection.hidden = false;

      for (const item of items.slice(0, 8)) {
        const chip = el('button', { class: 'recent-chip', type: 'button' });
        chip.setAttribute('aria-label', `Open ${item.match?.title ?? 'recognition'}`);

        const art = el('span', { class: 'recent-chip__art' });
        if (item.thumbDataUrl) {
          art.append(el('img', { src: item.thumbDataUrl, alt: '', loading: 'lazy', decoding: 'async' }));
        } else {
          art.append(placeholder({ title: item.match?.title ?? '—', compact: true }));
        }
        chip.append(art);
        chip.append(
          el('span', {
            class: 'recent-chip__title',
            text: item.match?.title ?? (item.status === 'no_match' ? 'Not identified' : 'Failed'),
          })
        );

        on(chip, 'click', () => {
          if (item.match) router.navigate(`/detail/${item.match.mediaType}/${item.match.tmdbId}`);
          else router.navigate('/history');
        });

        recentTrack.append(chip);
      }
    }

    /* ---------------- genre selector + sorts + rails ---------------- */
    let initialGenreId = 0;
    if (params.genre !== undefined && params.genre !== null && params.genre !== '') {
      const match = GENRES.find(
        (g) => String(g.id) === String(params.genre) || g.name.toLowerCase() === String(params.genre).toLowerCase()
      );
      if (match) initialGenreId = match.id;
    }
    let activeGenreId = initialGenreId;

    let initialSortId = 'popularity.desc';
    if (params.sort && SORTS.some((s) => s.id === params.sort)) {
      initialSortId = params.sort;
    }
    let activeSortId = initialSortId;

    let discoverRequestId = 0;

    if (genresRoot) {
      clear(genresRoot);
      for (const g of GENRES) {
        const tab = el('button', {
          class: 'genre-tab',
          type: 'button',
          role: 'tab',
          dataset: { genreId: String(g.id) },
          ariaSelected: String(g.id === activeGenreId),
          text: g.name,
        });
        on(tab, 'click', () => {
          if (activeGenreId === g.id) return;
          hapticImpact('light');
          selectGenre(g.id);
        });
        genresRoot.append(tab);
      }

      if (activeGenreId !== 0) {
        requestAnimationFrame(() => {
          const activeBtn = genresRoot.querySelector(`[data-genre-id="${activeGenreId}"]`);
          activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
      }
      disposers.push(enableHorizontalScroll(genresRoot));
    }

    if (sortsRoot) {
      clear(sortsRoot);
      for (const s of SORTS) {
        const chip = el(
          'button',
          {
            class: 'sort-chip',
            type: 'button',
            dataset: { sortId: s.id },
            ariaPressed: String(s.id === activeSortId),
          },
          [icon(s.icon), el('span', { text: s.label })]
        );
        on(chip, 'click', () => {
          if (activeSortId === s.id) return;
          hapticImpact('light');
          selectSort(s.id);
        });
        sortsRoot.append(chip);
      }
      disposers.push(enableHorizontalScroll(sortsRoot));
    }
    if (recentTrack) {
      disposers.push(enableHorizontalScroll(recentTrack));
    }

    function selectSort(id) {
      activeSortId = id;
      if (sortsRoot) {
        for (const child of sortsRoot.children) {
          child.setAttribute('aria-pressed', String(child.dataset.sortId === id));
        }
      }
      loadCurrent();
    }

    function selectGenre(id) {
      activeGenreId = id;
      if (genresRoot) {
        for (const child of genresRoot.children) {
          child.setAttribute('aria-selected', String(child.dataset.genreId === String(id)));
        }
      }
      loadCurrent();
    }

    function loadCurrent() {
      if (activeGenreId === 0 && activeSortId === 'popularity.desc') {
        loadRails();
      } else {
        loadGenre(activeGenreId, activeSortId);
      }
    }

    let genreObserver = null;
    disposers.push(() => {
      if (genreObserver) {
        genreObserver.disconnect();
        genreObserver = null;
      }
    });

    async function loadRails() {
      if (genreObserver) {
        genreObserver.disconnect();
        genreObserver = null;
      }
      if (!railsRoot) return;
      const currentReq = ++discoverRequestId;
      clear(railsRoot);
      railsRoot.append(skeletonRail(4));

      try {
        const { rails, isMock } = await catalog.discover({ limit: 20 });
        if (currentReq !== discoverRequestId) return;
        clear(railsRoot);

        if (isMock) {
          const notice = await banner({
            variant: 'info',
            text: 'Browse rails use the local fixture catalog because no movie database key is configured.',
          });
          railsRoot.append(notice);
        }

        for (const rail of rails) {
          if (rail.items.length === 0) continue;
          const section = el('section', { class: 'rail' });
          section.append(
            el('div', { class: 'rail__header' }, [el('h2', { class: 'rail__title', text: rail.title })])
          );

          const track = el('div', { class: 'rail__track' });
          for (const item of rail.items) {
            track.append(
              posterCard(item, {
                onSelect: (selected) => router.navigate(`/detail/${selected.mediaType}/${selected.tmdbId}`),
              })
            );
          }
          section.append(track);
          railsRoot.append(section);
        }
      } catch (error) {
        if (currentReq !== discoverRequestId) return;
        clear(railsRoot);
        if (error?.kind === Failure.OFFLINE) return; // the offline bar already says it
        railsRoot.append(
          await banner({
            variant: 'info',
            text: 'Popular titles could not be loaded right now. Recognition still works.',
          })
        );
      }
    }

    async function loadGenre(genreId, sortBy = 'popularity.desc') {
      if (genreObserver) {
        genreObserver.disconnect();
        genreObserver = null;
      }
      if (!railsRoot) return;
      const currentReq = ++discoverRequestId;
      clear(railsRoot);
      railsRoot.append(skeletonRail(4));

      const genreMeta = GENRES.find((g) => g.id === genreId);
      const sortMeta = SORTS.find((s) => s.id === sortBy) || SORTS[0];
      let titleHeading = 'Titles';
      let emptyGenreLabel = 'titles';
      if (genreId === 0) {
        titleHeading = sortMeta.label;
        emptyGenreLabel = sortMeta.label.toLowerCase();
      } else {
        const gName = genreMeta ? genreMeta.name : 'Titles';
        titleHeading = sortBy === 'popularity.desc' ? gName : `${gName} · ${sortMeta.label}`;
        emptyGenreLabel = `${gName} titles`;
      }

      let currentPage = 1;
      let hasMore = true;
      let isLoadingMore = false;
      const seenKeys = new Set();

      try {
        const result = await catalog.discoverByGenre(genreId, { page: 1, sortBy });
        if (currentReq !== discoverRequestId) return;
        clear(railsRoot);

        const rawItems = result?.items ?? [];
        const isMock = result?.isMock;

        if (isMock) {
          const notice = await banner({
            variant: 'info',
            text: 'Browse titles use the local fixture catalog because no movie database key is configured.',
          });
          railsRoot.append(notice);
        }

        const items = rawItems.filter((item) => {
          const key = `${item.mediaType}:${item.tmdbId}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });

        const section = el('section', { class: 'genre-results' });
        const countText = items.length === 1 ? '1 title' : `Showing ${items.length} titles`;
        const countEl = el('span', { class: 'genre-results__count', text: countText });
        const head = el('div', { class: 'genre-results__head' }, [
          el('h2', { class: 'genre-results__title', text: titleHeading }),
          countEl,
        ]);
        section.append(head);

        if (items.length === 0) {
          section.append(
            el('p', {
              class: 't-body',
              style: { color: 'var(--c-text-3)', padding: '24px 0' },
              text: `No ${emptyGenreLabel} found in this catalog.`,
            })
          );
          railsRoot.append(section);
          return;
        }

        const grid = el('div', { class: 'poster-grid stagger' });
        for (const item of items) {
          grid.append(
            posterCard(item, {
              onSelect: (selected) => router.navigate(`/detail/${selected.mediaType}/${selected.tmdbId}`),
            })
          );
        }
        section.append(grid);

        if (result?.hasMore === false || (result?.totalPages && currentPage >= result.totalPages)) {
          hasMore = false;
        }

        const footer = el('div', { class: 'genre-results__footer' });
        const statusEl = el('p', { class: 'genre-results__status' });
        const sentinel = el('div', { class: 'genre-sentinel', 'aria-hidden': 'true' });
        const loadMoreBtn = el('button', {
          class: 'btn btn--secondary btn--sm',
          type: 'button',
          text: 'Load more titles',
        });

        async function loadNextPage() {
          if (isLoadingMore || !hasMore || currentReq !== discoverRequestId) return;
          isLoadingMore = true;
          loadMoreBtn.disabled = true;
          loadMoreBtn.textContent = 'Loading more...';
          statusEl.textContent = 'Fetching more titles...';

          try {
            const nextPage = currentPage + 1;
            const nextResult = await catalog.discoverByGenre(genreId, { page: nextPage, sortBy });
            if (currentReq !== discoverRequestId) return;

            const nextRawItems = nextResult?.items ?? [];
            const newItems = nextRawItems.filter((it) => {
              const key = `${it.mediaType}:${it.tmdbId}`;
              if (seenKeys.has(key)) return false;
              seenKeys.add(key);
              return true;
            });

            if (newItems.length > 0) {
              currentPage = nextPage;
              for (const item of newItems) {
                grid.append(
                  posterCard(item, {
                    onSelect: (selected) => router.navigate(`/detail/${selected.mediaType}/${selected.tmdbId}`),
                  })
                );
              }
              countEl.textContent = `Showing ${seenKeys.size} titles`;
            }

            if (nextResult?.hasMore === false || nextRawItems.length === 0 || (nextResult?.totalPages && currentPage >= nextResult.totalPages)) {
              hasMore = false;
            }

            if (!hasMore) {
              loadMoreBtn.remove();
              sentinel.remove();
              if (genreObserver) {
                genreObserver.disconnect();
                genreObserver = null;
              }
              statusEl.textContent = `Showing all ${seenKeys.size} titles`;
            } else {
              loadMoreBtn.disabled = false;
              loadMoreBtn.textContent = 'Load more titles';
              statusEl.textContent = '';
            }
          } catch {
            if (currentReq !== discoverRequestId) return;
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = 'Try loading more';
            statusEl.textContent = 'Could not load more titles right now.';
          } finally {
            isLoadingMore = false;
          }
        }

        if (hasMore) {
          on(loadMoreBtn, 'click', () => loadNextPage());
          footer.append(loadMoreBtn, statusEl, sentinel);
          section.append(footer);

          if (typeof IntersectionObserver !== 'undefined') {
            genreObserver = new IntersectionObserver(
              (entries) => {
                if (entries[0]?.isIntersecting) {
                  loadNextPage();
                }
              },
              { rootMargin: '300px' }
            );
            genreObserver.observe(sentinel);
          }
        } else {
          statusEl.textContent = `Showing all ${seenKeys.size} titles`;
          footer.append(statusEl);
          section.append(footer);
        }

        railsRoot.append(section);
      } catch (error) {
        if (currentReq !== discoverRequestId) return;
        clear(railsRoot);
        if (error?.kind === Failure.OFFLINE) return;
        railsRoot.append(
          await banner({
            variant: 'info',
            text: `${titleHeading} could not be loaded right now.`,
          })
        );
      }
    }

    // Initial content load based on activeGenreId and activeSortId
    loadCurrent();

    return () => {
      disposers.forEach((dispose) => dispose?.());
    };
  },
};
