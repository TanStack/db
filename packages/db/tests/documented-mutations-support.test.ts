import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import {
  checkDocumentedRequest,
  documentedHandlers,
  documentedMutationHistories,
  documentedMutationInputs,
  negativeDocumentedHandlers,
} from './documented-mutations-oracle'
import {
  extractDocumentedHandler,
  selectDocumentedHistories,
} from './documented-mutations-support'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const root = resolve(process.cwd(), `../..`)

test(`inventory locates every authored current and negative handler`, () => {
  expect(documentedHandlers).toHaveLength(30)
  expect(negativeDocumentedHandlers).toHaveLength(3)
  expect(
    new Set(documentedHandlers.map((h) => `${h.file}:${h.heading}:${h.fence}`))
      .size,
  ).toBe(18)
  for (const handler of [...documentedHandlers, ...negativeDocumentedHandlers])
    expect(extractDocumentedHandler(handler, root)).toMatch(/^async\b/)
  expect(documentedMutationHistories(`query`)).toHaveLength(134)
  expect(documentedMutationHistories(`electric`)).toHaveLength(56)
})

test.each([`migration-query`, `migration-electric`, `skill-correct`])(
  `current and negative markers select distinct actual ASTs: %s`,
  (id) => {
    const current = documentedHandlers.find((h) => h.id.startsWith(`${id}/`))!
    const previous = negativeDocumentedHandlers.find(
      (h) => h.file === current.file && h.heading === current.heading,
    )!
    expect(extractDocumentedHandler(current, root)).not.toBe(
      extractDocumentedHandler(previous, root),
    )
  },
)

test.each([
  { name: `missing heading`, body: `# Another\n` },
  { name: `duplicate heading`, body: `# Section\n# Section\n` },
  {
    name: `missing typed fence`,
    body: `# Section\n\n\x60\x60\x60js\n\x60\x60\x60`,
  },
  {
    name: `ambiguous handler`,
    body: `# Section\n\x60\x60\x60ts\nconst x = { onInsert: async () => {}, onInsert: async () => {} }\n\x60\x60\x60`,
  },
])(`refuses an invalid exact locator: $name`, ({ body }) => {
  const directory = mkdtempSync(resolve(tmpdir(), `documented-handler-`))
  try {
    writeFileSync(resolve(directory, `fixture.md`), body)
    expect(() =>
      extractDocumentedHandler(
        {
          ...documentedHandlers[0]!,
          file: `fixture.md`,
          heading: `# Section`,
        },
        directory,
      ),
    ).toThrow()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test(`finite replay selects the exact authored history and rejects an unknown id`, () => {
  const histories = documentedMutationHistories(`query`)
  vi.stubEnv(`TANSTACK_DB_DOCUMENTED_MUTATION_CASE`, histories[4]!.id)
  expect(selectDocumentedHistories(histories)).toStrictEqual([histories[4]])
  vi.stubEnv(`TANSTACK_DB_DOCUMENTED_MUTATION_CASE`, `unknown`)
  expect(() => selectDocumentedHistories(histories)).toThrow(/Unknown/)
})

// Reach is no longer a counter beside the tests: each enumerated history owes
// its own cuts (owedDocumentedCuts), and the native property's calibrations in
// documented-mutations-oracle.ts show that the check rejects a lost reach cut,
// a lost comparison cut, and a cut the history does not owe.

test.each([`original instead of modified`, `wrong key`, `omitted field`])(
  `request collaborator rejects %s`,
  (fault) => {
    const history = documentedMutationHistories(`query`).find(
      (h) => h.handler.id === `mutations-after/insert`,
    )!
    const inputs = documentedMutationInputs(history.handler)
    const payload = structuredClone(inputs.optimistic)
    checkDocumentedRequest(history, inputs.before, inputs.optimistic, [payload])
    if (fault === `original instead of modified`)
      Object.assign(payload, inputs.before)
    else if (fault === `wrong key`) payload.id = `wrong`
    else delete payload.completed
    expect(() =>
      checkDocumentedRequest(history, inputs.before, inputs.optimistic, [
        payload,
      ]),
    ).toThrow()
  },
)

test.each([`wrong URL`, `wrong method`, `wrong body`])(
  `fetch collaborator rejects %s`,
  (fault) => {
    const history = documentedMutationHistories(`query`)[0]!
    const inputs = documentedMutationInputs(history.handler)
    const options = { method: `POST`, body: JSON.stringify(inputs.optimistic) }
    checkDocumentedRequest(history, inputs.before, inputs.optimistic, [
      `/api/todos`,
      options,
    ])
    if (fault === `wrong method`) options.method = `GET`
    if (fault === `wrong body`) options.body = JSON.stringify(inputs.before)
    expect(() =>
      checkDocumentedRequest(history, inputs.before, inputs.optimistic, [
        fault === `wrong URL` ? `/other` : `/api/todos`,
        options,
      ]),
    ).toThrow()
  },
)
