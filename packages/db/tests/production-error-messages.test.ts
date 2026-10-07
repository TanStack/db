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
 * - **Docs:** `docs/errors.md` has a heading for every code that names its
 *   class.
 *
 * The model is the frozen fixtures and the format above; nothing here reads
 * codes from `src/errors.ts`. The production path is the exported error
 * classes constructed directly under `vi.stubEnv('NODE_ENV', ...)`. Errors that
 * production code builds elsewhere reach users through the same constructors.
 *
 * Limits: the sample inputs per class, and a fixed set of hostile inputs
 * substituted one argument at a time. Messages a caller passes to a base class
 * (`callerMessageClasses`) are the caller's text and stay unchanged in both
 * modes; every other exported class must have a code.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Errors from '../src/errors'
import { errorSampleArguments } from './error-sample-arguments'

const testsDirectory = dirname(fileURLToPath(import.meta.url))
const devMessages: Record<string, Array<string>> = JSON.parse(
  readFileSync(resolve(testsDirectory, `fixtures/error-messages.json`), `utf8`),
)
const codesPath = resolve(testsDirectory, `fixtures/error-codes.json`)
const docsPath = resolve(testsDirectory, `../../../docs/errors.md`)
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
  `a\nb, c=d)`,
]

const exportedErrorClasses = Object.entries(Errors).filter(
  ([, value]) =>
    typeof value === `function` && value.prototype instanceof Error,
)

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

describe(`production error messages`, () => {
  afterEach(() => vi.unstubAllEnvs())

  it(`codes every exported class except the caller-message bases`, () => {
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
  })

  it(`keeps the full message in production for full-text classes`, () => {
    for (const name of fullMessageClasses)
      errorSampleArguments[name]!.forEach((args, index) => {
        expect(construct(name, args, `production`).message, name).toBe(
          devMessages[name]![index],
        )
      })
  })

  it(`has sample inputs for every exported error class`, () => {
    const missing = exportedErrorClasses
      .map(([name]) => name)
      .filter((name) => !(name in errorSampleArguments))
    expect(missing).toEqual([])
  })

  it(`keeps every development message unchanged`, () => {
    for (const [name, argSets] of Object.entries(errorSampleArguments))
      argSets.forEach((args, index) => {
        expect(
          construct(name, args, `development`).message,
          `${name} sample ${index}`,
        ).toBe(devMessages[name]![index])
      })
  })

  it(`keeps class, name, instanceof, and fields in both modes`, () => {
    for (const [name, argSets] of Object.entries(errorSampleArguments))
      for (const args of argSets) {
        const dev = construct(name, args, `development`)
        const prod = construct(name, args, `production`)
        expect(shape(prod), name).toEqual(shape(dev))
        expect(prod, name).toBeInstanceOf(
          (Errors as unknown as Record<string, ErrorConstructor>)[name]!,
        )
      }
  })

  it(`writes a coded production line with the shown inputs`, () => {
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
  })

  it(`writes one coded line for hostile inputs`, () => {
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
          }
        })
    }
  })

  it(`documents every code with its class`, () => {
    const codes: Record<string, number> = JSON.parse(
      readFileSync(codesPath, `utf8`),
    )
    const docs = readFileSync(docsPath, `utf8`)
    for (const [name, code] of Object.entries(codes)) {
      const heading = new RegExp(`^## Error ${code}\\b.*${name}`, `m`)
      expect(docs, `${name} (${code})`).toMatch(heading)
    }
  })
})
