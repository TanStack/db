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
 *   Every primitive input that the full message shows also appears in the
 *   code line, so production logs keep keys and collection ids.
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
 * Limits: one set of sample inputs per class; messages a caller passes to a
 * base class (`TanStackDBError`, `CollectionConfigurationError`, ...) are the
 * caller's text and stay unchanged in both modes.
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

/** Primitive inputs that the full message shows. */
function shownInputs(args: Array<unknown>, devMessage: string): Array<string> {
  return args
    .filter(
      (arg): arg is string | number =>
        typeof arg === `string` || typeof arg === `number`,
    )
    .map(String)
    .filter((text) => text.length > 0 && devMessage.includes(text))
}

describe(`production error messages`, () => {
  afterEach(() => vi.unstubAllEnvs())

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
      // A caller supplies a base class's message; it is not coded.
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
