/**
 * WATCHLIST (section 19).
 *
 * Poster cards for movies and series, with the episode reference shown when a
 * single episode was saved. Filterable, and honest about where the list lives.
 */
import { el, qs, on, clear, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, toastError, confirm, hapticImpact, openSheet } from '../core/feedback.js';
import * as watchlistService from '../services/watchlist.js';
import { AppError, Failure } from '../core/errors.js';
import { emptyState, skeletonBlock, banner, posterCard, mediaRow } from '../ui/components.js';
import { year, mediaTypeLabel, relativeDate } from '../core/format.js';

export default {
  title: 'Watchlist',
  tab: 'watchlist',

  async mount({ root }) {
    const body = qs('#watchlist-body', root);
    const subtitle = qs('#watchlist-subtitle', root);
    const clearButton = qs('#watchlist-clear', root);
    const filter = qs('#watchlist-filter', root);

    let filterValue = 'all';
    let items = [];
    let loading = false;

    async function load({ silent = false } = {}) {
      if (loading) return;
      loading = true;

      if (!silent) {
        clear(body);
        body.append(skeletonBlock(3));
      }

      try {
        const result = await watchlistService.list({ mediaType: filterValue === 'all' ? undefined : filterValue });
        items = result.items;
        clear(body);

        const scope = result.storage === 'server' ? 'Synced to your account' : 'Saved on this device';
        subtitle.textContent = items.length === 0 ? scope : `${items.length} saved · ${scope}`;
        clearButton.hidden = items.length === 0;

        if (items.length === 0) {
          body.append(
            await emptyState({
              art: 'i-bookmark',
              title: filterValue === 'all' ? 'Nothing saved yet' : 'Nothing saved in this filter',
              text: 'Tap Save on a result or a title page and it will appear here.',
              actions: [
                { label: 'Find a film', variant: 'primary', onClick: () => router.navigate('/search') },
                { label: 'Recognise a scene', variant: 'secondary', onClick: () => router.navigate('/home') },
              ],
            })
          );
          return;
        }

        if (result.notice) {
          body.append(await banner({ variant: 'info', text: result.notice }));
        }

        /* Grouping: episodes of the same series are collapsed into one card with a
           count, so a binge of saved episodes does not bury everything else. */
        const grouped = groupItems(items);
        const grid = el('div', { class: 'poster-grid stagger', style: { marginTop: '16px' } });

        grouped.forEach((group, index) => {
          grid.append(watchlistCard(group, index));
        });

        body.append(grid);
        announce(`${items.length} saved items`);
      } catch (error) {
        clear(body);
        const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });
        body.append(
          await emptyState({
            art: appError.kind === Failure.OFFLINE ? 'i-offline' : 'i-warning',
            title: appError.title,
            text: appError.text,
            actions: appError.retryable ? [{ label: 'Try again', variant: 'primary', onClick: () => load() }] : [],
          })
        );
      } finally {
        loading = false;
      }
    }

    /** Collapses several episodes of one series into a single entry. */
    function groupItems(list) {
      const map = new Map();
      for (const item of list) {
        const key = `${item.mediaType}:${item.tmdbId}`;
        const existing = map.get(key);
        if (existing) {
          existing.episodes.push(item);
          continue;
        }
        map.set(key, { ...item, episodes: item.episodeRef ? [item] : [] });
      }
      return [...map.values()];
    }

    function watchlistCard(group, index) {
      const card = posterCard(
        { ...group, title: group.episodes.length > 1 ? `${group.title} (${group.episodes.length})` : group.title },
        { onSelect: () => openItem(group) }
      );
      card.style.setProperty('--i', String(index));

      // Episode reference for a single saved episode.
      if (group.episodes.length === 1) {
        const meta = card.querySelector('.poster-card__meta');
        if (meta) meta.textContent = `${meta.textContent ? `${meta.textContent} · ` : ''}${group.episodes[0].episodeRef}`;
      }

      return card;
    }

    function openItem(group) {
      const options = [];

      if (group.mediaType === 'tv' && group.episodes.length > 1) {
        options.push({
          label: 'View saved episodes',
          icon: 'i-tv',
          onClick: () => {
            const content = el('div');
            for (const episode of group.episodes) {
              content.append(
                mediaRow(
                  { title: episode.title, posterUrl: episode.posterUrl, mediaType: 'tv', year: episode.year },
                  {
                    subtitle: `${episode.episodeRef ?? ''} · saved ${relativeDate(episode.createdAt)}`,
                    onSelect: () => {
                      document.querySelector('.scrim')?.click();
                      setTimeout(() => router.navigate(`/detail/tv/${group.tmdbId}`), 200);
                    },
                  }
                )
              );
            }
            openSheet({ title: group.title, content });
          },
        });
      }

      options.push({
        label: 'Open title details',
        icon: 'i-info',
        onClick: () => router.navigate(`/detail/${group.mediaType}/${group.tmdbId}`),
      });

      options.push({
        label: group.episodes.length > 1 ? 'Remove all saved episodes' : 'Remove from watchlist',
        icon: 'i-trash',
        destructive: true,
        onClick: () => removeItem(group),
      });

      // A single tap opens details directly; the sheet is for the multi-episode case.
      if (group.episodes.length <= 1) {
        router.navigate(`/detail/${group.mediaType}/${group.tmdbId}`);
        return;
      }

      openSheet({
        title: `${group.title}${group.year ? ` (${group.year})` : ''}`,
        content: el('p', {
          class: 't-body',
          text: `${group.episodes.length} episodes saved from this series.`,
        }),
        actions: options.map(({ label, onClick, destructive }) => ({
          label,
          variant: destructive ? 'danger' : 'secondary',
          onClick,
        })),
      });
    }

    async function removeItem(group) {
      const confirmed = await confirm({
        title: 'Remove from watchlist?',
        message:
          group.episodes.length > 1
            ? `All ${group.episodes.length} saved episodes of “${group.title}” will be removed.`
            : `“${group.title}” will be removed.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;

      hapticImpact('light');
      try {
        if (group.episodes.length > 1) {
          for (const episode of group.episodes) {
            await watchlistService.remove({ id: episode.id, mediaType: 'tv', tmdbId: group.tmdbId });
          }
        } else {
          await watchlistService.remove({ id: group.id, mediaType: group.mediaType, tmdbId: group.tmdbId });
        }
        toast('Removed.', { variant: 'info' });
        await load({ silent: true });
      } catch (error) {
        toastError(error);
      }
    }

    const clearAll = async () => {
      const confirmed = await confirm({
        title: 'Clear the watchlist?',
        message: 'Every saved title will be removed.',
        confirmLabel: 'Clear everything',
        destructive: true,
      });
      if (!confirmed) return;
      try {
        const result = await watchlistService.clear();
        toast(`Cleared ${result.deleted ?? 0} item${result.deleted === 1 ? '' : 's'}.`, { variant: 'success' });
        await load();
      } catch (error) {
        toastError(error);
      }
    };

    const disposers = [on(clearButton, 'click', clearAll)];

    for (const tab of filter.querySelectorAll('[data-filter]')) {
      disposers.push(
        on(tab, 'click', () => {
          filterValue = tab.dataset.filter;
          for (const sibling of filter.children) sibling.setAttribute('aria-selected', 'false');
          tab.setAttribute('aria-selected', 'true');
          hapticImpact('light');
          load();
        })
      );
    }

    disposers.push(
      store.subscribe(['session'], () => load({ silent: true })),
      store.subscribe(['watchlistRevision'], () => load({ silent: true }))
    );

    await load();

    return () => {
      disposers.forEach(d => d());
    };
  },
};

