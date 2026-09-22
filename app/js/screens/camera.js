/**
 * CAMERA (section 7).
 *
 * Full-screen live preview with a large capture button, flash control, close and
 * gallery shortcut.
 *
 * It has TWO operating modes, and the fallback is a real feature rather than a
 * stub:
 *
 *   LIVE      getUserMedia drives an in-app preview (works on the web, and in the
 *             webview where the OS grants camera access to it).
 *   SYSTEM    If the live preview cannot start — permission denied, no camera, or a
 *             webview that does not expose the camera to JavaScript — the screen
 *             switches to the OS camera through the Capacitor Camera plugin, which
 *             always works, and keeps the gallery escape hatch visible.
 *
 * The camera stream is always stopped on unmount. Leaving it running would drain
 * the battery and keep the camera indicator light on.
 */
import { el, qs, on, icon, announce } from '../core/dom.js';
import { router } from '../core/router.js';
import { toast, toastError, hapticImpact } from '../core/feedback.js';
import * as media from '../services/media.js';
import * as capture from '../services/capture.js';
import { AppError, Failure } from '../core/errors.js';

const FLASH_MODE_COPY = {
  off: 'Off',
  on: 'On',
  auto: 'Auto',
};

export default {
  title: null,
  tab: null,
  chrome: 'fullscreen',

  async mount({ root }) {
    const video = qs('#camera-video', root);
    const fallback = qs('#camera-fallback', root);
    const fallbackTitle = qs('#camera-fallback-title', root);
    const fallbackText = qs('#camera-fallback-text', root);
    const shutter = qs('#camera-shutter', root);
    const flashButton = qs('#camera-flash', root);
    const switchButton = qs('#camera-switch', root);
    const hint = qs('#camera-hint', root);

    let preview = null;
    let facingMode = 'environment';
    /** off | on | auto — remembered per session, applied via the torch API when present. */
    let flashMode = 'off';
    let capturing = false;
    let live = false;

    /* ------------------------------------------------------------------ *
     * Fallback mode
     * ------------------------------------------------------------------ */
    function enterFallback(message) {
      live = false;
      video.hidden = true;
      fallback.hidden = false;
      fallbackText.textContent =
        message ?? 'Live preview is not available. Use the system camera, or import a screenshot from your library.';

      // Replace the in-app chrome with system-camera actions.
      shutter.disabled = false;
      shutter.setAttribute('aria-label', 'Take photo with the system camera');
      switchButton.hidden = true;
      flashButton.hidden = true;
      if (hint) hint.textContent = 'The system camera will open. Frame the scene and capture.';
    }

    /* ------------------------------------------------------------------ *
     * Live preview
     * ------------------------------------------------------------------ */
    async function startLive() {
      try {
        preview = await media.startPreview(video, { facingMode });
        live = true;
        video.hidden = false;
        fallback.hidden = true;
        if (hint) hint.textContent = 'Frame a paused scene, a poster or a screenshot on another screen.';
        await applyFlash();
      } catch (error) {
        console.warn('[camera] live preview unavailable:', error?.message ?? error);
        enterFallback(error?.kind === Failure.VALIDATION ? error.message : null);
      }
    }

    /** Applies torch/flash when the track exposes it; silent no-op otherwise. */
    async function applyFlash() {
      const track = preview?.stream?.getVideoTracks?.()[0];
      if (!track) return;
      const capabilities = track.getCapabilities?.() ?? {};
      if (!capabilities.torch) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: flashMode === 'on' }] });
      } catch {
        /* some devices report torch but reject the constraint */
      }
    }

    /* ------------------------------------------------------------------ *
     * Capture
     * ------------------------------------------------------------------ */
    async function takePhoto() {
      if (capturing) return;
      capturing = true;
      shutter.disabled = true;
      hapticImpact('medium');

      try {
        let blob;
        let source = 'camera';

        if (live) {
          const shot = await media.captureFromPreview(video);
          blob = shot.blob;
        } else {
          // System camera: opens the OS UI and returns the shot.
          const photo = await media.takePhoto();
          blob = photo.blob;
          source = 'camera';
        }

        await capture.prepareCapturedPhoto(blob, { source });
        router.navigate('/preview');
      } catch (error) {
        if (error?.kind !== Failure.CANCELLED) {
          toastError(error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error }));
        }
      } finally {
        capturing = false;
        shutter.disabled = false;
      }
    }

    async function openLibrary() {
      try {
        hapticImpact('light');
        await capture.captureFromGallery();
        router.navigate('/preview');
      } catch (error) {
        if (error?.kind !== Failure.CANCELLED) {
          toastError(error instanceof AppError ? error : new AppError(Failure.UNKNOWN, { cause: error }));
        }
      }
    }

    async function cycleFlash() {
      const order = ['off', 'on', 'auto'];
      flashMode = order[(order.indexOf(flashMode) + 1) % order.length];
      flashButton.setAttribute('aria-pressed', String(flashMode !== 'off'));
      flashButton.setAttribute('aria-label', `Flash ${FLASH_MODE_COPY[flashMode]}`);
      flashButton.innerHTML = '';
      flashButton.append(icon(flashMode === 'off' ? 'i-flash-off' : 'i-flash'));
      await applyFlash();
      toast(`Flash ${FLASH_MODE_COPY[flashMode]}`, { duration: 1200 });
    }

    async function switchCamera() {
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
      hapticImpact('light');
      if (preview) {
        preview.stop();
        preview = null;
      }
      await startLive();
    }

    /* ------------------------------------------------------------------ *
     * Wiring
     * ------------------------------------------------------------------ */
    const disposers = [
      on(shutter, 'click', takePhoto),
      on(qs('#camera-library', root), 'click', openLibrary),
      on(qs('#camera-close', root), 'click', () => router.back('/home')),
      on(flashButton, 'click', cycleFlash),
      on(switchButton, 'click', switchCamera),
      on(qs('#camera-fallback-gallery', root), 'click', openLibrary),
      on(qs('#camera-fallback-file', root), 'click', openLibrary),
    ];

    // Space / Enter triggers the shutter for keyboard users.
    const onKey = (event) => {
      if (event.key === 'Enter' && document.activeElement === document.body) takePhoto();
    };
    document.addEventListener('keydown', onKey);

    // Pause the stream when the app is backgrounded, resume on return.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        preview?.stop();
        preview = null;
        live = false;
      } else if (!preview) {
        startLive();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    announce('Camera ready');
    await startLive();

    return () => {
      disposers.forEach((dispose) => dispose?.());
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      preview?.stop();
      preview = null;
    };
  },
};
