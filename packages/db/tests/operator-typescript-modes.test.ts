// @vitest-environment node
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// An operator value, such as a join operator or `groupKeys()`, gets the
// query's context from the clause it is passed to, by inference. TypeScript
// skips that inference without noImplicitAny, so the operator's callback must
// still compile there, untyped like other callbacks in that mode. Strict mode
// must keep it typed. A reusable operator that passes its context explicitly
// is typed in both modes. Type tests run in strict mode only, so this compiles
// the fixtures in both modes.
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const config = ts.getParsedCommandLineOfConfigFile(
  fileURLToPath(new URL(`../tsconfig.json`, import.meta.url)),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)!

// Sources with deliberate errors live in memory, so the project's own
// typecheck does not see them.
const header = `import { createLiveQueryCollection, eq, groupKeys, leftJoin } from '../../src/index.js'
import type { Collection, ContextFromSource } from '../../src/index.js'

type User = { id: number; name: string }
type Post = { id: number; userId: number }
declare const users: Collection<User, number>
declare const posts: Collection<Post, number>
type UserQuery = ContextFromSource<{ user: typeof users }>
`
type Form = `inline` | `reusable with context` | `reusable without context`
type Operator = `join` | `groupKeys`

// A wrong field in each operator and form. A reusable operator is built
// outside its clause, so only an explicit context can type it.
const wrongField: Record<Operator, Record<Form, string>> = {
  join: {
    inline: `export const q1 = createLiveQueryCollection((q) =>
  q.from({ user: users }).join(leftJoin({ post: posts }, ({ user, post }) => eq(user.nope, post.userId))),
)`,
    'reusable with context': `export const op = leftJoin<{ post: typeof posts }, UserQuery>(
  { post: posts },
  ({ user, post }) => eq(user.nope, post.userId),
)`,
    'reusable without context': `export const op = leftJoin({ post: posts }, ({ user, post }) => eq(user.nope, post.userId))`,
  },
  groupKeys: {
    inline: `export const q1 = createLiveQueryCollection((q) =>
  q.from({ user: users }).groupBy(groupKeys(({ user }) => user.nope)),
)`,
    'reusable with context': `export const keys = groupKeys<UserQuery>(({ user }) => user.nope)`,
    'reusable without context': `export const keys = groupKeys(({ user }) => user.nope)`,
  },
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

const cases = (Object.keys(wrongField) as Array<Operator>).flatMap((operator) =>
  (Object.keys(reportsWrongField) as Array<Form>).map(
    (form) => [operator, form] as const,
  ),
)
const fileOf = (operator: Operator, form: Form) =>
  fixture(`wrong-field-${operator}-${form.replaceAll(` `, `-`)}.ts`)
const inMemory = new Map(
  cases.map(([operator, form]) => [
    fileOf(operator, form),
    `${header}${wrongField[operator][form]}\n`,
  ]),
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
      [fixture(`loose-typescript-operators.ts`), ...inMemory.keys()],
      options,
      host,
    )
    programs.set(noImplicitAny, program)
  }
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(file))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ` `))
}

describe(`operator callbacks across TypeScript modes`, () => {
  it.each([true, false])(`compile with noImplicitAny %s`, (noImplicitAny) => {
    expect(
      errors(fixture(`loose-typescript-operators.ts`), noImplicitAny),
    ).toEqual([])
  })

  it.each(cases)(`reports a wrong field per mode: %s, %s`, (operator, form) => {
    const file = fileOf(operator, form)
    const expected = reportsWrongField[form]
    const wrong = [expect.stringContaining(`Property 'nope' does not exist`)]
    expect(errors(file, true)).toEqual(expected.strict ? wrong : [])
    expect(errors(file, false)).toEqual(expected.loose ? wrong : [])
  })
})
