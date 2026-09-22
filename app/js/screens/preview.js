/**
 * PREVIEW + SCANNING + FAILURE (sections 9, 10, 27).
 *
 * One screen, three states, because they all describe the same object: the capture
 * sitting in `store.pending`.
 *
 *   PREVIEW   show what will be sent, with its real dimensions and size, and the
 *             extracted frames for a video, so nothing is hidden from the user
 *   SCANNING  the labelled progress sequence while the pipeline runs
 *   ERROR     an actionable message with a retry, never a dead end
 *
 * Cancellation is real: the request is aborted via AbortController, and the UI
 * returns to the preview state rather than pretending work is still happening.
 */
import { el, qs, on, clear, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, toastError, hapticNotify, confirm } from '../core/feedback.js';
import * as captureService from '../services/capture.js';
import * as recognition from '../services/recognition.js';
import * as historyService from '../services/history.js';
import { AppError, Failure } from '../core/errors.js';
import { fileSize, dimensions } from '../core/format.js';
import { banner } from '../ui/components.js';

export default {
  title: null,
  tab: null,
  chrome: 'fullscreen',

  async mount({ root }) {
    const image = qs('#preview-image', root);
    const stage = qs('.preview__stage', root);
    const bottom = qs('#preview-bottom', root);
    const dimsLabel = qs('#preview-dimensions', root);
    const sizeLabel = qs('#preview-filesize', root);
    const typeLabel = qs('#preview-type', root);
    const framesRow = qs('#preview-frames', root);
    const note = qs('#preview-note', root);
    const scanning = qs('#scanning', root);
    const scanningImage = qs('#scanning-image', root);
    const scanningStep = qs('#scanning-step', root);
    const errorPanel = qs('#preview-error', root);
    const errorTitle = qs('#preview-error-title', root);
    const errorText = qs('#preview-error-text', root);

    let pending = captureService.getPending();
    let controller = null;
    let cancelled = false;

    /* ------------------------------------------------------------------ *
     * No pending capture: this can only happen after a hard reload.
     * ------------------------------------------------------------------ */
    if (!pending || (pending.frames.length === 0 && pending.mode !== 'describe')) {
      showError(
        new AppError(Failure.UNKNOWN, {
          title: 'Nothing to recognise',
          message: 'Your image is no longer in memory. Please choose or take a picture again.',
        })
      );
      return () => {};
    }

    /* ------------------------------------------------------------------ *
     * Preview state
     * ------------------------------------------------------------------ */
    function paintPreview() {
      if (pending.mode === 'describe') {
        stage.textContent = '';
        const box = el('div', { style: { padding: '24px', textAlign: 'center', maxWidth: '420px' } }, [
          icon('i-sparkle', { size: 34 }),
          el('p', { class: 't-heading', style: { marginTop: '12px' }, text: 'Identify from your description' }),
          el('p', { class: 't-body', style: { marginTop: '8px' }, text: `“${pending.describe}”` }),
        ]);
        stage.append(box);

        dimsLabel.textContent = 'No image';
        sizeLabel.textContent = '';
        typeLabel.textContent = 'Text only';
        qs('#preview-change', root).textContent = 'Edit';
        if (note) note.textContent = 'A description alone is a weaker signal than an image. Adding a screenshot improves accuracy.';
        framesRow.hidden = true;
        return;
      }

      const primary = pending.frames[0];
      image.src = primary.previewUrl;
      image.alt = 'The scene you selected';

      dimsLabel.textContent = dimensions(primary.width, primary.height);
      sizeLabel.textContent = fileSize(primary.sizeBytes);
      typeLabel.textContent = pending.mode === 'video' ? `${pending.frames.length} frames` : primary.mimeType.replace('image/', '').toUpperCase();

      // Show what compression saved, so the cost of uploading is visible.
      if (note) {
        const saved = primary.compressionRatio > 0.05;
        note.textContent = saved
          ? `Compressed from ${fileSize(primary.originalBytes)} to ${fileSize(primary.sizeBytes)} on this device.`
          : 'Ready to upload.';
      }

      /* frame strip for video */
      clear(framesRow);
      if (pending.mode === 'video' && pending.frames.length > 1) {
        framesRow.hidden = false;
        for (const frame of pending.frames) {
          const thumb = el('span', { class: 'thumb-strip__item' });
          thumb.append(el('img', { src: frame.previewUrl, alt: '', loading: 'lazy', decoding: 'async' }));
          framesRow.append(thumb);
        }
      } else {
        framesRow.hidden = true;
      }
    }

    /* ------------------------------------------------------------------ *
     * Scanning state
     * ------------------------------------------------------------------ */
    function showScanning(target) {
      const primary = pending.frames[0];
      if (primary?.previewUrl) {
        scanningImage.src = primary.previewUrl;
        scanningImage.hidden = false;
      } else {
        scanningImage.hidden = true;
      }
      scanning.hidden = false;
      errorPanel.hidden = true;
      bottom.hidden = true;
      announce('Analysing the scene');
      qs('#scanning-step', root).textContent = 'Preparing image…';
    }

    function setStep(label) {
      if (scanningStep) scanningStep.textContent = label;
    }

    /* ------------------------------------------------------------------ *
     * Error state
     * ------------------------------------------------------------------ */
    function showError(error) {
      const appError = error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error });
      scanning.hidden = true;
      errorPanel.hidden = false;
      bottom.hidden = true;
      errorTitle.textContent = appError.title ?? 'Something went wrong';
      errorText.textContent = appError.text ?? 'Please try again.';

      const retry = qs('#preview-retry', root);
      retry.hidden = !appError.retryable && appError.kind !== Failure.NO_MATCH;
      announce(`${errorTitle.textContent}. ${errorText.textContent}`);
    }

    function backToPreview() {
      scanning.hidden = true;
      errorPanel.hidden = true;
      bottom.hidden = false;
    }

    /* ------------------------------------------------------------------ *
     * Recognition
     * ------------------------------------------------------------------ */
    async function runRecognition() {
      if (controller) return;

      controller = new AbortController();
      cancelled = false;
      showScanning();

      try {
        const result = await recognition.recognise({
          frames: pending.frames,
          mode: pending.mode,
          describe: pending.describe,
          source: pending.source,
          video: pending.video,
          signal: controller.signal,
          onProgress: ({ label }) => setStep(label),
        });

        // Persist to history (server for accounts, device otherwise).
        historyService.record(result);

        if (result.status === 'no_match' || !result.match) {
          hapticNotify('warning');
          showError(
            new AppError(Failure.NO_MATCH, {
              message:
                result.noMatchReason ??
                'We could not identify this scene. Try a clearer, well-lit screenshot, or describe the scene in words.',
            })
          );
          return;
        }

        hapticNotify('success');
        router.navigate(`/result/${result.id}`);
      } catch (error) {
        if (cancelled || error?.kind === Failure.CANCELLED) {
          backToPreview();
          return;
        }
        hapticNotify('error');
        showError(error);
      } finally {
        controller = null;
      }
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */
    const disposers = [
      on(qs('#preview-recognize', root), 'click', runRecognition),
      on(qs('#preview-retry', root), 'click', runRecognition),
      on(qs('#preview-error-back', root), 'click', backToPreview),

      on(qs('#scanning-cancel', root), 'click', () => {
        cancelled = true;
        controller?.abort();
        toast('Recognition cancelled.', { variant: 'info' });
      }),

      on(qs('#preview-back', root), 'click', () => router.back('/home')),

      on(qs('#preview-change', root), 'click', () => {
        if (pending.mode === 'describe') router.back('/home');
        else router.navigate('/camera');
      }),

      on(qs('#preview-clear', root), 'click', async () => {
        const ok = await confirm({
          title: 'Discard this image?',
          message: 'The image is only in memory and will be gone.',
          confirmLabel: 'Discard',
          destructive: true,
        });
        if (ok) {
          captureService.clearPending();
          router.navigate('/home', { replace: true });
        }
      }),
    ];

    // Warn before leaving mid-scan; the request would be orphaned.
    const onBeforeUnload = (event) => {
      if (!controller) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    paintPreview();

    return () => {
      disposers.forEach((dispose) => dispose?.());
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Unmounting mid-scan means the user navigated away: stop the work.
      cancelled = true;
      controller?.abort();
    };
  },
};
