// @vitest-environment node
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A join operator gets the query's context from `.join()` by inference.
// TypeScript skips that inference without noImplicitAny, so a join condition
// must still compile there, untyped like other callbacks in that mode.
// Strict mode must keep it typed. Type tests run in strict mode only, so this
// compiles one fixture in both modes.
const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const config = ts.getParsedCommandLineOfConfigFile(
  fileURLToPath(new URL(`../tsconfig.json`, import.meta.url)),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)!

// A source with a deliberate error lives in memory, so the project's own
// typecheck does not see it.
const wrongField = fixture(`strict-join-field-error.ts`)
const wrongFieldSource = `// Compiled by join-typescript-modes.test.ts. Strict mode must reject the
// wrong field; without noImplicitAny the condition is untyped.
import { createLiveQueryCollection, eq, leftJoin } from '../../src/index.js'
import type { Collection } from '../../src/index.js'

type User = { id: number; name: string }
type Post = { id: number; userId: number }
declare const users: Collection<User, number>
declare const posts: Collection<Post, number>

export const joined = createLiveQueryCollection((q) =>
  q
    .from({ user: users })
    .join(
      leftJoin({ post: posts }, ({ user, post }) => eq(user.nope, post.userId)),
    ),
)
`

function errors(file: string, noImplicitAny: boolean) {
  const options = { ...config.options, noImplicitAny, noEmit: true }
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile
  host.readFile = (path) =>
    path === wrongField ? wrongFieldSource : readFile(path)
  const fileExists = host.fileExists
  host.fileExists = (path) => path === wrongField || fileExists(path)
  const program = ts.createProgram([file], options, host)
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(file))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ` `))
}

describe(`join conditions across TypeScript modes`, () => {
  it.each([true, false])(`compile with noImplicitAny %s`, (noImplicitAny) => {
    expect(errors(fixture(`loose-typescript-joins.ts`), noImplicitAny)).toEqual(
      [],
    )
  })

  // The untyped fallback must not reach strict mode: a wrong field still fails.
  it(`keep a wrong field an error in strict mode only`, () => {
    const file = wrongField
    expect(errors(file, true)).toEqual([
      expect.stringContaining(`Property 'nope' does not exist`),
    ])
    expect(errors(file, false)).toEqual([])
  })
})
