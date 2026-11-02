// @vitest-environment node
/**
 * Supported React server renders must not report a client-only layout effect.
 * Authority: react-db supports React >=18 and prepared SSR (SSR guide and
 * #2229); React18's diagnostic means a layout effect cannot run on that host.
 * Moving a page is a client commit operation and must add no such server work.
 *
 * This extends the SSR admission owner's preparation grammar and judgment with
 * raw server diagnostics through real React18 and installed React19 renderers.
 * Provider and explicit-client ordinary/Suspense paths cross the client boundary;
 * standalone builders and supplied Collections check the diagnostic law alone.
 * The child bundle aliases every React import to one runtime, including the
 * renderer's imports. It uses current production source, without browser globals.
 * It does not establish hydration equality or client commit timing: those remain
 * with the admission and window-render receiving owners. The server projection
 * drops browser/write actions because this observation precedes those actions.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { fc } from '@fast-check/vitest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from '../../db/tests/oracle-failure-fidelity'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const root = resolve(here, `../../..`)
let temporary: string
const programs = new Map<string, string>()
const runtimes = [
  { name: `react18`, react: `react18`, dom: `react-dom18`, version: `18.3.1` },
  { name: `current`, react: `react`, dom: `react-dom`, version: `19.2.4` },
] as const

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), `react-db-ssr-effects-`))
  for (const runtime of runtimes) {
    const outfile = join(temporary, `${runtime.name}.cjs`)
    await build({
      entryPoints: [join(here, `ssr-effects-driver.tsx`)],
      outfile,
      bundle: true,
      platform: `node`,
      format: `cjs`,
      alias: {
        react: dirname(require.resolve(`${runtime.react}/package.json`)),
        'react-dom': dirname(require.resolve(`${runtime.dom}/package.json`)),
        '@tanstack/db': join(root, `packages/db/src/index.ts`),
        '@tanstack/db-ivm': join(root, `packages/db-ivm/src/index.ts`),
      },
      define: { 'process.env.NODE_ENV': `"development"` },
      logLevel: `silent`,
    })
    programs.set(runtime.name, outfile)
  }
})
afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

// Project the shared grammar onto the server-render cut. Later writes and
// browser actions cannot affect this cut. Source/preparation/row boundaries
// retain the shared admission judgment and its exclusions.
const serverHistory = ({
  preparation,
  sourceState,
  rows,
}: SsrSnapshotHistory) => ({ preparation, sourceState, rows })
const histories = ssrSnapshotHistoryArbitrary.map(serverHistory)
const examples = ssrSnapshotExamples.map(serverHistory)
type Observation = {
  reactVersion: string
  rendererVersion: string
  calls: number
  view?: { rows: unknown; status?: string }
  failure?: string
  diagnostics: Array<string>
  cleanupFailures: Array<string>
}
const paths = [
  `ordinary-provider`,
  `ordinary-explicit`,
  `suspense-provider`,
  `suspense-explicit`,
  `standalone`,
  `supplied`,
] as const
const isLayoutDiagnostic = (message: string) =>
  /useLayoutEffect does nothing on the server/i.test(message)

// Preparation independently decides ordinary admission and rows/status.
// Completed-query Suspense shares the ready judgment. Standalone builders and
// supplied Collections check only return/diagnostics, without a transport claim.
// Keeping raw messages permits unrelated diagnostics and exposes exact warnings.
function checkRender(
  history: SsrSnapshotHistory,
  actual: Observation,
  path: string,
) {
  const expected = expectedSsrSnapshot(history)
  try {
    atOracleCheckpoint(`SSR path reached`, path, () => {
      expect(
        actual.calls,
        `real server renderer invoked the hook`,
      ).toBeGreaterThan(0)
    })
    const descriptor = path.includes(`provider`) || path.includes(`explicit`)
    atOracleCheckpoint(`SSR preparation admission`, path, () => {
      if (descriptor && expected.rejects) {
        expect(actual.failure, `untransported server view rejects`).toMatch(
          /SSR.*(?:preload|hydrat)/i,
        )
      } else {
        expect(actual.failure, `legal SSR render`).toBeUndefined()
        expect(actual.view, `hook returned its public view`).toBeDefined()
        if (path.startsWith(`suspense`))
          expect(actual.view?.rows, `prepared Suspense rows`).toEqual(
            expected.rows,
          )
        else if (descriptor)
          expect(actual.view, `server public view`).toEqual({
            rows: expected.rows,
            status: expected.status,
          })
      }
    })
    if (!descriptor || !expected.rejects)
      atOracleCheckpoint(`SSR client-layout diagnostic`, path, () => {
        expect(
          actual.diagnostics.filter(isLayoutDiagnostic),
          `legal SSR emits no client-layout diagnostic: ${JSON.stringify(actual.diagnostics)}`,
        ).toEqual([])
      })
  } catch (error) {
    if (actual.cleanupFailures.length)
      throw new AggregateError(
        [error, ...actual.cleanupFailures.map((failure) => new Error(failure))],
        `SSR comparison and cleanup failed`,
        { cause: error },
      )
    throw error
  }
  atOracleCheckpoint(`SSR cleanup`, path, () => {
    expect(actual.cleanupFailures, `server cleanup diagnostics`).toEqual([])
  })
}

declareOracle({ check: [checkRender], grammar: [histories] })
for (const runtime of runtimes) {
  for (const path of paths) {
    const project = (history: SsrSnapshotHistory): SsrSnapshotHistory =>
      path.startsWith(`suspense`)
        ? { ...history, preparation: `query`, sourceState: `ready` }
        : path === `standalone` || path === `supplied`
          ? { ...history, preparation: `none`, sourceState: `ready` }
          : history
    // Disabled has one legal input. Its bounded replay shares the checker and
    // driver; other paths generate only the axes that can affect their render.
    const grammar = histories.map(project)
    const inputs = examples.map((history) => [project(history)])
    const property = `react.ssr-effects-${runtime.name}-${path}`
    for (const campaign of [`fixed`, `random`] as const) {
      const register =
        campaign === `fixed`
          ? oracleReplayTest(it)
          : oracleReplayTest(it, property)
      register(
        `${runtime.name} ${path} renders without client layout diagnostics (${campaign})`,
        async () => {
          const states = path.startsWith(`ordinary`)
            ? [
                `rendered`,
                `cold`,
                `prepared-ready`,
                `prepared-loading`,
                `rejected`,
              ]
            : [`rendered`]
          const reach = createOracleReach(
            `ssr-effects-${runtime.name}-${path}`,
            states,
            { fixedHistories: inputs.length },
          )
          const fidelity = createOracleFailureFidelity<SsrSnapshotHistory>()
          let index = 0
          try {
            await fidelity.assert(() =>
              fc.assert(
                fc.asyncProperty(grammar, (history) =>
                  fidelity.run(history, () => {
                    reach.beginHistory({ fixed: index++ < inputs.length })
                    const actual: Observation = JSON.parse(
                      execFileSync(
                        process.execPath,
                        [
                          programs.get(runtime.name)!,
                          JSON.stringify({ history, path }),
                        ],
                        { encoding: `utf8`, timeout: 10000 },
                      ),
                    )
                    atOracleCheckpoint(`matched SSR runtime`, path, () => {
                      expect(actual.reactVersion).toBe(runtime.version)
                      expect(actual.rendererVersion).toBe(runtime.version)
                      expect(actual.calls).toBeGreaterThan(0)
                    })
                    reach.reach(`rendered`)
                    if (path.startsWith(`ordinary`)) {
                      const expected = expectedSsrSnapshot(history)
                      const state = expected.rejects
                        ? `rejected`
                        : history.sourceState === `idle`
                          ? `cold`
                          : expected.status === `ready`
                            ? `prepared-ready`
                            : history.preparation === `source`
                              ? `prepared-loading`
                              : undefined
                      if (state) reach.reach(state)
                    }
                    checkRender(history, actual, path)
                  }),
                ),
                campaign === `fixed`
                  ? {
                      numRuns: oracleRuns(24) + inputs.length,
                      seed: 2291,
                      examples: inputs,
                    }
                  : oraclePropertyOptions(24, property, { examples: inputs }),
              ),
            )
            reach.assertReached()
          } finally {
            console.info(
              `ssr-effects ${runtime.name} ${path} ${campaign}`,
              Object.fromEntries(reach.counts()),
            )
          }
        },
        30000,
      )
    }
  }
}

// Disabled SSR has one input. Replay it through the same diagnostic judgment,
// without presenting repeated constant inputs as a generated history campaign.
for (const runtime of runtimes) {
  oracleReplayTest(it)(`${runtime.name} disabled SSR diagnostic replay`, () => {
    const history: SsrSnapshotHistory = {
      preparation: `none`,
      sourceState: `idle`,
      rows: [],
    }
    const actual: Observation = JSON.parse(
      execFileSync(
        process.execPath,
        [
          programs.get(runtime.name)!,
          JSON.stringify({ history, path: `disabled` }),
        ],
        { encoding: `utf8`, timeout: 10000 },
      ),
    )
    expect(actual.reactVersion).toBe(runtime.version)
    expect(actual.rendererVersion).toBe(runtime.version)
    checkRender(history, actual, `disabled`)
  })
}

oracleReplayTest(it)(
  `distinguishes a client-layout diagnostic from unrelated messages`,
  () => {
    const history: SsrSnapshotHistory = {
      preparation: `none`,
      sourceState: `idle`,
      rows: [],
    }
    const expected = expectedSsrSnapshot(history)
    const actual: Observation = {
      reactVersion: `calibration`,
      rendererVersion: `calibration`,
      calls: 1,
      view: { rows: expected.rows, status: expected.status },
      diagnostics: [`unrelated diagnostic`],
      cleanupFailures: [],
    }
    expect(() =>
      checkRender(history, actual, `ordinary-provider`),
    ).not.toThrow()
    expect(() =>
      checkRender(
        history,
        {
          ...actual,
          diagnostics: [
            `Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded.`,
          ],
        },
        `ordinary-provider`,
      ),
    ).toThrow(/SSR client-layout diagnostic/)
  },
)
