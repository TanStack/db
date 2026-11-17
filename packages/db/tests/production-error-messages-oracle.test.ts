/**
 * # What does an error say in development and in production?
 *
 * TanStack DB ships full error messages to development builds and short code
 * lines to production builds. A maintainer decision on 2026-10-07 fixes the
 * production form and the switch:
 *
 * - **Development:** `error.message` is the full text it was before codes
 *   existed. `fixtures/error-messages.json` froze that text on `main`
 *   (`9e8ed9978`) for the sample inputs in `error-sample-arguments.ts`.
 * - **Production:** `error.message` is one line:
 *   `TanStack DB error <code>[ (<name>=<value>, ...)]: <docs URL>#error-<code>`.
 *   The code is a positive integer unique to the error class, and it never
 *   changes once assigned; `fixtures/error-codes.json` records every code.
 *   Each value is JSON, so a string cannot add a line or a fake pair. Every
 *   string, number, or `null` input that the full message shows, alone or in
 *   an array, also appears in the code line, so production logs keep keys and
 *   collection ids. Building the line never throws, whatever the inputs.
 * - **Full-text exception:** `SchemaValidationError` keeps its development
 *   message in production too. Its text is mostly the schema library's issue
 *   messages, which apps show to users, so a code would save little and lose
 *   the feedback (maintainer decision, 2026-10-07).
 * - **Both:** the class, its `name`, `instanceof`, and its extra fields are the
 *   same. The switch is an inline `process.env.NODE_ENV` check, so a production
 *   bundler drops the full text; a separate bundle check owns that.
 * - **Docs:** the freshly generated errors page has a heading for every code
 *   that names its class, and an HTML ID matching its production-message link.
 *   This oracle judges the actual generator's stdout. The ordinary
 *   `generate-error-docs.test.ts` also requires the committed page to match
 *   the current catalogs.
 *
 * - **Error sites:** code outside `errors.ts` also throws plain `Error`,
 *   `TypeError`, and `RangeError` values with library text. Each such site
 *   keeps its class and switches its message with the same check. Its
 *   development message is the template frozen on `main` in
 *   `fixtures/error-site-messages.json`, with its code: the literal text and
 *   the interpolated expressions, independent of formatting. The same
 *   expressions in the same scope give the same message for every input.
 *   Descriptor error 113 follows the same missing-client condition from source
 *   construction to query consumption; its new template is framework-neutral.
 *   Cache conflict 234 also names getKey/schema options after the maintainer's
 *   decision to reject incompatible local row behavior under one query identity.
 *   Every interpolated expression whose values production can show, or one of
 *   its sub-expressions, is passed to the code line. Plain objects, such as
 *   rows, never reach it (maintainer decision, 2026-10-07). `AggregateError` messages count too. A message built only
 *   from a caller's value, such as `new Error(String(error))`, is not a site.
 * - **Console messages:** a `console` call that reports a runtime failure is a
 *   site too and is coded the same way. A developer hint is development-only:
 *   it sits inside the erasable guard's branch, or after an early `return` on
 *   its negation, and its text is frozen in
 *   `fixtures/development-only-messages.json`. The bundle check proves that
 *   production drops every frozen hint (maintainer decision, 2026-10-08).
 *
 * The model is the frozen fixtures and the format above; nothing here reads
 * codes from `src/errors.ts`. The production path is every error class that the
 * public package entry exports, wherever it is defined, constructed directly
 * under `vi.stubEnv('NODE_ENV', ...)`. Errors that production code builds
 * elsewhere reach users through the same constructors. For error sites, the
 * observation is the source itself, read by `error-sites-oracle.ts`: a site cannot be
 * constructed alone, and the shared `codedMessage` is checked through the
 * classes.
 *
 * Limits: the sample inputs per class, and a fixed set of hostile inputs
 * substituted one argument at a time. Messages a caller passes to a base class
 * (`callerMessageClasses`) are the caller's text and stay unchanged in both
 * modes; every other exported class must have a code.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, vi } from 'vitest'
import * as Errors from '../src/index'
import { codedWarning } from '../src/error-message'
import { errorSampleArguments } from './error-sample-arguments'
import { exportedErrorClasses } from './production-error-messages-fixture'
import { findErrorSites } from './error-sites-oracle'
import { withErrorDocsFixture } from './generate-error-docs-fixture'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  codesPath,
  expectCodesDocumented,
  sitesPath,
} from './production-error-messages-docs-oracle'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const devMessages: Record<string, Array<string>> = JSON.parse(
  readFileSync(resolve(testsDirectory, `fixtures/error-messages.json`), `utf8`),
)
const developmentOnlyPath = resolve(
  testsDirectory,
  `fixtures/development-only-messages.json`,
)
const docsUrl = `https://tanstack.com/db/latest/docs/errors`

/** The production line, as the decision states it. */
const productionLine = new RegExp(
  `^TanStack DB error (\\d+)(?: \\((.+)\\))?: ${docsUrl.replace(/[./]/g, `\\$&`)}#error-(\\d+)$`,
)

