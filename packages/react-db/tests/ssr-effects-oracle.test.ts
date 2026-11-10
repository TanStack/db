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
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  expectedSsrSnapshot,
  ssrSnapshotExamples,
  ssrSnapshotHistoryArbitrary,
} from '../../db/tests/ssr-snapshot-admission-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  OracleCheckpointFailure,
  differs,
  oracleProperty,
  oracleReplayTest,
  oracleRoute,
  pass,
  violation,
} from '../../db/tests/oracle-config'
import { atOracleCheckpoint } from '../../db/tests/oracle-failure-fidelity'
import type {
  Observation as OracleObservation,
  Verdict,
} from '../../db/tests/oracle-config'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const root = resolve(here, `../../..`)
let temporary: string
const programs = new Map<string, string>()
const runtimes = [
  { name: `react18`, react: `react18`, dom: `react-dom18`, version: `18.3.1` },
  { name: `current`, react: `react`, dom: `react-dom`, version: `19.3.1` },
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
const histories = ssrSnapshotHistoryArbitrary.map(serverHistory, (value) => ({
  ...(value as ReturnType<typeof serverHistory>),
  serverWrite: false,
  browserWrite: false,
  browserPreload: false,
}))
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
  expected = expectedSsrSnapshot(history),
) {
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

declareOracle({
  owns: [
    `src/DbProvider.tsx#DbProvider`,
    `src/useLiveQuery.ts#useLiveQuery`,
    `src/useLiveSuspenseQuery.ts#useLiveSuspenseQuery`,
  ],
  check: [checkRender],
  grammar: [histories],
})
// The child process records native server facts. The same admission/diagnostic
// judgment runs afterward, with runtime identity checked first as before.
function checkEffects(
  history: SsrSnapshotHistory,
  trace: ReadonlyArray<OracleObservation>,
  expected: ReturnType<typeof expectedSsrSnapshot>,
  path: string,
  version: string,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (checkpoint !== `server result`) continue
    const actual = value as Observation
    for (const [field, target] of [
      [`reactVersion`, version],
      [`rendererVersion`, version],
    ] as const) {
      const wrong = differs(
        `matched SSR runtime`,
        `matched SSR runtime`,
        actual[field],
        target,
      )
      if (wrong) return wrong
    }
    try {
      checkRender(history, actual, path, expected)
    } catch (error) {
      if (!(error instanceof OracleCheckpointFailure)) throw error
      return violation(error.checkpoint, String(error.cause), error.law)
    }
  }
  if (
    trace.filter(({ checkpoint }) => checkpoint === `server result`).length !==
    1
  )
    return violation(
      `server result`,
      `expected one native server result`,
      `SSR path reached`,
    )
  return pass
}

function recordServerRender(
  runtime: (typeof runtimes)[number],
  path: string,
  history: SsrSnapshotHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const actual: Observation = JSON.parse(
    execFileSync(
      process.execPath,
      [programs.get(runtime.name)!, JSON.stringify({ history, path })],
      { encoding: `utf8`, timeout: 10000 },
    ),
  )
  observe(`server result`, actual)
  if (actual.calls > 0) {
    observe(`reach`, `rendered`)
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
      if (state) observe(`reach`, state)
    }
  }
}

for (const runtime of runtimes) {
  for (const path of paths) {
    const project = (history: SsrSnapshotHistory): SsrSnapshotHistory =>
      path.startsWith(`suspense`)
        ? { ...history, preparation: `query`, sourceState: `ready` }
        : path === `standalone` || path === `supplied`
          ? { ...history, preparation: `none`, sourceState: `ready` }
          : history
    const grammar = histories.map(project, (value) => {
      const history = value as SsrSnapshotHistory
      const projected = project(history)
      if (
        projected.preparation !== history.preparation ||
        projected.sourceState !== history.sourceState
      )
        throw new Error(`SSR history is outside this receiving path`)
      return serverHistory(history)
    })
    const states = path.startsWith(`ordinary`)
      ? [`rendered`, `cold`, `prepared-ready`, `prepared-loading`, `rejected`]
      : [`rendered`]
    oracleProperty({
      id: `react.ssr-effects-${runtime.name}-${path}`,
      law: {
        statement: `Supported React server renders preserve prepared SSR admission and emit no client-only layout-effect diagnostic.`,
        authority: `docs/guides/ssr.md prepared SSR promises; React >=18 support and #2229; shared ssr-snapshot-admission-oracle.ts judgment.`,
        owner: `packages/db/tests/ssr-snapshot-admission-oracle.ts`,
        limits: `Real React18 and installed React server renderers, provider/explicit-client ordinary/Suspense paths and standalone/supplied diagnostic paths; no hydration equality or client commit timing.`,
      },
      histories: {
        arbitrary: grammar,
        runs: 24,
        fixedSeeds: [2291],
        states,
        constructed: [
          {
            name: `native server renderer`,
            enters: [`rendered`],
            build: (history) => ({ ...history }),
          },
          ...(path.startsWith(`ordinary`)
            ? [
                {
                  name: `cold server`,
                  enters: [`cold`],
                  build: (history: SsrSnapshotHistory): SsrSnapshotHistory => ({
                    ...history,
                    preparation: `none`,
                    sourceState: `idle`,
                    rows: [],
                  }),
                },
                {
                  name: `prepared ready`,
                  enters: [`prepared-ready`],
                  build: (history: SsrSnapshotHistory): SsrSnapshotHistory => ({
                    ...history,
                    preparation: `source`,
                    sourceState: `ready`,
                  }),
                },
                {
                  name: `prepared loading`,
                  enters: [`prepared-loading`],
                  build: (history: SsrSnapshotHistory): SsrSnapshotHistory => ({
                    ...history,
                    preparation: `source`,
                    sourceState: `loading`,
                  }),
                },
                {
                  name: `rejected server`,
                  enters: [`rejected`],
                  build: (history: SsrSnapshotHistory): SsrSnapshotHistory => ({
                    ...history,
                    preparation: `none`,
                    sourceState: `ready`,
                  }),
                },
              ]
            : []),
        ],
        fixed: examples.map((history, index) => ({
          name: `server preparation ${index}`,
          history: project(history),
        })),
      },
      model: expectedSsrSnapshot,
      driver: (history, observe) =>
        recordServerRender(runtime, path, history, observe),
      check: (history, trace, expected) =>
        checkEffects(history, trace, expected, path, runtime.version),
      timeout: 30000,
    })
  }
  // Disabled SSR retains the old single input and shared diagnostic judgment.
  oracleProperty({
    id:
      runtime.name === `react18`
        ? `react.ssr-effects-react18-disabled`
        : `react.ssr-effects-current-disabled`,
    law: {
      statement: `A disabled server hook returns without a client-only layout-effect diagnostic.`,
      authority: `React >=18 support and prepared SSR guide; the same SSR diagnostic judgment.`,
      owner: `packages/db/tests/ssr-snapshot-admission-oracle.ts`,
      limits: `The unchanged disabled SSR history in React18 and the installed React runtime.`,
    },
    histories: [
      {
        preparation: `none`,
        sourceState: `idle`,
        rows: [],
      } satisfies SsrSnapshotHistory,
    ],
    model: expectedSsrSnapshot,
    driver: (history, observe) =>
      recordServerRender(runtime, `disabled`, history, observe),
    check: (history, trace, expected) =>
      checkEffects(history, trace, expected, `disabled`, runtime.version),
  })
}

oracleReplayTest(it)(
  `distinguishes a client-layout diagnostic from unrelated messages`,
  () => {
    oracleRoute(`calibration`)
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
