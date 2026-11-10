import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { URL as NodeURL } from 'node:url'
import { expect, it } from 'vitest'
import { observeRootSetup } from '../../packages/query-db-collection/tests/queued-answer-root-setup-probe.js'
import type { EvaluatedModules } from 'vite/module-runner'

/**
 * This unit calibration records actual primitives and actual evaluated fixture
 * code in the same client/jsdom transform as the failed outer test. It never
 * imports the supervisor, a receiving driver, production, Query, or histories.
 */
it(`separates client URL normalization from module and global URL semantics`, () => {
  const directory = process.env.H02_ROOT_SETUP_CALIBRATION_DIR
  const freezePath = process.env.H02_PROGRESS_SOURCE_FREEZE
  if (!directory || !freezePath)
    throw new Error(`setup calibration paths required`)
  const freeze: { worktree: string } = JSON.parse(
    readFileSync(freezePath, `utf8`),
  )
  const observations = observeRootSetup()
  const state: unknown = Reflect.get(globalThis, `__vitest_worker__`)
  if (
    typeof state !== `object` ||
    state === null ||
    !(`evaluatedModules` in state)
  )
    throw new Error(`actual evaluated-module registry missing`)
  const modules = state.evaluatedModules as EvaluatedModules
  const file = resolve(
    freeze.worktree,
    `packages/query-db-collection/tests/queued-answer-root-setup-probe.ts`,
  )
  const module = [...modules.idToModuleMap.values()].find(
    (entry) => entry.file === file,
  )
  const code =
    module?.meta && `code` in module.meta ? module.meta.code : undefined
  if (!module || !code) throw new Error(`actual evaluated fixture code missing`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, `fixture-evaluated-code.txt`), code)
  writeFileSync(
    resolve(directory, `observations.json`),
    JSON.stringify(
      {
        ...observations,
        fixture: {
          id: module.id,
          file: module.file,
          url: module.url,
          evaluated: module.evaluated,
          originalSha256: createHash(`sha256`)
            .update(readFileSync(file))
            .digest(`hex`),
          codeSha256: createHash(`sha256`).update(code).digest(`hex`),
        },
        scope: `pure setup fixture; no receiving or product evidence`,
      },
      null,
      2,
    ),
  )
  expect(module.evaluated).toBe(true)
  expect(new NodeURL(observations.moduleUrl).protocol).toBe(`file:`)
  expect(code).toContain(`self.location`)
  expect(new NodeURL(observations.literal).protocol).toBe(
    new NodeURL(observations.locationHref).protocol,
  )
  expect(new NodeURL(observations.indirectGlobal).protocol).toBe(`file:`)
  expect(new NodeURL(observations.nodeLiteral).protocol).toBe(`file:`)
  expect(new NodeURL(observations.nodeIndirect).protocol).toBe(`file:`)
  expect(observations.indirectGlobal).toBe(observations.nodeIndirect)
  expect(observations.resolvedRoot).toBe(freeze.worktree)
})