type ErrorConstructor = new (...args: Array<any>) => Error

/** Base classes whose message the caller supplies; they have no code. */
const callerMessageClasses = new Set([
  `TanStackDBError`,
  `NonRetriableError`,
  `CollectionConfigurationError`,
  `CollectionStateError`,
  `CollectionOperationError`,
  `MissingHandlerError`,
  `TransactionError`,
  `QueryBuilderError`,
  `QueryCompilationError`,
  `JoinError`,
  `GroupByError`,
  `StorageError`,
  `LocalStorageCollectionError`,
  `QueryOptimizerError`,
])

/** Classes whose production message is their full development message. */
const fullMessageClasses = new Set([`SchemaValidationError`])

/** Inputs that a careless formatter could throw on or break the line with. */
const hostileInputs: Array<unknown> = [
  Symbol(`s`),
  [Symbol(`s`)],
  Object.create(null),
  [Object.create(null)],
  null,
  1n,
  NaN,
  Infinity,
  undefined,
  `a\nb, c=d)`,
  `a\u2028b\u2029c`,
  [{ secret: `row` }],
  // JSON calls toJSON before any replacer, so these must never reach it.
  [{ toJSON: () => `secret-row` }],
  Object.assign([1], { toJSON: () => `secret-array` }),
  [1n],
  [undefined],
]

function construct(name: string, args: Array<unknown>, mode: string): Error {
  vi.stubEnv(`NODE_ENV`, mode)
  try {
    return new (Errors as unknown as Record<string, ErrorConstructor>)[name]!(
      ...args,
    )
  } finally {
    vi.unstubAllEnvs()
  }
}

/** Fields other than `message` and `stack`, for the both-modes comparison. */
function shape(error: Error) {
  const {
    message: _message,
    stack: _stack,
    ...fields
  } = Object.fromEntries(Object.entries(error))
  return { constructor: error.constructor, name: error.name, fields }
}

/** The JSON of each string, number, or `null` input the full message shows. */
function shownInputs(args: Array<unknown>, devMessage: string): Array<string> {
  return args
    .flatMap((arg) => (Array.isArray(arg) ? arg : [arg]))
    .filter(
      (arg): arg is string | number | null =>
        arg === null || typeof arg === `string` || typeof arg === `number`,
    )
    .filter((arg) => String(arg).length > 0 && devMessage.includes(String(arg)))
    .map((arg) => JSON.stringify(arg))
}

// The check: the production outputs match the expected record for this claim.
function expectEveryClassCoded(): void {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  const uncoded = exportedErrorClasses
    .map(([name]) => name)
    .filter(
      (name) =>
        !(name in codes) &&
        !callerMessageClasses.has(name) &&
        !fullMessageClasses.has(name),
    )
  expect(uncoded).toEqual([])
}

// The check: the production outputs match the expected record for this claim.
function expectFullTextInProduction(): void {
  for (const name of fullMessageClasses)
    errorSampleArguments[name]!.forEach((args, index) => {
      expect(construct(name, args, `production`).message, name).toBe(
        devMessages[name]![index],
      )
    })
}

// The check: the production outputs match the expected record for this claim.
function expectDevelopmentMessages(): void {
  for (const [name, argSets] of Object.entries(errorSampleArguments))
    argSets.forEach((args, index) => {
      expect(
        construct(name, args, `development`).message,
        `${name} sample ${index}`,
      ).toBe(devMessages[name]![index])
    })
}

