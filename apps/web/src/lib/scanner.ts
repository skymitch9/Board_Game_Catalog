import { isPlausibleBarcode, normaliseBarcode } from '@bgc/core';

/**
 * Barcode decoding, WASM only.
 *
 * `BarcodeDetector` is not usable on iOS: it has been flag-only since Safari 17,
 * the flag has been broken since iOS 18, and neither Safari 26.4 nor the 27 beta
 * mention shipping it. Every browser on iOS is WebKit, so Chrome and Firefox
 * fail identically. We therefore never feature-detect — the ponyfill runs
 * unconditionally, on every platform, so behaviour is the same everywhere.
 *
 * The 449KB wasm is loaded lazily the first time a scanner opens, and served
 * from our own origin rather than the library's default jsDelivr fetch, which
 * would break under a strict CSP and offline.
 */

// Vite emits this as a hashed asset on our own origin and gives us the URL.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface Scan {
  code: string;
  format: string;
}

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> };

let detectorPromise: Promise<Detector> | null = null;

/**
 * Retail barcodes only. Narrowing the format list measurably speeds up decoding
 * and stops a QR code on the back of a box being read as the product.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

async function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
      prepareZXingModule({
        overrides: { locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path) },
        fireImmediately: false,
      });
      return new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector;
    })().catch((err) => {
      // Let the next attempt retry rather than caching a failed load forever.
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
}

/** Warm the wasm while the user is still pointing the camera. */
export function preloadDecoder(): void {
  void getDetector().catch(() => undefined);
}

export interface ScanLoopOptions {
  video: HTMLVideoElement;
  onScan: (scan: Scan) => void;
  onError?: (err: unknown) => void;
  /**
   * How many times the same code must be read before we believe it. Two
   * consecutive identical reads costs a few hundred milliseconds and removes
   * almost every misread — worth it when the alternative is silently attaching
   * the wrong barcode to a game.
   */
  confirmations?: number;
}

/**
 * Run a decode loop against a live video element. Returns a stop function.
 *
 * Uses `requestVideoFrameCallback` where available so we decode actual new
 * frames rather than guessing at the frame rate; falls back to a throttled
 * `requestAnimationFrame` loop.
 */
export function startScanLoop(options: ScanLoopOptions): () => void {
  const { video, onScan, onError } = options;
  const needed = options.confirmations ?? 2;

  let stopped = false;
  let busy = false;
  let lastCode = '';
  let streak = 0;
  let rafId = 0;
  let vfcId = 0;
  let lastRun = 0;

  const hasVfc = typeof (video as unknown as { requestVideoFrameCallback?: unknown })
    .requestVideoFrameCallback === 'function';

  async function tick(): Promise<void> {
    if (stopped || busy) return;
    if (video.readyState < 2 || !video.videoWidth) return;

    busy = true;
    try {
      const detector = await getDetector();
      const results = await detector.detect(video);
      for (const result of results) {
        const code = normaliseBarcode(result.rawValue);
        // Reject a bad check digit here rather than after a round trip.
        if (!isPlausibleBarcode(code)) continue;

        if (code === lastCode) {
          streak += 1;
        } else {
          lastCode = code;
          streak = 1;
        }

        if (streak >= needed) {
          stopped = true;
          onScan({ code, format: result.format });
          return;
        }
      }
    } catch (err) {
      onError?.(err);
    } finally {
      busy = false;
    }
  }

  function scheduleVfc(): void {
    if (stopped) return;
    vfcId = (video as unknown as {
      requestVideoFrameCallback(cb: () => void): number;
    }).requestVideoFrameCallback(() => {
      void tick().finally(scheduleVfc);
    });
  }

  function scheduleRaf(): void {
    if (stopped) return;
    rafId = requestAnimationFrame((now) => {
      // ~10 decodes/sec is plenty and keeps older phones responsive.
      if (now - lastRun < 100) {
        scheduleRaf();
        return;
      }
      lastRun = now;
      void tick().finally(scheduleRaf);
    });
  }

  if (hasVfc) scheduleVfc();
  else scheduleRaf();

  return () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (vfcId && hasVfc) {
      (video as unknown as { cancelVideoFrameCallback?(id: number): void }).cancelVideoFrameCallback?.(
        vfcId,
      );
    }
  };
}

/** Decode a single still image — the `<input capture>` fallback path. */
export async function decodeStill(source: CanvasImageSource): Promise<Scan | null> {
  const detector = await getDetector();
  const results = await detector.detect(source);
  for (const result of results) {
    const code = normaliseBarcode(result.rawValue);
    if (isPlausibleBarcode(code)) return { code, format: result.format };
  }
  return null;
}
