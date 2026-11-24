// @vitest-environment node
/**
 * A projected resume read returns the requested storage rows, with their
 * metadata, and keeps every collection-wide certification fact unchanged.
 * Worker SQL receives the Node owner's independent judgment. This receiver
 * covers typed selectors; the Node owner also crosses claim expiry and caps.
 */
import fc from 'fast-check'
import { afterAll, beforeAll } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { checkResumeRowProjection } from '../../db-sqlite-persistence-core/tests/resume-row-projection-oracle'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from '../tests/adapter-chromium-host'
import type {
  ResumeRowProjectionInput,
  ResumeRowProjectionSnapshot,
} from '../../db-sqlite-persistence-core/tests/resume-row-projection-oracle'

const requests = [
  { name: `all`, includeRows: true },
  { name: `empty`, includeRows: true, rowKeys: [] },
  { name: `missing`, includeRows: true, rowKeys: [`absent`] },
  { name: `numeric`, includeRows: true, rowKeys: [1] },
  { name: `string`, includeRows: true, rowKeys: [`1`] },
  { name: `positive-zero`, includeRows: true, rowKeys: [0] },
  { name: `negative-zero`, includeRows: true, rowKeys: [-0] },
  { name: `both-zeros`, includeRows: true, rowKeys: [0, -0] },
  { name: `duplicates`, includeRows: true, rowKeys: [1, `1`, 1, -0, -0] },
  { name: `own-storage-key`, includeRows: true, rowKeys: [`stored-key`] },
  { name: `position-only`, includeRows: false, rowKeys: [1, `1`] },
]
const states = requests.map(({ name }) => name)
// Every history crosses every selector against one unchanged database. Values
// vary independently of storage keys; metadata includes absence, null and data.
type ProjectionHistory = {
  coordinate: number
  storedRows: Array<ResumeRowProjectionSnapshot[`rows`][number]>
}
const histories: fc.Arbitrary<ProjectionHistory> = fc.nat({ max: 100_000 }).map(
  (coordinate) => ({
    coordinate,
    storedRows: [1, `1`, 0, -0, `stored-key`].map((key, index) => ({
      key,
      value: {
        id: `value-${coordinate}-${index}`,
        title: `value ${coordinate + index}`,
      },
      ...(index % 3 === 0
        ? { metadata: null }
        : index % 3 === 1
          ? { metadata: { authored: coordinate + index } }
          : {}),
    })),
  }),
  (history) => (history as ProjectionHistory).coordinate,
)
type Result = {
  full: ResumeRowProjectionSnapshot
  snapshots: Array<{
    name: string
    projected: ResumeRowProjectionSnapshot
    materializedRows: number
  }>
  cleanupErrors: ReadonlyArray<string>
  browserErrors?: ReadonlyArray<string>
  executionError?: string
}
let browser: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  browser = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/persisted-source-fifo.opfs.html`,
    ready: `runResumeRowProjections`,
  })
}, 120_000)
afterAll(async () => {
  await browser?.close()
}, 120_000)

async function receive(
  h: ProjectionHistory,
  fault?: `full-row-then-read-error`,
) {
  const host = browser
  if (!host) throw new Error(`Resume projection Chromium host did not start`)
  return captureBrowserHistory(host, () =>
    host.page.evaluate(
      ({ storedRows, requests: selections, fault: injected }) =>
        (
          window as unknown as {
            runResumeRowProjections: (
              rows: ResumeRowProjectionInput[`storedRows`],
              selections: typeof requests,
              fault?: `full-row-then-read-error`,
            ) => Promise<Result>
          }
        ).runResumeRowProjections(storedRows, selections, injected),
      { storedRows: h.storedRows, requests, fault },
    ),
  )
}

oracleProperty({
  id: `sqlite-resume.row-projection.chromium-opfs`,
  owns: [`../db-sqlite-persistence-core/src/sqlite-core-adapter.ts`],
  law: {
    statement: `SQLite row-key projection retains exactly the requested authored rows and collection-wide atomic resume facts.`,
    authority: `Atomic resume-snapshot contract and the specified rowKeys materialization option; shared resume-row-projection-oracle.ts.`,
    limits: `Actual worker/OPFS, five typed storage keys with JSON values/metadata and eleven selectors. The Node owner also judges claim expiry and binding caps.`,
  },
  histories: {
    arbitrary: histories,
    runs: 4,
    fixedSeeds: [20261124],
    states,
    constructed: Array.from({ length: 5 }, (_, index) => ({
      name: `every selector ${index + 1}`,
      enters: states,
      build: (h: ProjectionHistory) => ({ ...h }),
    })),
  },
  model: (h) => h,
  driver: async (h, observe) => {
    const result = await receive(h)
    observe(`result`, result)
    for (const { name } of result.snapshots) observe(`reach`, name)
  },
  check: (_h, trace, h) => {
    const result = trace.find((item) => item.checkpoint === `result`)?.value as
      Result | undefined
    if (!result)
      return violation(
        `requested storage rows`,
        `Missing projection results`,
        `SQLite resume row projection`,
      )
    const diagnostics = [
      result.executionError,
      ...result.cleanupErrors,
      ...(result.browserErrors ?? []),
    ]
      .filter(Boolean)
      .join(`; `)
    const fullVerdict = checkResumeRowProjection(
      { storedRows: h.storedRows, includeRows: true },
      result.full,
    )
    if (fullVerdict.kind !== `pass`)
      return {
        ...fullVerdict,
        difference: `completed full snapshot: ${fullVerdict.difference}${diagnostics ? `; secondary: ${diagnostics}` : ``}`,
      }
    for (const [index, actual] of result.snapshots.entries()) {
      const request = requests[index]
      if (!request)
        return violation(
          `requested storage rows`,
          `Unexpected extra projection result`,
          `SQLite resume row projection`,
        )
      if (actual.name !== request.name)
        return violation(
          `requested storage rows`,
          `Projection order/identity differs`,
          `SQLite resume row projection`,
        )
      const verdict = checkResumeRowProjection(
        { storedRows: h.storedRows, ...request },
        actual.projected,
        result.full,
        actual.materializedRows,
      )
      if (verdict.kind !== `pass`)
        return {
          ...verdict,
          difference: `${verdict.difference}${diagnostics ? `; secondary: ${diagnostics}` : ``}`,
        }
    }
    if (result.executionError || result.snapshots.length !== requests.length)
      return violation(
        `projection execution`,
        diagnostics || `Missing projection results`,
        `SQLite resume row projection`,
      )
    if (result.cleanupErrors.length || result.browserErrors?.length)
      return violation(
        `projection cleanup`,
        [...result.cleanupErrors, ...(result.browserErrors ?? [])].join(`; `),
        `SQLite resume row projection`,
      )
    for (const state of states)
      if (
        !trace.some(
          (item) => item.checkpoint === `reach` && item.value === state,
        )
      )
        return violation(
          `projection reach`,
          `Missing ${state}`,
          `projection reach`,
        )
    return pass
  },
  calibrations: [
    {
      name: `rejects reading all rows before filtering`,
      history: { constructed: `every selector 1` },
      law: `SQLite resume row projection`,
      corrupt: (trace) =>
        trace.map((item) => {
          if (item.checkpoint !== `result`) return item
          const result = item.value as Result
          return {
            ...item,
            value: {
              ...result,
              snapshots: result.snapshots.map((entry) =>
                entry.name === `numeric`
                  ? { ...entry, materializedRows: result.full.rows.length }
                  : entry,
              ),
            },
          }
        }),
    },
    {
      name: `preserves completed rows before a later read fails`,
      history: { constructed: `every selector 1` },
      law: `SQLite resume row projection`,
      difference:
        /(?=[\s\S]*completed full snapshot)(?=[\s\S]*calibrated later projection read failure)/,
      driver: async (h, observe) => {
        observe(`result`, await receive(h, `full-row-then-read-error`))
      },
    },
    ...Array.from({ length: 5 }, (_, index) =>
      states.map((state) => ({
        name: `builder ${index + 1} cannot omit ${state}`,
        history: { constructed: `every selector ${index + 1}` },
        law: `projection reach`,
        corrupt: (
          trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
        ) =>
          trace.filter(
            (item) => item.checkpoint !== `reach` || item.value !== state,
          ),
      })),
    ).flat(),
    {
      name: `rejects rows outside an empty selection`,
      history: { constructed: `every selector 1` },
      law: `SQLite resume row projection`,
      corrupt: (trace) =>
        trace.map((item) => {
          if (item.checkpoint !== `result`) return item
          const result = item.value as Result
          return {
            ...item,
            value: {
              ...result,
              snapshots: result.snapshots.map((entry) =>
                entry.name === `empty`
                  ? { ...entry, projected: result.full }
                  : entry,
              ),
            },
          }
        }),
    },
  ],
})