// The check: the production outputs match the expected record for this claim.
function expectClassShapeInBothModes(): void {
  for (const [name, argSets] of Object.entries(errorSampleArguments))
    for (const args of argSets) {
      const dev = construct(name, args, `development`)
      const prod = construct(name, args, `production`)
      expect(shape(prod), name).toEqual(shape(dev))
      expect(prod, name).toBeInstanceOf(
        (Errors as unknown as Record<string, ErrorConstructor>)[name]!,
      )
    }
}

// The check: the production outputs match the expected record for this claim.
function expectCodedProductionLines(): void {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  const seen = new Map<number, string>()
  for (const [name, argSets] of Object.entries(errorSampleArguments)) {
    if (!(name in codes)) continue
    argSets.forEach((args, index) => {
      const message = construct(name, args, `production`).message
      const match = productionLine.exec(message)
      expect(match, `${name}: ${message}`).not.toBeNull()
      const code = Number(match![1])
      expect(Number(match![3]), `${name} anchor`).toBe(code)
      expect(code, `${name} code`).toBe(codes[name])
      for (const input of shownInputs(args, devMessages[name]![index]!))
        expect(match![2] ?? ``, `${name} keeps ${input}`).toContain(input)
    })
    const owner = seen.get(codes[name]!)
    expect(owner, `code ${codes[name]} reused by ${name}`).toBeUndefined()
    seen.set(codes[name]!, name)
  }
  expect(seen.size).toBeGreaterThan(80)
}

// The check: the production outputs match the expected record for this claim.
function expectHostileInputsCoded(): void {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  for (const [name, argSets] of Object.entries(errorSampleArguments)) {
    if (!(name in codes)) continue
    for (const args of argSets)
      args.forEach((_, position) => {
        for (const hostile of hostileInputs) {
          const replaced = args.map((arg, index) =>
            index === position ? hostile : arg,
          )
          let message: string
          try {
            message = construct(name, replaced, `production`).message
          } catch (error) {
            throw new Error(`${name} argument ${position} threw: ${error}`)
          }
          const match = productionLine.exec(message)
          expect(match, `${name}: ${message}`).not.toBeNull()
          expect(Number(match![1]), name).toBe(codes[name])
          // A plain object never reaches the line, not even inside an array.
          expect(message, name).not.toContain(`secret`)
        }
      })
  }
}

// JSON cannot show these values faithfully, but production logs need them:
// a symbol or bigint shows as a quoted string, and `undefined`, `NaN`, and
// the infinities show as themselves rather than as `null` or nothing.
// The check: the production outputs match the expected record for this claim.
function expectUnencodableValuesShown(): void {
  const codes: Record<string, number> = JSON.parse(
    readFileSync(codesPath, `utf8`),
  )
  for (const [name, argSets] of Object.entries(errorSampleArguments)) {
    if (!(name in codes)) continue
    argSets.forEach((args, index) => {
      args.forEach((arg, position) => {
        if (typeof arg !== `string` || arg.length < 3) return
        if (!devMessages[name]![index]!.includes(arg)) return
        for (const [value, shown] of [
          [Symbol(`probe`), `"Symbol(probe)"`],
          [7n, `"7"`],
          [undefined, `=undefined`],
          [NaN, `=NaN`],
          [-Infinity, `=-Infinity`],
          [[7n, undefined, NaN], `=["7","undefined","NaN"]`],
        ] as const) {
          const replaced = args.map((original, at) =>
            at === position ? value : original,
          )
          const message = construct(name, replaced, `production`).message
          expect(message, `${name} argument ${position}`).toContain(shown)
        }
      })
    })
  }
}

// This receiving driver copies the actual CLI and full frozen catalog into a
// disposable repository, then judges its real stdout. Even a broken stdout
// mode cannot write the active checkout's generated page.
function renderErrorDocs(): string {
  return withErrorDocsFixture((fixture) => {
    const result = fixture.run(`--stdout`)
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(
        `Error docs CLI failed (${result.status}):\n${result.stderr}`,
      )
    return result.stdout
  })
}

