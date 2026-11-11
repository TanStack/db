// The generated-docs check of the production error-message oracle and the
// forged catalog observation that calibrates it. The law, its authority, and
// its limits are stated in production-error-messages-oracle.test.ts, which
// judges the real generator's stdout with this check;
// production-error-messages-calibration.test.ts calibrates the check with the
// forged catalog. This module registers no tests and has no side effects.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
export const codesPath = resolve(testsDirectory, `fixtures/error-codes.json`)
export const sitesPath = resolve(
  testsDirectory,
  `fixtures/error-site-messages.json`,
)

// The check: the production outputs match the expected record for this claim.
export function expectCodesDocumented(docs: string): void {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  // The link names an HTML ID, not one spelling of an anchor tag. Parsing
  // admits valid quote, attribute-spacing and element choices.
  // The actual generator puts literal messages in canonical ```text fences.
  // Their contents render as code, so they cannot supply link targets. This
  // bounded extraction covers those fences, not arbitrary Markdown layouts.
  const html = docs.replace(/^```text\r?\n[\s\S]*?^```(?:\r?\n|$)/gm, ``)
  const ids = new Set(
    [
      ...new DOMParser()
        .parseFromString(html, `text/html`)
        .querySelectorAll(`[id]`),
    ].map((element) => element.id),
  )
  for (const [name, code] of Object.entries(codes)) {
    const heading = new RegExp(`^## Error ${code}\\b.*${name}`, `m`)
    expect(docs, `${name} (${code})`).toMatch(heading)
    expect(ids, `${name} (${code}) anchor`).toContain(`error-${code}`)
  }
  const sites: Record<string, { file: string; kind?: string }> = JSON.parse(
    readFileSync(sitesPath, `utf8`),
  )
  for (const [code, { file, kind }] of Object.entries(sites)) {
    const title = kind === `warning` ? `Warning` : `Error`
    const anchor = `<a id="${kind ?? `error`}-${code}"></a>`
    const heading = new RegExp(`^## ${title} ${code}\\b.*${file}`, `m`)
    expect(docs, `${title} ${code} (${file})`).toMatch(heading)
    expect(docs, `${title} ${code} anchor`).toContain(anchor)
  }
}

// Checker calibration supplies only the catalog facts the law requires.
// This forged observation has no prose/examples/layout from the renderer and
// supplies no production evidence. Its validity is independent of CLI stdout.
export function catalogObservation(): string {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  const sites: Record<string, { file: string; kind?: string }> = JSON.parse(
    readFileSync(sitesPath, `utf8`),
  )
  return [
    ...Object.entries(codes).flatMap(([name, code]) => [
      `<a id="error-${code}"></a>`,
      `## Error ${code}: ${name}`,
    ]),
    ...Object.entries(sites).flatMap(([code, { file, kind }]) => [
      `<a id="${kind ?? `error`}-${code}"></a>`,
      `## ${kind === `warning` ? `Warning` : `Error`} ${code}: ${file}`,
    ]),
  ].join(`\n`)
}
