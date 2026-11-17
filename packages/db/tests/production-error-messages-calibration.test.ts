// Calibrations of the production error-message oracle's model-side checks.
// These tests run no production: the generated-docs check is calibrated with
// the forged catalog observation, and the error-site census classifier with
// the hand-written cases in fixtures/census. The production judgments are in
// production-error-messages-oracle.test.ts.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findErrorSites } from './error-sites-oracle'
import {
  catalogObservation,
  codesPath,
  expectCodesDocumented,
  sitesPath,
} from './production-error-messages-docs-oracle'

const testsDirectory = dirname(fileURLToPath(import.meta.url))

describe(`production error messages`, () => {
  describe(`error sites`, () => {
    // The census is the classifier these laws rest on, so its rules are
    // fixed on hand-written cases: one per rule, in fixtures/census.
    it(`classifies guarded, unguarded, and coded census cases`, () => {
      const cases = findErrorSites(
        resolve(testsDirectory, `fixtures/census/src`),
      )
      expect(cases.plain.map(({ template }) => template)).toEqual([
        `console alias: console.warn`,
        `Or-guarded hint text`,
        `\${devBuild() && process.env.NODE_ENV !== \`production\` ? Failed to save the row: : }`,
        `console alias: {warn}=console`,
        `Helper hint text`,
      ])
      expect(cases.developmentOnly).toEqual([
        { file: `cases.ts`, literals: [`Guarded hint text`] },
        { file: `cases.ts`, literals: [`Braced return hint text`] },
      ])
      expect(
        cases.coded.map(({ code, template, stored }) => [
          code,
          template,
          stored,
        ]),
      ).toEqual([
        [1, `Failed for \${id}`, false],
        [2, `Stored failure text`, true],
      ])
    })
  })

  it.each([`heading`, `class-anchor`, `site-anchor`] as const)(
    `rejects a missing generated %s`,
    (part) => {
      const docs = catalogObservation()
      expectCodesDocumented(docs)
      let wrong: string
      if (part === `heading` || part === `class-anchor`) {
        const codes: Record<string, number> = JSON.parse(
          readFileSync(codesPath, `utf8`),
        )
        const code = Object.values(codes)[0]!
        if (part === `class-anchor`)
          expectCodesDocumented(
            docs.replace(
              `<a id="error-${code}"></a>`,
              `<span data-catalog="class" id = 'error-${code}'></span>`,
            ),
          )
        wrong =
          part === `heading`
            ? docs.replace(new RegExp(`^## Error ${code}\\b.*$`, `m`), ``)
            : docs.replace(`<a id="error-${code}"></a>`, ``)
      } else {
        const sites: Record<string, { kind?: string }> = JSON.parse(
          readFileSync(sitesPath, `utf8`),
        )
        const [code, { kind = `error` }] = Object.entries(sites)[0]!
        wrong = docs.replace(`<a id="${kind}-${code}"></a>`, ``)
      }
      expect(() => expectCodesDocumented(wrong)).toThrow()
    },
  )

  it(`rejects class IDs inside canonical fenced message examples`, () => {
    const docs = catalogObservation()
    const codes: Record<string, number> = JSON.parse(
      readFileSync(codesPath, `utf8`),
    )
    const code = Object.values(codes)[0]!
    const anchor = `<a id="error-${code}"></a>`
    const wrong = docs.replace(anchor, `\`\`\`text\n${anchor}\n\`\`\`\n`)
    expectCodesDocumented(docs)
    expect(() => expectCodesDocumented(wrong)).toThrow()
  })
})