// What this oracle owns: the gap report judges the error classes and the
// message builder that produce each error's development and production text,
// by this file's tests. The error sites that throw library text outside
// errors.ts are read from source by error-sites-oracle.ts.
const errorMessagesLaw = {
  statement: `Each exported error class keeps its frozen development message, class shape and fields in both modes, and writes one coded production line that shows its inputs; each library error site keeps its frozen template and code; the generated docs document every code.`,
  authority: `The maintainer decisions of 2026-10-07 and 2026-10-08 stated above, with the frozen fixtures as the model.`,
  limits: `The sample inputs per class and the fixed hostile inputs substituted one argument at a time; error sites are read from source; the docs check covers the actual generator's stdout.`,
}

// The real generator's stdout must document every code with its class.
function documentEveryCode(): void {
  const states = [`cli-stdout-received`, `catalog-compared`] as const
  const reached = new Set<(typeof states)[number]>()
  try {
    const docs = renderErrorDocs()
    reached.add(`cli-stdout-received`)
    expectCodesDocumented(docs)
    reached.add(`catalog-compared`)
    for (const state of states)
      expect(reached.has(state), `${state} history minimum`).toBe(true)
  } finally {
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        `production-errors.generated-docs reach`,
        Object.fromEntries(
          states.map((state) => [state, Number(reached.has(state))]),
        ),
      )
  }
}

