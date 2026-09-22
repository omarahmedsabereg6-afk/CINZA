/**
 * Device media access (sections 7, 8, 9, 30).
 *
 * One façade, two implementations:
 *
 *   NATIVE (Capacitor)  — @capacitor/camera gives the OS camera UI, the OS photo
 *                         picker, native resizing and correct EXIF orientation.
 *                         Permissions are requested only at the moment they are
 *                         needed, never at launch (section 7).
 *
 *   WEB / FALLBACK      — getUserMedia for the live preview, and a hidden
 *                         <input type="file"> for the picker. This is not a stub:
 *                         it is what makes the app usable in a browser for
 *                         development and testing, and it is what runs if a user
 *                         permanently denies camera access.
 *
 * Video selection always uses the file input: the Camera plugin does not pick video,
 * and the OS file picker is the correct native affordance for it.
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import config from '../config.js';
import { AppError, Failure } from '../core/errors.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Opens the OS file picker. Also the fallback picker on the web. */
function pickWithInput({ accept, capture = false, multiple = false }) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-9999px';

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      input.remove();
      fn(value);
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) finish(reject, new AppError(Failure.CANCELLED));
      else finish(resolve, multiple ? files : files[0]);
    });

    // There is no reliable "cancelled" event; a window focus change is the best
    // signal we have, and it is better to leave the promise pending than to
    // wrongly report a cancellation while the picker is still open on iOS.
    document.body.append(input);
    input.click();
  });
}

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

export async function ensureCameraPermission() {
  if (!config.isNative) return 'granted';

  const status = await Camera.checkPermissions();
  if (status.camera === 'granted' || status.camera === 'limited') return status.camera;

  if (status.camera === 'denied') {
    throw new AppError(Failure.VALIDATION, {
      message: 'Camera access is blocked. Enable it in your device settings, or choose an image from your library.',
    });
  }

  const requested = await Camera.requestPermissions({ permissions: ['camera'] });
  if (requested.camera !== 'granted' && requested.camera !== 'limited') {
    throw new AppError(Failure.VALIDATION, {
      message: 'CINZA needs camera access to photograph a scene. You can still import a screenshot instead.',
    });
  }
  return requested.camera;
}

export async function ensurePhotoPermission() {
  if (!config.isNative) return 'granted';
  const status = await Camera.checkPermissions();
  if (status.photos === 'granted' || status.photos === 'limited') return status.photos;
  const requested = await Camera.requestPermissions({ permissions: ['photos'] });
  return requested.photos;
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

const NATIVE_OPTIONS = {
  // Base64 keeps everything in memory: nothing is written to a temporary file we
  // would then have to remember to delete (section 40).
  resultType: CameraResultType.Base64,
  correctOrientation: true,
  quality: 92,
  // Native-side downscale before the image ever reaches JavaScript.
  width: 2400,
  height: 2400,
};

/**
 * Take a photo with the device camera.
 * @returns {Promise<{blob: Blob, mimeType: string, source: 'camera'}>}
 */
export async function takePhoto({ preferNative = true } = {}) {
  if (config.isNative && preferNative) {
    const permission = await ensureCameraPermission();
    if (permission === 'denied') throw new AppError(Failure.VALIDATION, { message: 'Camera access was denied.' });

    const photo = await Camera.getPhoto({ ...NATIVE_OPTIONS, source: CameraSource.Camera });
    if (!photo?.base64String) throw new AppError(Failure.CANCELLED);
    const mimeType = `image/${photo.format === 'png' ? 'png' : photo.format === 'webp' ? 'webp' : 'jpeg'}`;
    return { blob: base64ToBlob(photo.base64String, mimeType), mimeType, source: 'camera' };
  }

  // Web: the capture attribute opens the camera directly on mobile browsers.
  const file = await pickWithInput({ accept: 'image/*', capture: 'environment' });
  return { blob: file, mimeType: file.type || 'image/jpeg', source: 'camera', filename: file.name };
}

/**
 * Choose an image from the photo library.
 * @returns {Promise<{blob: Blob, mimeType: string, source: 'gallery'}>}
 */
export async function pickFromGallery({ preferNative = true } = {}) {
  if (config.isNative && preferNative) {
    try {
      await ensurePhotoPermission();
      const photo = await Camera.getPhoto({ ...NATIVE_OPTIONS, source: CameraSource.Photos });
      if (!photo?.base64String) throw new AppError(Failure.CANCELLED);
      const mimeType = `image/${photo.format === 'png' ? 'png' : photo.format === 'webp' ? 'webp' : 'jpeg'}`;
      return { blob: base64ToBlob(photo.base64String, mimeType), mimeType, source: 'gallery' };
    } catch (error) {
      // A user may have denied the photo permission; the file picker still works
      // and is often the better picker anyway.
      if (error?.kind === Failure.CANCELLED) throw error;
      console.warn('[media] native picker unavailable, using file input', error?.message ?? error);
    }
  }

  const file = await pickWithInput({ accept: 'image/jpeg,image/png,image/webp,image/heic,image/*' });
  return { blob: file, mimeType: file.type || 'image/jpeg', source: 'gallery', filename: file.name };
}

/**
 * Choose a video from the device.
 * @returns {Promise<{blob: Blob, mimeType: string, source: 'video', filename: string}>}
 */
export async function pickVideo() {
  const file = await pickWithInput({ accept: 'video/*' });
  return {
    blob: file,
    mimeType: file.type || 'video/mp4',
    source: 'video',
    filename: file.name,
    sizeBytes: file.size,
  };
}

/**
 * Live camera preview for the in-app camera screen.
 *
 * Returns an object with `stop()`. On failure the caller shows the fallback UI
 * rather than a blank screen — see screens/camera.js.
 */
export async function startPreview(videoElement, { facingMode = 'environment' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AppError(Failure.VALIDATION, { message: 'Live camera preview is not supported on this device.' });
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (error) {
    const denied = ['NotAllowedError', 'SecurityError'].includes(error?.name);
    throw new AppError(Failure.VALIDATION, {
      message: denied
        ? 'Camera access was denied. Allow it in your device settings, or import a screenshot instead.'
        : 'No camera is available. You can still import a screenshot.',
      cause: error,
    });
  }

  videoElement.srcObject = stream;
  videoElement.setAttribute('playsinline', 'true');
  await videoElement.play().catch(() => null);

  return {
    stream,
    stop() {
      for (const track of stream.getTracks()) track.stop();
      videoElement.srcObject = null;
    },
    setFacingMode(mode) {
      // Re-acquire with the other camera; simpler and more reliable than torch APIs.
      return startPreview(videoElement, { facingMode: mode });
    },
  };
}

/** Grabs the current preview frame as a Blob. */
export async function captureFromPreview(videoElement) {
  const width = videoElement.videoWidth;
  const height = videoElement.videoHeight;
  if (!width || !height) {
    throw new AppError(Failure.VALIDATION, { message: 'The camera is not ready yet.' });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(videoElement, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new AppError(Failure.VALIDATION, { message: 'The photo could not be captured.' });
  return { blob, mimeType: 'image/jpeg', width, height, source: 'camera' };
}

export const isNativeCameraAvailable = () => config.isNative;

export default {
  takePhoto,
  pickFromGallery,
  pickVideo,
  startPreview,
  captureFromPreview,
  ensureCameraPermission,
  ensurePhotoPermission,
  isNativeCameraAvailable,
};
