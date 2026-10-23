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
`
const wrongFields = {
  inlineJoin: `${header}
export const joined = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .join(leftJoin({ post: posts }, ({ user, post }) => eq(user.nope, post.userId))),
)
`,
  groupKeys: `${header}
export const grouped = createLiveQueryCollection((q) =>
  q.from({ user: users }).groupBy(groupKeys(({ user }) => user.nope)),
)
`,
  reusableJoin: `${header}
export const withPosts = leftJoin<{ post: typeof posts }, ContextFromSource<{ user: typeof users }>>(
  { post: posts },
  ({ user, post }) => eq(user.nope, post.userId),
)
`,
}
const inMemory = new Map(
  Object.entries(wrongFields).map(([name, source]) => [
    fixture(`wrong-field-${name}.ts`),
    source,
  ]),
)

function errors(file: string, noImplicitAny: boolean) {
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
  const program = ts.createProgram([file], options, host)
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

  // The untyped fallback must not reach strict mode: a wrong field still fails.
  it.each([`inlineJoin`, `groupKeys`])(
    `keep a wrong field an error in strict mode only: %s`,
    (name) => {
      const file = fixture(`wrong-field-${name}.ts`)
      expect(errors(file, true)).toEqual([
        expect.stringContaining(`Property 'nope' does not exist`),
      ])
      expect(errors(file, false)).toEqual([])
    },
  )

  it(`keep a wrong field an error in a reusable operator in both modes`, () => {
    const file = fixture(`wrong-field-reusableJoin.ts`)
    for (const noImplicitAny of [true, false])
      expect(errors(file, noImplicitAny)).toEqual([
        expect.stringContaining(`Property 'nope' does not exist`),
      ])
  })
})