describe(`production error messages`, () => {
  afterEach(() => vi.unstubAllEnvs())

  // Each history names one claim, and its existing check runs the production
  // constructors against the frozen fixtures.
  const classChecks: ReadonlyArray<readonly [string, () => void]> = [
    [
      `codes every exported class except the caller-message bases`,
      expectEveryClassCoded,
    ],
    [
      `keeps the full message in production for full-text classes`,
      expectFullTextInProduction,
    ],
    [`keeps every development message unchanged`, expectDevelopmentMessages],
    [
      `keeps class, name, instanceof, and fields in both modes`,
      expectClassShapeInBothModes,
    ],
    [
      `writes a coded production line with the shown inputs`,
      expectCodedProductionLines,
    ],
    [`writes one coded line for hostile inputs`, expectHostileInputsCoded],
    [
      `shows values that JSON cannot encode in a shown position`,
      expectUnencodableValuesShown,
    ],
  ]
  oracleProperty({
    id: `production-errors.classes`,
    law: errorMessagesLaw,
    owns: [`src/errors.ts`, `src/error-message.ts`],
    histories: classChecks.map(([name]) => name),
    label: (name) => name,
    resolve: (name) => ({
      check: classChecks.find(([candidate]) => candidate === name)![1],
    }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`production-errors.classes`, plan, observe, () =>
        plan.check(),
      ),
    check: forwardAssertionJudgment,
  })

  describe(`error sites`, () => {
    const sites = findErrorSites(
      resolve(testsDirectory, `../src`),
      callerMessageClasses,
    )
    const frozen: Record<
      string,
      {
        file: string
        template: string
        literals: Array<string>
        kind?: `warning`
      }
    > = JSON.parse(readFileSync(sitesPath, `utf8`))

    // Only validateCollectionConfig reaches these diagnostics, and
    // createCollection calls it behind the erasable guard, so production
    // bundles drop the whole module. The bundle check proves that erasure.
    const developmentOnlyFiles = new Set([`collection/config-errors.ts`])

    function expectEverySiteCoded(): void {
      expect(
        sites.plain.filter(({ file }) => !developmentOnlyFiles.has(file)),
      ).toEqual([])
    }

    function expectSiteMessagesFrozen(): void {
      const current = Object.fromEntries(
        sites.coded.map(({ code, file, template, literals, kind }) => [
          code,
          {
            file,
            template,
            literals: literals.filter((text) => /[A-Za-z]/.test(text)),
            ...(kind === `warning` ? { kind } : {}),
          },
        ]),
      )
      expect(sites.coded).toHaveLength(Object.keys(current).length)
      expect(current).toEqual(frozen)
    }

    function expectShowableValuesPassed(): void {
      for (const site of sites.coded)
        for (const interpolation of site.interpolations.filter(
          ({ showable }) => showable,
        ))
          expect(
            // A value covers an interpolation that contains it, such as
            // `key` in `String(key)`, or one it contains, such as
            // `syncFailure` in `syncFailure !== undefined`.
            site.values.some(
              ({ expression, parts }) =>
                interpolation.parts.includes(expression) ||
                parts.includes(interpolation.expression),
            ),
            `${site.file} error ${site.code} drops \${${interpolation.expression}}`,
          ).toBe(true)
    }

    // Production lines never carry plain objects, such as rows.
    function expectOnlyShowableValues(): void {
      const hidden = sites.coded.flatMap(({ file, code, values }) =>
        values
          .filter(({ showable }) => !showable)
          .map(({ expression }) => `${file} error ${code}: ${expression}`),
      )
      expect(hidden).toEqual([])
    }

    function expectClassGuardCodes(): void {
      const codes: Record<string, number> = JSON.parse(
        readFileSync(codesPath, `utf8`),
      )
      for (const guard of sites.classGuards)
        expect(guard.code, `${guard.file} ${guard.name}`).toBe(
          codes[guard.name],
        )
    }

    // Developer hints are development-only (maintainer decision,
    // 2026-10-08). Their text is frozen here, and the bundle check proves a
    // production bundle drops every frozen literal.
    function expectDevelopmentOnlyLiteralsFrozen(): void {
      const frozenRegions: Array<{ file: string; literals: Array<string> }> =
        JSON.parse(readFileSync(developmentOnlyPath, `utf8`))
      expect(sites.developmentOnly).toEqual(frozenRegions)
    }

    // The warning and sink laws read where a message is used, so a coded
    // message is used where it is written, not stored first.
    function expectCodedMessagesUsedInPlace(): void {
      expect(
        sites.coded
          .filter(({ stored }) => stored)
          .map(({ file, code }) => `${file} ${code}`),
      ).toEqual([])
    }

    // A warning says so (maintainer decision, 2026-10-08): a console.warn
    // message uses codedWarning, and nothing else does.
    function expectWarningsCoded(): void {
      const mismatched = sites.coded
        .filter(({ kind, inWarn }) => (kind === `warning`) !== inWarn)
        .map(({ file, code, kind }) => `${file} ${kind} ${code}`)
      expect(mismatched).toEqual([])
      expect(codedWarning(7, { key: 1 })).toBe(
        `TanStack DB warning 7 (key=1): ${docsUrl}#warning-7`,
      )
    }

    function expectNoClassCodeReuse(): void {
      const codes: Record<string, number> = JSON.parse(
        readFileSync(codesPath, `utf8`),
      )
      const classCodes = new Set(Object.values(codes))
      expect(sites.coded.filter(({ code }) => classCodes.has(code))).toEqual([])
    }

    const siteChecks: ReadonlyArray<readonly [string, () => void]> = [
      [`codes every site that throws library text`, expectEverySiteCoded],
      [
        `keeps each site's development message and code`,
        expectSiteMessagesFrozen,
      ],
      [
        `passes every showable interpolated value to the code line`,
        expectShowableValuesPassed,
      ],
      [
        `passes only values that the code line can show`,
        expectOnlyShowableValues,
      ],
      [
        `registers the code of every error class outside errors.ts`,
        expectClassGuardCodes,
      ],
      [
        `freezes every development-only literal`,
        expectDevelopmentOnlyLiteralsFrozen,
      ],
      [
        `uses every coded message where it is written`,
        expectCodedMessagesUsedInPlace,
      ],
      [`codes a console.warn message as a warning`, expectWarningsCoded],
      [`never reuses a class code`, expectNoClassCodeReuse],
    ]
    oracleProperty({
      id: `production-errors.sites`,
      law: errorMessagesLaw,
      owns: [`src/errors.ts`, `src/error-message.ts`],
      histories: siteChecks.map(([name]) => name),
      label: (name) => name,
      resolve: (name) => ({
        check: siteChecks.find(([candidate]) => candidate === name)![1],
      }),
      model: recordedAssertionJudgment,
      driver: (plan, observe) =>
        recordAssertionJudgment(`production-errors.sites`, plan, observe, () =>
          plan.check(),
        ),
      check: forwardAssertionJudgment,
    })
  })

  oracleProperty({
    id: `production-errors.generated-docs`,
    law: errorMessagesLaw,
    owns: [`src/errors.ts`, `src/error-message.ts`],
    histories: [`documents every code with its class`],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `production-errors.generated-docs`,
        plan,
        observe,
        documentEveryCode,
      ),
    check: forwardAssertionJudgment,
  })
})
