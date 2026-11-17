/**
 * The one line that a lint script reports instead of crashing.
 *
 * `scripts/agent-lint-feedback.mjs` and `scripts/check-oracle-run-counts.mjs`
 * load their third-party dependencies with dynamic imports, so a checkout
 * without an install, such as a fresh worktree, gets this line instead of a
 * stack trace. The maintainer decided on 2026-11-10 that the lint "should never
 * just crash". This module imports nothing, so it loads in any checkout.
 */

// Packages that are absent, or present without the file that an import names.
const missingModule = new Set([
  `ERR_MODULE_NOT_FOUND`,
  `ERR_PACKAGE_PATH_NOT_EXPORTED`,
])

/** `oracle lint failed:` and the first line of an error's message. */
export function failureLine(error) {
  return `oracle lint failed: ${String(error?.message ?? error).split(`\n`)[0]}`
}

/**
 * The line for a dependency that did not load. A missing module means that
 * the install in `checkout` is missing or partial; any other error, such as a
 * cut-off file, is reported by its message.
 */
export function loadFailureLine(error, checkout) {
  return missingModule.has(error?.code)
    ? `oracle lint skipped: dependencies are not installed in ${checkout}; run pnpm install`
    : failureLine(error)
}
