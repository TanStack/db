// @vitest-environment node
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// `groupKeys()` gets the query's context from `.groupBy()`, by inference.
// TypeScript skips that inference without noImplicitAny, so its callback must
// still compile there, untyped like other callbacks in that mode. Strict mode
// must keep it typed. Group keys that pass their context explicitly are typed
// in both modes. Type tests run in strict mode only, so this compiles the
// fixtures in both modes.
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const config = ts.getParsedCommandLineOfConfigFile(
  fileURLToPath(new URL(`../tsconfig.json`, import.meta.url)),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)!

// Sources with deliberate errors live in memory, so the project's own
// typecheck does not see them.
const header = `import { createLiveQueryCollection, groupKeys } from '../../src/index.js'
import type { Collection, ContextFromSource } from '../../src/index.js'

type User = { id: number; name: string }
declare const users: Collection<User, number>
type UserQuery = ContextFromSource<{ user: typeof users }>
`
type Form = `inline` | `reusable with context` | `reusable without context`

// A wrong field in each form. Reusable group keys are built outside
// `.groupBy()`, so only an explicit context can type them.
const wrongField: Record<Form, string> = {
  inline: `export const q1 = createLiveQueryCollection((q) =>
  q.from({ user: users }).groupBy(groupKeys(({ user }) => user.nope)),
)`,
  'reusable with context': `export const keys = groupKeys<UserQuery>(({ user }) => user.nope)`,
  'reusable without context': `export const keys = groupKeys(({ user }) => user.nope)`,
}

// Whether each form must report the wrong field, in strict mode and without
// noImplicitAny. Inline operators follow the mode, as other callbacks do. An
// explicit context types a reusable operator in both modes. Without one,
// TypeScript has no context to infer, and the operator is untyped in both:
// a documented limit, which the guide answers with the explicit form.
const reportsWrongField: Record<Form, { strict: boolean; loose: boolean }> = {
  inline: { strict: true, loose: false },
  'reusable with context': { strict: true, loose: true },
  'reusable without context': { strict: false, loose: false },
}

const forms = Object.keys(wrongField) as Array<Form>
const fileOf = (form: Form) =>
  fixture(`wrong-field-group-keys-${form.replaceAll(` `, `-`)}.ts`)
const inMemory = new Map(
  forms.map((form) => [fileOf(form), `${header}${wrongField[form]}\n`]),
)

// One program per mode compiles every file; each test reads its own file's
// diagnostics. A program per file would take seconds per test.
const programs = new Map<boolean, ts.Program>()
function errors(file: string, noImplicitAny: boolean) {
  let program = programs.get(noImplicitAny)
  if (!program) {
    const options = {
      ...config.options,
      noImplicitAny,
      noUnusedLocals: false,
      noEmit: true,
    }
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile
    host.readFile = (path) => inMemory.get(path) ?? readFile(path)
    const fileExists = host.fileExists
    host.fileExists = (path) => inMemory.has(path) || fileExists(path)
    program = ts.createProgram(
      [fixture(`loose-typescript-group-keys.ts`), ...inMemory.keys()],
      options,
      host,
    )
    programs.set(noImplicitAny, program)
  }
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(file))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ` `))
}

describe(`groupKeys callbacks across TypeScript modes`, () => {
  it.each([true, false])(
    `compile with noImplicitAny %s`,
    (noImplicitAny) => {
      expect(
        errors(fixture(`loose-typescript-group-keys.ts`), noImplicitAny),
      ).toEqual([])
      // Building a program takes seconds; later tests reuse it.
    },
    30_000,
  )

  it.each(forms)(
    `reports a wrong field per mode: %s`,
    (form) => {
      const expected = reportsWrongField[form]
      const wrong = [expect.stringContaining(`Property 'nope' does not exist`)]
      expect(errors(fileOf(form), true)).toEqual(expected.strict ? wrong : [])
      expect(errors(fileOf(form), false)).toEqual(expected.loose ? wrong : [])
    },
    30_000,
  )
})
