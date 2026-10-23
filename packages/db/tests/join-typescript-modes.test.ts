// @vitest-environment node
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A join operator gets the query's context from `.join()` by inference.
// TypeScript skips that inference without noImplicitAny, so a join condition
// must still compile there, untyped like other callbacks in that mode.
// Strict mode must keep it typed. Type tests run in strict mode only, so this
// compiles one fixture in both modes.
const fixture = fileURLToPath(
  new URL(`./fixtures/loose-typescript-joins.ts`, import.meta.url),
)
const config = ts.getParsedCommandLineOfConfigFile(
  fileURLToPath(new URL(`../tsconfig.json`, import.meta.url)),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)!

function errors(noImplicitAny: boolean) {
  const program = ts.createProgram([fixture], {
    ...config.options,
    noImplicitAny,
    noEmit: true,
  })
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fixture))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ` `))
}

describe(`join conditions across TypeScript modes`, () => {
  it.each([true, false])(`compile with noImplicitAny %s`, (noImplicitAny) => {
    expect(errors(noImplicitAny)).toEqual([])
  })
})
