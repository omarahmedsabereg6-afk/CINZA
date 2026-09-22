/**
 * RESULT (sections 14, 15, 16, 17, 29).
 *
 * The most important honesty surface in the app. Specifically:
 *
 *  - `isMock` produces a visible "Simulated result" banner. A mocked identification
 *    is never allowed to look like a real one (section 32).
 *  - The Matched Scene block shows a reference frame ONLY when the SceneMatcher
 *    actually matched one. Otherwise it explains that it has no frame-level
 *    reference, rather than pairing the screenshot with an unrelated still.
 *  - The timestamp is taken verbatim from the server and, when absent, the exact
 *    required copy is shown: "Scene identified — exact timestamp unavailable."
 *    No timestamp is ever invented (section 15).
 *  - Confidence is shown with its margin and a plain-language verdict, so a 51%
 *    guess does not read like certainty.
 */
import { el, qs, on, clear, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, toastError, hapticNotify, hapticImpact, openSheet } from '../core/feedback.js';
import * as historyService from '../services/history.js';
import * as watchlistService from '../services/watchlist.js';
import * as catalog from '../services/catalog.js';
import * as recognitionService from '../services/recognition.js';
import settings from '../services/settings.js';
import { getCapabilities } from '../services/capabilities.js';
import { KNOWN_COUNTRIES, countryName } from '../core/countries.js';
import { AppError, Failure } from '../core/errors.js';
import { mountArtwork } from '../ui/artwork.js';
import {
  banner,
  confidenceMeter,
  verdictPill,
  signalList,
  providerGroups,
  skeletonBlock,
  emptyState,
} from '../ui/components.js';
import { year, mediaTypeLabel, runtime, seasonEpisode, duration } from '../core/format.js';

