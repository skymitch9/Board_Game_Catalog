import { IOS_MAX_CANVAS_AREA, PHOTO_QUALITY } from '@bgc/core';

/**
 * Camera capture, written for iOS Safari first.
 *
 * Everything awkward in here is a WebKit constraint, not a preference:
 *
 * - `getUserMedia` needs a **secure context**. On a phone, `http://192.168.x.x`
 *   is not one, and Safari has no override flag — `navigator.mediaDevices` is
 *   simply `undefined`, so you get a TypeError rather than a permission prompt.
 * - The camera must be started from a **user gesture**, never on mount.
 * - The `<video>` needs `playsinline`, or WebKit forces fullscreen playback.
 * - There is **no torch and no focus control** on iOS. Design for ambient light.
 * - A full-size iPhone frame **exceeds the canvas area cap** and renders blank
 *   *silently*, so downscaling happens during decode via `createImageBitmap`.
 *
 * Nothing here writes to the photo library — there is no web API on iOS that
 * can, and we never hand a file to the system camera. Frames live in memory
 * until they are uploaded, then they are dropped.
 */

export type CameraFailure =
  | 'insecure-context'
  | 'unsupported'
  | 'denied'
  | 'no-camera'
  | 'in-use'
  | 'unknown';

export class CameraError extends Error {
  constructor(
    readonly reason: CameraFailure,
    message: string,
  ) {
    super(message);
  }
}

/** True when getUserMedia can even exist here. Check before showing a button. */
export function cameraPlausible(): boolean {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function explain(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Camera access was blocked. Allow it in Safari settings, then try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no-camera', 'No rear camera was available on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError(
        'in-use',
        'The camera is busy. Close other apps or tabs using it, then try again.',
      );
    default:
      return new CameraError('unknown', `Could not start the camera: ${String(err)}`);
  }
}

/**
 * Open the rear camera. **Must be called from a user gesture.**
 *
 * Requests a high resolution deliberately: EAN-13 bars at a default 640x480 are
 * frequently undecodable. `exact` on facingMode is tried first so we never end
 * up on the selfie camera, then relaxed — some devices refuse `exact`.
 */
export async function openRearCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new CameraError(
      'insecure-context',
      'The camera needs a secure (https) connection. Open the deployed site rather than a local address.',
    );
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new CameraError('unsupported', 'This browser does not support camera capture.');
  }

  const wide = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: 'environment' }, ...wide },
      audio: false,
    });
  } catch (err) {
    if ((err as { name?: string })?.name !== 'OverconstrainedError') throw explain(err);
    // Device has only one camera, or refuses `exact`. Prefer rather than require.
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', ...wide },
        audio: false,
      });
    } catch (relaxed) {
      throw explain(relaxed);
    }
  }
}

/** Stop every track. iOS keeps the camera light on until you do. */
export function closeCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * iOS does not reliably garbage-collect canvases, and there is a hard cap on
 * total canvas memory. Shrinking to 1x1 before dropping the reference forces
 * WebKit to release the backing store.
 */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
  canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
}

function fit(width: number, height: number, longEdge: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= longEdge) return { w: width, h: height };
  const scale = longEdge / longest;
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

export interface CapturedPhoto {
  /** Base64 with no data: URL prefix — what the API expects. */
  data: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
}

/**
 * Grab the current video frame, downscale it, and encode it once.
 *
 * One decode, one resize, one encode: the phone's frame is already lossy, and
 * stacking a second heavy compression pass puts artifacts exactly on the
 * letterforms the model needs to read.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  longEdge: number,
): Promise<CapturedPhoto> {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) throw new CameraError('unknown', 'The camera has not produced a frame yet.');

  const { w, h } = fit(sw, sh, longEdge);
  if (w * h > IOS_MAX_CANVAS_AREA) {
    throw new CameraError('unknown', 'That frame is too large to process on this device.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CameraError('unknown', 'Could not get a drawing context.');

  try {
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY),
    );
    if (!blob) throw new CameraError('unknown', 'Could not encode the photo.');
    return { data: await toBase64(blob), mediaType: 'image/jpeg', width: w, height: h, bytes: blob.size };
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Downscale a file the user picked (the `<input capture>` fallback path).
 *
 * Uses `createImageBitmap` with `resizeWidth` so the decoder scales *during*
 * decode — a 48MP iPhone photo never becomes a full-size bitmap, which is what
 * blows past the canvas cap. `imageOrientation: 'from-image'` applies the EXIF
 * rotation iPhones set; without it, portrait photos arrive sideways and the
 * model reads them as unreadable.
 */
export async function fileToPhoto(file: File, longEdge: number): Promise<CapturedPhoto> {
  if (typeof createImageBitmap !== 'function') {
    throw new CameraError('unsupported', 'This browser cannot process the selected photo.');
  }

  const probe = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!probe) {
    throw new CameraError(
      'unknown',
      'That image could not be read. HEIC photos from the Photos app may need converting — try taking a new photo instead.',
    );
  }

  const { w, h } = fit(probe.width, probe.height, longEdge);
  probe.close();

  const bitmap = await createImageBitmap(file, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
    imageOrientation: 'from-image',
  });

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new CameraError('unknown', 'Could not get a drawing context.');
  }

  try {
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY),
    );
    if (!blob) throw new CameraError('unknown', 'Could not encode the photo.');
    return {
      data: await toBase64(blob),
      mediaType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
    };
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new CameraError('unknown', 'Could not read the captured photo.'));
    reader.onload = () => {
      const url = String(reader.result);
      // Strip the "data:image/jpeg;base64," prefix the API does not want.
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
