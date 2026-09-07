/**
 * Did that wrangler run actually work?
 *
 * 🔴 **On Windows, wrangler's exit code is not trustworthy** — it sometimes
 * prints a clean success and then exits non-zero on a libuv teardown quirk.
 * `docs/info/gotchas.md` records it as *"read the output, not the exit code"*,
 * and `push-secrets.mjs` mitigated it the blunt way: `process.exit(0)`,
 * unconditionally, including in the branch that had just printed
 * `wrangler exited N`.
 *
 * ⚠️ **That turns every real failure into a success too.** Any caller doing an
 * `&&` chain, or CI, reads "the secrets were pushed" when nothing was —
 * silently, which is the direction that costs a day. 2026-08 audit, finding 21.
 *
 * So: read the OUTPUT, exactly as the gotcha says, and keep the two apart.
 *
 * This lives in `lib/` and is pure so a test can reach it. Importing
 * `push-secrets.mjs` itself runs it, and running it reads `.dev.vars`.
 */

/** Wrangler saying, in its own words, that the upload happened. */
const SUCCESS_PATTERNS = [/Finished processing secrets/i, /Success!\s+Uploaded/i];

/** `… 2 failures` — wrangler counts them even in a run it calls finished. */
const FAILURE_COUNT = /(\d+)\s+failures?/i;

/**
 * Decide what to exit with, and what to say.
 *
 * @param {{ code: number | null, output: string }} run
 *   `code` is the child's exit code (null when it died on a signal); `output`
 *   is everything it wrote to stdout and stderr, concatenated.
 * @returns {{ exitCode: number, ok: boolean, reason: string }}
 */
export function classifyWranglerExit({ code, output }) {
  const text = output ?? '';
  const saidSuccess = SUCCESS_PATTERNS.some((p) => p.test(text));
  const match = text.match(FAILURE_COUNT);
  const failures = match ? Number(match[1]) : null;

  // ⚠️ Wrangler's own failure COUNT beats its exit code in both directions. A
  // `secret bulk` run can finish, exit 0, and report that two of the secrets
  // did not upload — which is a failure however cheerful the process was about
  // it, and exactly the silent-partial-success this repo keeps refusing.
  if (failures !== null && failures > 0) {
    return {
      exitCode: 1,
      ok: false,
      reason: `wrangler reported ${failures} failure${failures === 1 ? '' : 's'} — nothing here retried them`,
    };
  }

  if (code === 0) {
    return { exitCode: 0, ok: true, reason: 'wrangler exited 0' };
  }

  // Non-zero, but wrangler said in words that it finished. This is the Windows
  // teardown quirk, and it is the ONLY case that gets forgiven — narrowly, and
  // out loud, so a person can see the forgiveness happening.
  if (saidSuccess) {
    return {
      exitCode: 0,
      ok: true,
      reason:
        `wrangler exited ${code} AFTER printing success — treated as the known Windows ` +
        'teardown quirk (gotchas.md: read the output, not the exit code)',
    };
  }

  // Non-zero and no success line: a real failure, and the caller must see it.
  return {
    exitCode: typeof code === 'number' && code !== 0 ? code : 1,
    ok: false,
    reason:
      `wrangler exited ${code} and never printed a success line — treated as a REAL failure. ` +
      'Read the output above.',
  };
}
