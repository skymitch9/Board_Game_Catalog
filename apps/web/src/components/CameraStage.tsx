import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraError, cameraPlausible, closeCamera, openRearCamera } from '../lib/camera';
import { ErrorBox } from './ui';

/**
 * A live rear-camera viewfinder.
 *
 * Owns the awkward parts so the pages above it do not have to: the camera is
 * only ever started from a real click (iOS requires a user gesture), the video
 * carries `playsinline` (or WebKit forces fullscreen), and the stream is always
 * stopped on unmount — iOS leaves the camera light on otherwise.
 *
 * There is deliberately no torch button: `applyConstraints({torch})` silently
 * does nothing on iOS, and a control that appears to work but doesn't is worse
 * than no control.
 */
export function CameraStage({
  active,
  onStart,
  onReady,
  onStop,
  hint,
  children,
}: {
  active: boolean;
  onStart: () => void;
  onReady?: (video: HTMLVideoElement) => void;
  onStop?: () => void;
  hint?: string;
  children?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const plausible = cameraPlausible();

  const stop = useCallback(() => {
    closeCamera(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    onStop?.();
  }, [onStop]);

  // Always release the camera when this component goes away.
  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    let cancelled = false;

    (async () => {
      setStarting(true);
      setError(null);
      try {
        const stream = await openRearCamera();
        if (cancelled) {
          closeCamera(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        onReady?.(video);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // onReady is intentionally not a dependency — re-running would restart the
    // camera every render and iOS shows a permission flash each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stop]);

  if (!plausible) {
    return (
      <div className="camera-stage camera-stage--blocked">
        <p>
          <strong>The camera needs a secure connection.</strong>
        </p>
        <p className="muted">
          Safari only allows camera access over <code>https</code>. Open the deployed site rather
          than a local network address — a <code>192.168.x.x</code> address will never prompt for
          permission, it just fails silently.
        </p>
      </div>
    );
  }

  return (
    <div className="camera-stage">
      <video
        ref={videoRef}
        // playsinline is load-bearing on iOS: without it WebKit goes fullscreen.
        playsInline
        muted
        autoPlay
        className={active ? 'camera-video' : 'camera-video camera-video--idle'}
      />

      {active && <div className="camera-reticle" aria-hidden="true" />}
      {active && children}

      {!active && (
        <div className="camera-stage__overlay">
          <button type="button" className="primary" onClick={onStart}>
            Start camera
          </button>
          {hint && <p className="muted">{hint}</p>}
        </div>
      )}

      {starting && <p className="muted camera-stage__status">Starting camera…</p>}

      {error != null && (
        <div className="camera-stage__error">
          <ErrorBox
            error={error instanceof CameraError ? new Error(error.message) : error}
            what="Camera"
          />
          <button type="button" onClick={onStart}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
