/**
 * HISTORY (section 18).
 *
 * Native-style list with swipe-free explicit actions, because an explicit delete
 * button is more discoverable and more accessible than a hidden gesture.
 *
 * The screen never implies storage it does not have: for anonymous users it says
 * plainly that entries live on this device, and offers sign-in to sync.
 */
import { el, qs, on, clear, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { store, actions } from '../core/store.js';
import { toast, toastError, confirm, hapticImpact } from '../core/feedback.js';
import * as historyService from '../services/history.js';
import { AppError, Failure } from '../core/errors.js';
import { emptyState, skeletonBlock, banner, confidenceMeter } from '../ui/components.js';
import { relativeDate, year, mediaTypeLabel, seasonEpisode } from '../core/format.js';

export default {
  title: 'History',
  tab: 'history',

  async mount({ root }) {
    const body = qs('#history-body', root);
    const subtitle = qs('#history-subtitle', root);
    const storageNotice = qs('#history-storage-notice', root);
    const clearButton = qs('#history-clear', root);

    let items = [];
    let loading = true;

    async function load({ silent = false } = {}) {
      if (!silent) {
        clear(body);
        body.append(skeletonBlock(5));
      }
      loading = true;

      try {
        const result = await historyService.list({ limit: 40 });
        items = result.items;
        clear(body);

        const scope = result.storage === 'server' ? 'Synced to your account' : 'Stored on this device';
        subtitle.textContent =
          items.length === 0 ? scope : `${items.length} recognitions · ${scope}`;

        clear(storageNotice);
        if (result.notice) {
          storageNotice.append(
            await banner({
              variant: 'info',
              title: null,
              text: result.notice,
              actions: false,
            })
          );
        }

        clearButton.hidden = items.length === 0;

        if (items.length === 0) {
          body.append(
            await emptyState({
              art: 'i-history',
              title: 'No recognitions yet',
              text: 'Point your camera at a scene and CINZA will remember what it found here.',
              actions: [
                { label: 'Recognise a scene', variant: 'primary', onClick: () => router.navigate('/home') },
              ],
            })
          );
          return;
        }

        const list = el('div', { class: 'stagger' });
        items.forEach((item, index) => {
          list.append(historyRow(item, index));
        });
        body.append(list);
        announce(`${items.length} recognitions`);
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

    /* ------------------------------------------------------------------ *
     * Row
     * ------------------------------------------------------------------ */
    function historyRow(item, index) {
      const row = el('div', { class: 'history-item', style: { '--i': String(index) } });

      const title = item.match?.title ?? (item.status === 'no_match' ? 'Not identified' : 'Recognition failed');

      /* --- tappable region (everything except the delete button) --- */
      const openTarget = el('button', {
        type: 'button',
        class: 'history-item__open',
        'aria-label': `Open ${title}`,
        style: {
          display: 'flex',
          gap: 'var(--s-3)',
          flex: '1 1 auto',
          minWidth: '0',
          textAlign: 'left',
          alignItems: 'flex-start',
          background: 'none',
        },
      });

      const art = el('span', { class: `history-item__art${item.match ? '' : ' history-item__art--miss'}` });
      if (item.thumbDataUrl) {
        art.append(el('img', { src: item.thumbDataUrl, alt: '', loading: 'lazy', decoding: 'async' }));
      } else {
        art.append(icon(item.match ? 'i-film' : 'i-search'));
      }
      openTarget.append(art);

      const bodyNode = el('span', { class: 'history-item__body' });
      bodyNode.append(el('span', { class: 'history-item__title', text: title }));

      const metaParts = [
        item.match ? year(item.match.year) : null,
        item.match ? mediaTypeLabel(item.match.mediaType) : null,
        item.match?.seasonNumber != null ? seasonEpisode(item.match.seasonNumber, item.match.episodeNumber) : null,
        relativeDate(item.createdAt),
      ].filter(Boolean);

      const metaRow = el('span', { class: 'history-item__meta' });
      for (const [i, part] of metaParts.entries()) {
        if (i > 0) metaRow.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
        metaRow.append(el('span', { text: part }));
      }
      if (item.isMock) metaRow.append(el('span', { class: 'pill pill--mock', text: 'Simulated' }));
      if (item.local) metaRow.append(el('span', { class: 'pill pill--uncertain', text: 'On device' }));

      bodyNode.append(metaRow);
      openTarget.append(bodyNode);
      row.append(openTarget);

      /* --- right side: confidence + delete --- */
      const right = el('span', { class: 'history-item__right' });

      if (typeof item.confidence === 'number' && item.match) {
        const band = item.confidence >= 76 ? 'strong' : item.confidence >= 56 ? 'likely' : 'uncertain';
        const tone =
          band === 'strong'
            ? 'var(--c-confidence-strong)'
            : band === 'likely'
              ? 'var(--c-confidence-likely)'
              : 'var(--c-text-2)';
        right.append(el('span', { class: 'history-item__confidence', style: { color: tone }, text: `${Math.round(item.confidence)}%` }));
      }

      const deleteButton = el('button', {
        class: 'icon-btn icon-btn--plain',
        type: 'button',
        'aria-label': `Delete ${title}`,
      });
      deleteButton.append(icon('i-trash'));
      right.append(deleteButton);
      row.append(right);

      /* --- behaviour --- */
      on(openTarget, 'click', () => {
        if (item.match) router.navigate(`/detail/${item.match.mediaType}/${item.match.tmdbId}`);
        else toast('This recognition did not identify a title.', { variant: 'info' });
      });

      on(deleteButton, 'click', async (event) => {
        event.stopPropagation();
        const confirmed = await confirm({
          title: 'Delete this entry?',
          message: 'The stored preview and match data will be removed.',
          confirmLabel: 'Delete',
          destructive: true,
        });
        if (!confirmed) return;
        hapticImpact('light');
        try {
          await historyService.remove(item.id);
          items = items.filter((entry) => entry.id !== item.id);
          row.remove();
          const scope = historyService.isAuthenticated() ? 'Synced to your account' : 'Stored on this device';
          subtitle.textContent = items.length === 0 ? scope : `${items.length} recognitions · ${scope}`;
          if (items.length === 0) await load({ silent: true });
          toast('Deleted.', { variant: 'info' });
        } catch (error) {
          toastError(error);
        }
      });

      return row;
    }

    /* ------------------------------------------------------------------ *
     * Clear all
     * ------------------------------------------------------------------ */
    const clearAll = async () => {
      const confirmed = await confirm({
        title: 'Clear all history?',
        message:
          historyService.isAuthenticated()
            ? 'Every recognition on your account will be permanently deleted.'
            : 'Every recognition stored on this device will be permanently deleted.',
        confirmLabel: 'Clear everything',
        destructive: true,
      });
      if (!confirmed) return;

      try {
        const result = await historyService.clear();
        toast(`Cleared ${result.deleted ?? 0} entr${result.deleted === 1 ? 'y' : 'ies'}.`, { variant: 'success' });
        await load();
      } catch (error) {
        toastError(error);
      }
    };

    const disposers = [
      on(clearButton, 'click', clearAll),
      // Refresh when the session changes: switching accounts must not show a stale list.
      store.subscribe(['session'], () => load({ silent: true })),
      store.subscribe(['historyRevision'], () => {
        if (!loading) load({ silent: true });
      }),
    ];

    await load();

    return () => disposers.forEach((dispose) => dispose?.());
  },
};
