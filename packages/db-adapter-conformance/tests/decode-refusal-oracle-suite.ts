/** Campaigns share the decoder admission judgment across receiving hosts. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { observeDecodeRefusal } from './decode-refusal-driver'
import {
  decodeHistoryArb,
  decodeModel,
  decodeStates,
  decodeViolations,
} from './decode-refusal-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type { DecodeAdapter } from './decode-refusal-driver'
import type {
  DecodeHistory,
  DecodeObservation,
  DecodeState,
  DecodeThrowCause,
} from './decode-refusal-oracle'

export type DecodeReceiver = (
  history: DecodeHistory,
  id: string,
) => Promise<DecodeObservation>

export function registerDecodeRefusal(
  property: string,
  adapter: DecodeAdapter | DecodeReceiver,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const receive: DecodeReceiver =
    typeof adapter === `function`
      ? adapter
      : (h, id) => observeDecodeRefusal(adapter, h, id)
  const required = new WeakMap<DecodeHistory, DecodeState>()
  // Fresh generated identities retain the obligation even in the pinned
  // framework's generated builder path, whose enters association is absent.
  const constructed = decodeStates
    .map((stateName) => ({
      name: `generated ${stateName}`,
      enters: [stateName],
      build: (h: DecodeHistory) => {
        const [mode, state] = stateName.split(`:`) as [
          DecodeHistory['mode'],
          string,
        ]
        const built: DecodeHistory = {
          ...h,
          mode,
          startup: `cold`,
          throwCause: `error`,
          retireDemand: false,
        }
        const causeCell = /^(cold|cached)-(initial|live)-(.+)$/.exec(state)
        const positioned =
          /^(initial|live)-(throw|changed-id)-(first|middle|last)$/.exec(state)
        if (causeCell) {
          built.startup = causeCell[1] as DecodeHistory['startup']
          built.phase = causeCell[2] as DecodeHistory['phase']
          const outcome = causeCell[3]!
          built.outcome = outcome.startsWith(`throw-`)
            ? `throw`
            : (outcome as DecodeHistory['outcome'])
          built.throwCause = outcome.startsWith(`throw-`)
            ? (outcome.slice(6) as DecodeThrowCause)
            : `error`
        } else if (state === `retired-demand-with-active-successor`) {
          built.retireDemand = true
          built.phase = `initial`
          built.outcome = `valid`
        } else if (positioned) {
          built.phase = positioned[1] as DecodeHistory['phase']
          built.outcome = positioned[2] as DecodeHistory['outcome']
          built.count = Math.max(3, h.count)
          built.refusalIndex =
            positioned[3] === `first`
              ? 0
              : positioned[3] === `last`
                ? built.count - 1
                : 1
        } else if (
          state.startsWith(`initial-`) ||
          (state.startsWith(`live-`) &&
            state !== `live-overlap` &&
            state !== `live-fresh`)
        ) {
          const [phase, ...outcome] = state.split(`-`)
          built.phase = phase as DecodeHistory['phase']
          built.outcome = outcome.join(`-`) as DecodeHistory['outcome']
        } else if (state.startsWith(`refusal-`)) {
          built.outcome = h.outcome === `valid` ? `throw` : h.outcome
          built.count = Math.max(3, h.count)
          built.refusalIndex =
            state === `refusal-first`
              ? 0
              : state === `refusal-last`
                ? built.count - 1
                : 1
        } else if (state !== `source-ready-query-pending`) {
          built.phase = `live`
          built.overlap = state === `live-overlap`
        }
        required.set(built, stateName)
        return built
      },
    }))
    .flatMap((builder) =>
      builder.enters.includes(`on-demand:retired-demand-with-active-successor`)
        ? [
            builder,
            ...Array.from({ length: 4 }, (_, index) => ({
              ...builder,
              name: `${builder.name} construction ${index + 2}`,
            })),
          ]
        : [builder],
    )
  const driver = async (
    h: DecodeHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) => {
    const raw = await receive(h, `${property}-${sequence++}`)
    for (const state of raw.reached) observe(`reach`, state)
    observe(`delivery`, raw)
  }
  const check = (h: DecodeHistory, trace: ReadonlyArray<Observation>) => {
    const record = trace.find((entry) => entry.checkpoint === `delivery`)
    if (!record)
      return violation(`delivery`, `missing observation`, `decode admission`)
    const failures = decodeViolations(h, record.value as DecodeObservation)
    if (failures.length)
      return violation(`delivery`, failures.join(`; `), `decode admission`, {
        actual: { history: h, observation: record.value },
        expected: decodeModel(h),
      })
    const state = required.get(h)
    if (
      state &&
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(`reach`, `missing ${state}`, `constructed builder reach`)
    return pass
  }
  const corrupt =
    (
      mutate: (
        h: DecodeHistory,
        raw: DecodeObservation,
      ) => DecodeObservation | undefined,
    ) =>
    (trace: ReadonlyArray<Observation>, h: DecodeHistory) => {
      const raw = trace.find((entry) => entry.checkpoint === `delivery`)
        ?.value as DecodeObservation | undefined
      const changed = raw && mutate(h, raw)
      return changed
        ? trace.map((entry) =>
            entry.checkpoint === `delivery`
              ? { ...entry, value: changed }
              : entry,
          )
        : undefined
    }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A decoder preserves authored Date/boolean values and row ids, refuses an invalid batch without partial publication, distinguishes source readiness from initial-query readiness, fails the applicable load or ready sync health for every thrown JavaScript value, admits a valid cached startup without inventing a configuration failure, and releases each core-released acquisition or stopped run resource once, with no premature release.`,
      authority: `Receiving adapter parse contract; glossary loading error, sync error, publication, cleanup and acquisition release; collection-subscription-lifecycle-grammar-oracle.ts ownership contract; eager FID-1 for successful values.`,
      limits: `One table/stream, 1–4 rows, initial plus one live delivery, generated boolean and Date fields, thrown parse and changed-id refusal. Cold initial/live checkpoints and idle cached initial SDK callbacks; arbitrary thrown values require terminal health without prescribing their diagnostic message or wrapping. Eager and one judged on-demand query, optionally preceded by a pending public query that retires before source input; no arbitrary schema, remote service, persistence, reload or mutation claim.`,
    },
    histories: {
      arbitrary: decodeHistoryArb,
      states: decodeStates,
      constructed,
      runs: 80,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `refusal after a valid prefix keeps the live snapshot`,
          history: {
            mode: `eager`,
            phase: `live`,
            outcome: `throw`,
            count: 3,
            refusalIndex: 1,
            overlap: true,
            coordinate: 7,
            epoch: 1000,
            flag: false,
          },
        },
      ],
    },
    model: decodeModel,
    driver,
    check,
    calibrations: [
      {
        name: `wrong rows inside ready notification`,
        history: { constructed: `generated eager:initial-valid` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({ ...raw, readySnapshots: [[]] })),
      },
      {
        name: `wrong decoded value`,
        history: { constructed: `generated eager:initial-valid` },
        law: `decode admission`,
        corrupt: corrupt((h, raw) =>
          h.outcome === `valid`
            ? {
                ...raw,
                rows: raw.rows.map((row, index) =>
                  index ? row : { ...row, whenType: `string` },
                ),
              }
            : undefined,
        ),
      },
      {
        name: `partial refused publication`,
        history: { constructed: `generated eager:live-throw-middle` },
        law: `decode admission`,
        corrupt: corrupt((h, raw) =>
          h.outcome !== `valid`
            ? { ...raw, publications: [[...raw.rows]] }
            : undefined,
        ),
      },
      {
        name: `missing terminal health`,
        history: { constructed: `generated eager:initial-throw` },
        law: `decode admission`,
        corrupt: corrupt((h, raw) =>
          h.outcome !== `valid` ? { ...raw, error: null } : undefined,
        ),
      },
      {
        name: `leaked stopped resource`,
        history: { constructed: `generated eager:live-changed-id` },
        law: `decode admission`,
        corrupt: corrupt((h, raw) =>
          h.outcome !== `valid`
            ? {
                ...raw,
                resources: [
                  ...raw.resources,
                  { kind: `calibrated-leak`, releases: 0 },
                ],
              }
            : undefined,
        ),
      },
      {
        name: `missing receiving resource witness`,
        history: { constructed: `generated eager:initial-valid` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          requiredResourceKinds: [
            ...raw.requiredResourceKinds,
            `missing-test-resource`,
          ],
        })),
      },
      ...(
        [
          [`missed released acquisition`, `missed`],
          [`early release remains invalid after later core release`, `early`],
          [`duplicate released acquisition`, `double`],
          [`active successor cannot release early`, `active`],
        ] as const
      ).map(([name, fault]) => ({
        name,
        history: {
          constructed: `generated on-demand:retired-demand-with-active-successor`,
        },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => {
          const target = raw.resources.find(
            (resource) =>
              resource.kind === `stream-lease` &&
              !!resource.coreReleased === (fault !== `active`),
          )
          if (!target) return undefined
          return {
            ...raw,
            resources: raw.resources.map((resource) =>
              resource === target
                ? {
                    ...resource,
                    releases:
                      fault === `missed` ? 0 : fault === `double` ? 2 : 1,
                    prematureReleases:
                      fault === `early` || fault === `active` ? 1 : 0,
                  }
                : resource,
            ),
          }
        }),
      })),
      {
        name: `arbitrary thrown cause still requires terminal source health`,
        history: {
          constructed: `generated eager:cold-initial-throw-null-prototype`,
        },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({ ...raw, errorPresent: false })),
      },
      {
        name: `arbitrary thrown cause still reaches query source health`,
        history: {
          constructed: `generated on-demand:cold-initial-throw-throwing-prototype`,
        },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.query
            ? {
                ...raw,
                query: { ...raw.query, sourceErrorPresent: false },
              }
            : undefined,
        ),
      },
      {
        name: `cached refusal does not invent invalid sync configuration`,
        history: {
          constructed: `generated on-demand:cached-initial-throw-error`,
        },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          admissionErrors: [
            ...raw.admissionErrors,
            {
              entry: `source subscription`,
              name: `CollectionConfigurationError`,
              message: `sync function did not return a loadSubset handler`,
            },
          ],
        })),
      },
      {
        name: `readiness after refusal cannot choose a previously ready source`,
        history: {
          constructed: `generated on-demand:cached-initial-throw-error`,
        },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({
          ...raw,
          boundaryEvents: [`parser refusal`, `source ready`],
          status: `ready`,
          load: `fulfilled`,
          readySnapshots: [[]],
          query: raw.query && { ...raw.query, sourceStatus: `ready` },
        })),
      },
      {
        name: `query cannot become ready before requested stream decoding`,
        history: { constructed: `generated on-demand:initial-valid` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.atDemand
            ? {
                ...raw,
                atDemand: {
                  ...raw.atDemand,
                  queryLoad: `fulfilled`,
                  queryStatus: `ready`,
                },
              }
            : undefined,
        ),
      },
      {
        name: `query ready values retain native decoding`,
        history: { constructed: `generated on-demand:initial-valid` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.query
            ? { ...raw, query: { ...raw.query, readySnapshots: [[]] } }
            : undefined,
        ),
      },
      {
        name: `initial query refusal cannot fulfill`,
        history: { constructed: `generated on-demand:initial-throw` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.query
            ? {
                ...raw,
                query: {
                  ...raw.query,
                  status: `ready`,
                  load: `fulfilled`,
                  rejection: null,
                },
              }
            : undefined,
        ),
      },
      {
        name: `ready source does not become loading error on initial query refusal`,
        history: { constructed: `generated on-demand:initial-throw` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) => ({ ...raw, status: `error` })),
      },
      {
        name: `query retains source parse cause`,
        history: { constructed: `generated on-demand:initial-changed-id` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.query
            ? { ...raw, query: { ...raw.query, sourceError: null } }
            : undefined,
        ),
      },
      {
        name: `refused live batch cannot publish through query`,
        history: { constructed: `generated on-demand:live-throw-middle` },
        law: `decode admission`,
        corrupt: corrupt((_h, raw) =>
          raw.query
            ? {
                ...raw,
                query: { ...raw.query, publications: [raw.query.rows] },
              }
            : undefined,
        ),
      },
      ...decodeStates.map((state) => ({
        name: `missing construction ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: DecodeHistory) =>
          required.get(h) === state
            ? trace.filter(
                (entry) =>
                  !(entry.checkpoint === `reach` && entry.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