export default {
  title: 'Result',
  tab: null,

  async mount({ root, params }) {
    const id = params.id;
    let recognition = null;
    let saved = false;

    const posterSlot = qs('#result-poster', root);
    const backdrop = qs('#result-backdrop', root);
    const titleNode = qs('#result-title', root);
    const originalNode = qs('#result-original', root);
    const metaNode = qs('#result-meta', root);
    const notices = qs('#result-notices', root);
    const verdictNode = qs('#result-verdict', root);
    const confidenceWrap = qs('#result-confidence', root);
    const confidenceValue = qs('#result-confidence-value', root);
    const confidenceNote = qs('#result-confidence-note', root);
    const marginNode = qs('#result-margin', root);
    const sceneCompare = qs('#scene-compare', root);
    const sceneFacts = qs('#scene-facts', root);
    const watchBody = qs('#watch-body', root);
    const watchSection = qs('#watch-section', root);
    const whyNode = qs('#result-why', root);
    const altSection = qs('#alt-section', root);
    const altNode = qs('#result-alternatives', root);
    const feedbackNode = qs('#result-feedback', root);
    const saveButton = qs('#result-save', root);
    const watchButton = qs('#result-watch', root);
    const detailsButton = qs('#result-details', root);

    /* ------------------------------------------------------------------ *
     * Load
     * ------------------------------------------------------------------ */
    async function load() {
      const cached = store.getState().lastResult;
      if (cached?.id === id) return cached;

      try {
        const fromHistory = await historyService.get(id);
        if (fromHistory) return fromHistory;
      } catch (error) {
        console.warn('[result] falling back to API', error?.message ?? error);
      }

      return recognitionService.fetchRecognition(id);
    }

    showLoading();
    try {
      recognition = await load();
    } catch (error) {
      renderError(error);
      return () => {};
    }

    if (!recognition) {
      renderError(new AppError(Failure.UNKNOWN, { message: 'That recognition is no longer available.' }));
      return () => {};
    }

    hideLoading();

    /* ------------------------------------------------------------------ *
     * Match may be absent for a stored no-match entry
     * ------------------------------------------------------------------ */
    const match = recognition.match ?? recognition.result?.match ?? null;

    if (!match) {
      await renderNoMatch();
      return bindCommon();
    }

    /* ------------------------------------------------------------------ *
     * Hero
     * ------------------------------------------------------------------ */
    titleNode.textContent = match.title ?? 'Untitled';

    if (match.originalTitle && match.originalTitle !== match.title) {
      originalNode.hidden = false;
      originalNode.textContent = match.originalTitle;
    }

    if (match.backdropUrl) {
      backdrop.hidden = false;
      backdrop.alt = `${match.title} backdrop`;
      backdrop.src = match.backdropUrl;
    }

    mountArtwork(posterSlot, { url: match.posterUrl, title: match.title });

    const metaParts = [
      year(match.year) || null,
      mediaTypeLabel(match.mediaType),
      match.runtime ? runtime(match.runtime) : null,
    ].filter(Boolean);

    for (const [index, part] of metaParts.entries()) {
      if (index > 0) metaNode.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
      metaNode.append(el('span', { text: part }));
    }

    if (match.voteAverage) {
      metaNode.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
      const rating = el('span', { class: 'rating' });
      rating.append(icon('i-star'), el('span', { text: match.voteAverage.toFixed(1) }));
      metaNode.append(rating);
    }

    /* ------------------------------------------------------------------ *
     * Confidence
     * ------------------------------------------------------------------ */
    const confidence = Math.round(match.confidence ?? 0);
    const verdict = match.verdict ?? 'uncertain';

    // The meter and pill are replaced wholesale (they are simpler to rebuild than to
    // mutate), so the ids are carried over. Otherwise `#result-confidence` disappears
    // and anything that queries it afterwards — including tests and the a11y tree —
    // silently sees nothing.
    const pill = verdictPill({ verdict, label: match.verdictLabel ?? 'Unecertain' });
    pill.id = 'result-verdict';
    verdictNode.replaceWith(pill);

    const meter = confidenceMeter({ confidence, verdict });
    meter.id = 'result-confidence';
    const meterValue = meter.querySelector('.confidence__value');
    if (meterValue) meterValue.id = 'result-confidence-value';
    confidenceWrap.replaceWith(meter);


    if (match.margin !== null && match.margin !== undefined) {
      const pct = Math.round(match.margin * 100);
      marginNode.textContent =
        pct <= 5
          ? 'Close call — other candidates scored almost the same.'
          : `${pct}% clear of the next candidate.`;
    }

    const thresholdNote = {
      strong: 'Strong agreement between the visual evidence and the database records.',
      likely: 'Good agreement. Details are worth a quick check.',
      uncertain: 'Weak agreement. Please confirm whether this is correct.',
    }[verdict];

    confidenceNote.textContent =
      recognition.isMock
        ? 'Simulated confidence. This result came from the mock adapter, not from a real image analysis.'
        : thresholdNote ?? '';

    /* ------------------------------------------------------------------ *
     * Notices (honesty first)
     * ------------------------------------------------------------------ */
    const noticeNodes = [];
    if (recognition.isMock || recognition.mockNotice) {
      const node = await banner({
        variant: 'mock',
        title: 'Simulated result',
        text:
          recognition.mockNotice ??
          'No AI provider is configured, so this identification was produced by the mock adapter and is not a real recognition.',
      });
      noticeNodes.push(node);
    }
    if (recognition.isCached) {
      noticeNodes.push(
        await banner({
          variant: 'info',
          text: 'This exact image was recognised before, so the stored answer was reused instead of calling the services again.',
        })
      );
    }
    if (verdict === 'uncertain') {
      noticeNodes.push(
        await banner({
          variant: 'warn',
          icon: 'i-warning',
          text: 'Confidence is low. Use the buttons below to confirm or correct the result — that improves future matches.',
        })
      );
    }
    notices.append(...noticeNodes);

    /* ------------------------------------------------------------------ *
     * Matched Scene (section 15)
     * ------------------------------------------------------------------ */
    renderScene(recognition.scene ?? {});

    /* ------------------------------------------------------------------ *
     * Actions
     * ------------------------------------------------------------------ */
    watchButton.addEventListener('click', () => {
      hapticImpact('light');
      watchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    detailsButton.addEventListener('click', () => {
      router.navigate(`/detail/${match.mediaType}/${match.tmdbId}`);
    });

    // Save state is resolved before the user can tap, so the button never lies.
    const existing = await watchlistService.has({ mediaType: match.mediaType, tmdbId: match.tmdbId }).catch(() => ({ saved: false }));
    saved = existing.saved;
    paintSaveButton();

    saveButton.addEventListener('click', async () => {
      hapticImpact('light');
      saveButton.disabled = true;
      try {
        if (saved && existing.id) {
          await watchlistService.remove({ id: existing.id, mediaType: match.mediaType, tmdbId: match.tmdbId });
          saved = false;
          toast('Removed from your watchlist.', { variant: 'info' });
        } else {
          const item = await watchlistService.add({
            mediaType: match.mediaType,
            tmdbId: match.tmdbId,
            title: match.title,
            posterUrl: match.posterUrl,
            year: match.year,
          });
          existing.id = item?.id ?? null;
          saved = true;
          toast(
            watchlistService.isAuthenticated() ? 'Saved to your watchlist.' : 'Saved on this device.',
            { variant: 'success' }
          );
        }
        paintSaveButton();
      } catch (error) {
        toastError(error);
      } finally {
        saveButton.disabled = false;
      }
    });

    function paintSaveButton() {
      saveButton.setAttribute('aria-pressed', String(saved));
      clear(saveButton);
      saveButton.append(icon('i-bookmark'), el('span', { text: saved ? 'Saved' : 'Save' }));
      saveButton.classList.toggle('btn--primary', false);
    }

    /* ------------------------------------------------------------------ *
     * Why this match
     * ------------------------------------------------------------------ */
    const signals = match.whyThisMatch ?? [];
    if (signals.length > 0) {
      whyNode.append(await signalList(signals));
    } else {
      whyNode.append(el('p', { class: 't-body', text: 'No scoring detail was recorded for this recognition.' }));
    }

    const verification = match.verification;
    if (verification?.notes?.length) {
      const list = el('div', { style: { marginTop: '12px' } });
      for (const note of verification.notes) {
        list.append(
          el('div', { class: 'signal' }, [
            el('div', { class: 'signal__top' }, [
              el('span', { class: 'signal__name', text: note.kind === 'penalty' ? 'Contradiction found' : 'Corroboration' }),
              el('span', {
                class: 'signal__score',
                text: note.delta > 0 ? `+${Math.round(note.delta * 100)}` : String(Math.round(note.delta * 100)),
              }),
            ]),
            el('p', { class: 'signal__detail', text: note.reason }),
          ])
        );
      }
      whyNode.append(list);
    }

    /* ------------------------------------------------------------------ *
     * Alternatives
     * ------------------------------------------------------------------ */
    if ((match.alternatives ?? []).length > 0) {
      altSection.hidden = false;
      for (const alt of match.alternatives) {
        const row = el('button', { class: 'alt-row', type: 'button' });
        const art = el('span', { class: 'alt-row__art' });
        mountArtwork(art, { url: alt.posterUrl, title: alt.title, compact: true });
        row.append(art);

        row.append(
          el('span', { class: 'alt-row__text' }, [
            el('span', { class: 'media-row__title', text: alt.title }),
            el('span', { class: 'media-row__meta', text: [year(alt.year), mediaTypeLabel(alt.mediaType)].filter(Boolean).join(' · ') }),
          ])
        );

        row.append(el('span', { class: 'alt-row__score', text: `${Math.round(alt.score)}%` }));

        on(row, 'click', () => router.navigate(`/detail/${alt.mediaType}/${alt.tmdbId}`));
        altNode.append(row);
      }
    }

    /* ------------------------------------------------------------------ *
     * Feedback (section 29)
     * ------------------------------------------------------------------ */
    renderFeedback();

    /* ------------------------------------------------------------------ *
     * Where to Watch (section 17) — loaded last, never blocks the result
     * ------------------------------------------------------------------ */
    loadAvailability();

    return bindCommon();

    /* ================================================================== *
     * Helpers
     * ================================================================== */

    function bindCommon() {
      const onRegionChanged = () => {
        loadAvailability({ refresh: true });
      };
      window.addEventListener('cinza:region-changed', onRegionChanged);

      const disposers = [
        () => window.removeEventListener('cinza:region-changed', onRegionChanged),
        on(qs('#result-back', root), 'click', () => router.back('/home')),
        on(qs('#result-share', root), 'click', shareResult),
        on(qs('#result-more', root), 'click', showMore),
      ];
      announce(`${titleNode.textContent}${confidence ? `, ${confidence} percent confidence` : ''}`);
      return () => disposers.forEach((dispose) => dispose?.());
    }

    function renderScene(scene) {
      clear(sceneCompare);
      clear(sceneFacts);

      /* --- comparison strip: user frame vs matched reference --- */
      const userFrame = el('div', { class: 'scene__frame' });
      if (scene.userThumb) {
        userFrame.append(el('img', { src: scene.userThumb, alt: 'The scene you captured', loading: 'lazy' }));
      } else {
        userFrame.append(el('div', { class: 'scene__empty' }, [el('span', { text: 'No preview stored' })]));
      }
      userFrame.append(el('span', { class: 'scene__frame-label', text: 'Your image' }));
      sceneCompare.append(userFrame);

      sceneCompare.append(icon('i-chevron-right', { className: 'scene__link' }));

      if (scene.referenceImage) {
        const refFrame = el('div', { class: 'scene__frame' });
        refFrame.append(el('img', { src: scene.referenceImage, alt: 'Matched reference frame', loading: 'lazy' }));
        refFrame.append(el('span', { class: 'scene__frame-label', text: 'Matched frame' }));
        sceneCompare.append(refFrame);
      } else {
        sceneCompare.append(
          el('div', { class: 'scene__empty' }, [
            el('span', {
              text:
                'No frame-level reference. Exact scene matching only covers frames this deployment has already confirmed.',
            }),
          ])
        );
      }

      /* --- facts --- */
      const fact = (iconName, text, { muted = false } = {}) => {
        const node = el('div', { class: `scene__fact${muted ? ' scene__fact--muted' : ''}` });
        node.append(icon(iconName), el('span', { text }));
        return node;
      };

      // Timestamp: verbatim from the server. Never synthesised.
      if (scene.timestamp) {
        sceneFacts.append(fact('i-clock', `Timestamp ${scene.timestamp}`));
      } else {
        sceneFacts.append(fact('i-clock', scene.timestampLabel ?? 'Scene identified — exact timestamp unavailable.', { muted: true }));
      }

      if (scene.seasonNumber != null || scene.episodeNumber != null) {
        const label = seasonEpisode(scene.seasonNumber, scene.episodeNumber);
        sceneFacts.append(fact('i-tv', `${label}${scene.sceneTitle ? ` · ${scene.sceneTitle}` : ''}`));
      }

      if (scene.description) sceneFacts.append(fact('i-eye', scene.description));
      if (scene.visibleText) sceneFacts.append(fact('i-info', `On-screen text: “${scene.visibleText}”`));

      if ((scene.clues ?? []).length > 0) {
        sceneFacts.append(fact('i-sparkle', `Visual clues: ${scene.clues.slice(0, 5).join(', ')}`));
      }

      if ((scene.frameCount ?? 1) > 1) {
        sceneFacts.append(fact('i-video', `Fused from ${scene.frameCount} video frames.`));
      }

      if (scene.episodeNotice) sceneFacts.append(fact('i-warning', scene.episodeNotice, { muted: true }));
    }

    async function loadAvailability({ refresh = false } = {}) {
      clear(watchBody);
      watchBody.append(skeletonBlock(2));

      try {
        const availability = await catalog.availability(match.mediaType, match.tmdbId, { refresh });
        clear(watchBody);

        watchBody.append(providerGroups(availability));
        watchButton.disabled = !availability.hasAny;
        if (!availability.hasAny) watchButton.setAttribute('aria-disabled', 'true');
        else watchButton.removeAttribute('aria-disabled');
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

    function renderFeedback() {
      clear(feedbackNode);

      if (recognition.feedbackSubmitted) {
        feedbackNode.append(el('p', { class: 't-body', text: 'Thanks — your feedback was recorded.' }));
        return;
      }

      const row = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });

      const yes = el('button', { class: 'btn btn--secondary', type: 'button' });
      yes.append(icon('i-eye'), el('span', { text: 'Yes, that is it' }));

      const no = el('button', { class: 'btn btn--ghost', type: 'button' });
      no.append(icon('i-close'), el('span', { text: 'No, it is something else' }));

      on(yes, 'click', async () => {
        yes.disabled = true;
        try {
          await recognitionService.sendFeedback({ recognitionId: recognition.id, correct: true });
          hapticNotify('success');
          clear(feedbackNode);
          feedbackNode.append(el('p', { class: 't-body', text: 'Thanks — that helps tune the matching engine.' }));
        } catch (error) {
          yes.disabled = false;
          toastError(error);
        }
      });

      on(no, 'click', () => {
        openSheet({
          title: 'What was it?',
          content: el('div', {}, [
            el('p', {
              class: 't-body',
              text: 'Tell us the correct title. Corrections are stored with the recognition and improve future matches.',
            }),
          ]),
          actions: [
            {
              label: 'Search for the correct title',
              variant: 'primary',
              onClick: () => router.navigate('/search'),
            },
            {
              label: 'Report as unidentifiable',
              variant: 'ghost',
              onClick: async () => {
                try {
                  await recognitionService.sendFeedback({
                    recognitionId: recognition.id,
                    correct: false,
                    correctedTitle: 'Unknown',
                  });
                  toast('Thanks — reported.', { variant: 'info' });
                } catch (error) {
                  toastError(error);
                }
              },
            },
          ],
        });
      });

      row.append(yes, no);
      feedbackNode.append(row);

      const hint = el('p', {
        class: 't-meta',
        style: { marginTop: '10px' },
        text: 'Feedback is stored anonymously unless you are signed in.',
      });
      feedbackNode.append(hint);
    }

    async function renderNoMatch() {
      titleNode.textContent = 'Not identified';
      clear(qs('.result__main', root)).append(
        await emptyState({
          art: 'i-search',
          title: 'We could not identify this scene',
          text:
            recognition.noMatchReason ??
            'Try a clearer, well-lit screenshot with faces or distinctive objects visible, or describe the scene in words.',
          actions: [
            { label: 'Try another image', variant: 'primary', onClick: () => router.navigate('/camera') },
            { label: 'Describe it instead', variant: 'secondary', onClick: () => router.navigate('/home') },
          ],
        })
      );
      qs('#result-confidence', root)?.remove();
      watchSection.remove();
      altSection.remove();
      removeAuxSections(root);
    }

    /** Removes the sections that make no sense without an identified title. */
    function removeAuxSections(container) {
      for (const selector of ['.scene', '#result-why', '#result-feedback']) {
        container.querySelector(selector)?.remove();
      }
    }

    async function shareResult() {
      const text = match
        ? `${match.title}${match.year ? ` (${match.year})` : ''} — identified with CINZA at ${confidence}% confidence.`
        : 'Identified with CINZA.';

      try {
        if (navigator.share) {
          await navigator.share({ title: match?.title ?? 'CINZA', text });
          return;
        }
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard.', { variant: 'success' });
      } catch {
        toast('Sharing is not available on this device.', { variant: 'warn' });
      }
    }

    function showMore() {
      openSheet({
        title: 'Result options',
        content: el('p', {
          class: 't-body',
          text: 'Everything below is real data returned by the pipeline for this recognition.',
        }),
        actions: [
          {
            label: match.mediaType === 'tv' ? 'Open series details' : 'Open movie details',
            variant: 'secondary',
            onClick: () => router.navigate(`/detail/${match.mediaType}/${match.tmdbId}`),
          },
          {
            label: 'Report a problem with this result',
            variant: 'ghost',
            onClick: () => toast('Feedback is available at the bottom of this page.', { variant: 'info' }),
          },
          {
            label: 'Show stored pipeline detail',
            variant: 'ghost',
            onClick: () => {
              recognitionService.fetchRecognition(recognition.id).then((full) => {
                openSheet({
                  title: 'Pipeline detail',
                  content: el('pre', {
                    class: 't-mono',
                    style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '52vh', overflow: 'auto' },
                    text: JSON.stringify(
                      {
                        telemetry: full.telemetry ?? null,
                        providers: recognition.providers ?? null,
                        processingMs: recognition.processingMs ?? full.processingMs ?? null,
                        candidates: (full.candidates ?? []).map((c) => ({ title: c.title, score: Number(c.score.toFixed(3)) })),
                        alternatives: match.alternatives ?? [],
                      },
                      null,
                      2
                    ),
                  }),
                });
              });
            },
          },
        ],
      });
    }

    function showLoading() {
      clear(sceneCompare);
      sceneCompare.append(el('div', { class: 'skeleton', style: { height: '120px' } }));
      clear(watchBody);
      watchBody.append(skeletonBlock(2));
      clear(whyNode);
      whyNode.append(el('div', { class: 'skeleton skeleton--line' }));
      announce('Loading result');
    }

    function hideLoading() {
      clear(sceneCompare);
      clear(watchBody);
      clear(whyNode);
    }

    function renderError(error) {
      const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });
      clear(root);
      root.append(
        el('div', { class: 'view__pad' }, [
          el('h1', { class: 't-title', style: { marginBottom: '16px' }, text: appError.title ?? 'Something went wrong' }),
          el('p', { class: 't-body', text: appError.text ?? 'Please try again.' }),
          el('div', { style: { marginTop: '20px', display: 'flex', gap: '8px' } }, [
            el('button', {
              class: 'btn btn--primary',
              type: 'button',
              text: 'Back to home',
              on: { click: () => router.navigate('/home', { replace: true }) },
            }),
          ]),
        ])
      );
    }
  },
};
