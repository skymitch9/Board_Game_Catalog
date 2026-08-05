# Camera Capture on iOS — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-05** against caniuse, MDN browser-compat-data, WebKit
> and Apple bug trackers, and vendor KBs. **One item confirmed on real hardware**
> (see "Confirmed on device"). Everything else is documentation-derived.

The app targets **iPhone first**. Almost every unusual decision in
`apps/web/src/lib/camera.ts` and `apps/web/src/lib/scanner.ts` is a WebKit
constraint rather than a preference, so they are recorded here with the reason.

## The headline: `BarcodeDetector` does not exist on iOS

| Browser | Status |
|---|---|
| Safari iOS, all versions through 26.5 | **Not supported** — flag-only |
| Chrome / Firefox / Edge **on iOS** | Same — all are WebKit |
| Chrome Android | Supported |

MDN's compat data shows `version_added: 17` for `safari_ios`, but **gated behind
the Shape Detection feature flag**, never shipped on. Worse, that flag **has been
broken since iOS 18.0** (Apple Developer Forums 767761, WebKit bug 281848, no
Apple response). Neither the Safari 26.4 nor the Safari 27 beta release notes
mention Shape Detection at all.

**Therefore: never feature-detect.** `apps/web/src/lib/scanner.ts` runs the
`barcode-detector` ponyfill (ZXing-C++ via wasm) unconditionally on every
platform, so behaviour is identical everywhere and there is one code path to
reason about.

The wasm is **self-hosted and version-pinned**, not fetched from the library's
default jsDelivr URL, which would break under a strict CSP and offline. Vite
emits it as a hashed asset and the ponyfill as a lazy chunk — 450 KB gzip that
only downloads when a scanner actually opens.

## getUserMedia constraints

| Constraint | Consequence if ignored |
|---|---|
| **Secure context required** | `navigator.mediaDevices` is `undefined` → a TypeError, not a permission prompt |
| **`192.168.x.x` is not secure** | Camera silently never works from a phone against a LAN dev server. Safari has **no override flag** |
| **`playsinline` on `<video>`** | WebKit forces fullscreen playback |
| **User gesture required** | Camera never starts if called on mount |
| **Request high resolution** | EAN-13 bars at a default 640×480 are frequently undecodable |
| **`facingMode: {exact:'environment'}`** | May land on the selfie camera. Some devices reject `exact` — retry relaxed |
| **Stop tracks on unmount** | iOS leaves the camera indicator on |

**No torch and no focus control on iOS.** `applyConstraints({advanced:[{torch:true}]})`
works on Android and does nothing on Safari. We deliberately ship no torch button:
a control that appears to work but doesn't is worse than no control.

**Scanning lives on one flat route with no hash segments.** A standalone PWA on
iOS re-prompts for camera permission on *every* route change (WebKit #215884,
still open). The only user-side workaround is granting blanket camera permission
to all sites, which is bad advice.

## Photos never reach the camera roll

An explicit product requirement, and verified rather than assumed:

- **`getUserMedia` + canvas** — there is **no web API on iOS that can write to
  the photo library**. A frame drawn via `drawImage()` never leaves the JS heap.
  (`ImageCapture.takePhoto()` is unsupported on iOS, which is why canvas is the
  only still-capture route there anyway.)
- **`<input type="file" capture>`** — also does **not** save. Safari presents
  `UIImagePickerController`; per Apple's own *About the Camera and Photo Library*,
  saving requires the **app** to call `UIImageWriteToSavedPhotosAlbum`, and Safari
  never does. Corroborated from the opposite direction by users *wanting* it to
  save and being told it cannot (Apple Community 254480145). No change across iOS
  versions, including 18 and 26.

Consequently the file-input fallback is **kept** — it costs ~15 lines and works
in contexts `getUserMedia` does not, notably in-app browsers whose host app never
implemented `WKUIDelegate.requestMediaCapturePermissionFor`.

⚠️ `accept` must be plain `image/*`. Adding `image/heic` makes Safari 17+
silently transcode *every* selection to HEIC.

## Image sizing

Claude bills images in **28×28 patches**: `ceil(w/28) × ceil(h/28)` visual tokens.
Opus 5 is high-resolution tier — up to **2576 px** long edge, capped at **4784**
visual tokens, downscaling anything larger server-side.

| Use | Long edge | Why |
|---|---|---|
| One box | 1500 | Title fills much of the frame and is already 100+px tall; going to 2576 roughly doubles cost for nothing |
| Whole shelf | 2400 | A dozen spines share the frame. Stays under the 2576 ceiling so nothing is re-scaled server-side |

JPEG **q0.85, one encode pass**. The phone's frame is *already* lossy, so this is
a second compression and the artifacts land exactly on the letterforms we need.

**Downscale during decode**, via `createImageBitmap({resizeWidth})` — never by
drawing full-size to a canvas first:

- iOS refuses canvases over **16,777,216 px²** and does so **silently**, rendering
  blank rather than throwing. A 48 MP iPhone photo is ~3× over.
- Total canvas memory is capped around 384 MB.
- iOS does not reliably collect canvases — shrink to 1×1 and `clearRect` before
  dropping the reference.
- Pass `imageOrientation: 'from-image'` or EXIF-rotated iPhone photos arrive
  sideways, which reads as unreadable.

## Testing from a real iPhone

`getUserMedia` needs HTTPS, and a LAN IP will never qualify, so either deploy or
tunnel:

- **`cloudflared tunnel --url http://localhost:5173`** — free, no account, real
  cert iOS trusts, no interstitial. Add `server.allowedHosts: ['.trycloudflare.com']`
  to `vite.config.ts` or Vite's DNS-rebinding guard rejects it.
- **Deploying** is the other option and is what we did first.
- ❌ **Never `@vitejs/plugin-basic-ssl` for iOS.** It emits a bare self-signed
  leaf, and on iOS 18+ such certs never appear in Certificate Trust Settings, so
  full trust can never be granted. It works on macOS, which makes it look fine
  until you test on the phone.

## Confirmed on device

**2026-08-05, iPhone, deployed URL.** Two passes:

1. Camera opened, decoded a real retail barcode (King of Tokyo: Duel), and the
   lookup resolved it through the free rungs. That validates the whole chain —
   skipping `BarcodeDetector`, the self-hosted wasm loading, `playsinline`, the
   rear-camera constraints, and the deployed origin satisfying secure-context.
2. Re-scanning the same box after adding it returned **"Already in your
   collection"** from the local table. The write-back loop works: a barcode
   resolved once never costs a network call again.

Not yet exercised on device: photo mode, shelf mode, the paid barcode rung, the
`<input capture>` fallback, and PWA/home-screen behaviour.
