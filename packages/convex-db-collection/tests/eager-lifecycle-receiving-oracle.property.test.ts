/**
 * Convex receives the strengthened shared health/resource judgment through its
 * installed SDK. Distinct QueryFailed transitions remain open until a valid
 * QueryUpdated result, including an unchanged-row result, clears the frame.
 * Cleanup releases each adapter-owned query listener exactly once. It does not
 * close the application-owned client. The shared Map/phase model and checker
 * own every expected result; this file supplies only randomized histories and
 * the real JavaScript, React and wrapped receiving paths. No deployment claim.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import { eagerLiveSourceCampaign } from '../../db-adapter-conformance/tests/eager-live-source-oracle-suite'
import { describeValue } from '../../db-adapter-conformance/src'
import { convexConformanceDriver } from './conformance-driver'
import type { EagerLiveSourceHistory } from '../../db-adapter-conformance/src'

// Each constructed history retains generated keys/values. Its two recoveries
// distinguish clearing only on a row change from clearing on a valid result.
// Separate errors distinguish one retained error from the complete open frame.
function construct(
  generated: EagerLiveSourceHistory,
  salt: number,
): EagerLiveSourceHistory {
  let coordinate = salt + 1
  for (const char of describeValue(generated))
    coordinate = (Math.imul(coordinate, 31) + char.charCodeAt(0)) >>> 0
  const row = {
    id: (coordinate % 5) + 1,
    title: ([`a`, `b`, `c`] as const)[coordinate % 3]!,
    value: [0, -7, 2 ** 31][coordinate % 3]!,
    typed: {
      string: ``,
      integer: 0,
      float: 0.5,
      'negative-zero': -0,
      boolean: true,
      null: null,
      bigint: 0n,
      array: [],
      object: {},
    },
  }
  return [
    { kind: `snapshot`, rows: [row] },
    { kind: `delivery-error` },
    { kind: `delivery-error` },
    { kind: `changes`, changes: [] },
    { kind: `delivery-error` },
    {
      kind: `changes`,
      changes: [
        {
          type: `upsert`,
          row: { ...row, value: [0, -7, 2 ** 31][(coordinate + 1) % 3]! },
        },
      ],
    },
  ]
}

for (const client of [`javascript`, `react`, `wrapped`] as const) {
  const campaign = eagerLiveSourceCampaign(
    convexConformanceDriver({ client }),
    construct,
    [
      `delivery-error-identities-retained`,
      `delivery-error-recovered-with-row-change`,
      `delivery-error-recovered-without-row-change`,
      `sync-run-resources-released`,
    ],
  )
  // This focused receiver requires its four new states. The original complete
  // eager receiver keeps all original states, five constructions and run budget.
  const added = campaign.states.slice(-4)
  const onlyDeclared =
    (drive: typeof campaign.driver): typeof campaign.driver =>
    (history, observe) =>
      drive(history, (checkpoint, value) => {
        if (
          checkpoint !== `reach` ||
          added.includes(value as (typeof added)[number])
        )
          observe(checkpoint, value)
      })
  oracleProperty({
    id: `adapter.convex.eager-lifecycle.${client}`,
    owns: [
      `src/options.ts#createConvexOptions`,
      `src/subscription.ts#subscribeQuery`,
    ],
    law: {
      statement: `Every distinct delivery error remains in the open health frame until a valid result; changed and unchanged results clear it; cleanup releases every query listener once.`,
      authority: `Shared eager live-source HEALTH-1/2 and LIFE-2/10; docs/collections/convex-collection.md Errors and cleanup.`,
      limits: `Installed Convex SDK over a controlled WebSocket; eager JavaScript, React and onUpdate-only wrapped clients. No deployed backend, connection shutdown or PowerSync stream policy.`,
    },
    histories: {
      arbitrary: campaign.arbitrary,
      states: added,
      constructed: campaign.constructed.map((builder) => ({
        ...builder,
        enters: added,
      })),
      runs: 40,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `two open query delivery errors`,
          history: [
            { kind: `snapshot`, rows: [] },
            { kind: `delivery-error` },
            { kind: `delivery-error` },
          ],
        },
      ],
    },
    model: (history) => ({
      required: campaign
        .model(history)
        .required.filter((state) =>
          added.includes(state as (typeof added)[number]),
        ),
    }),
    driver: onlyDeclared(campaign.driver),
    check: campaign.check,
    calibrations: [
      ...campaign.calibrations
        .filter((calibration) =>
          added.some((state) => calibration.name.endsWith(`omits ${state}`)),
        )
        .map((calibration) => ({
          ...calibration,
          history: {
            constructed:
              campaign.constructed[
                Number(calibration.name.match(/^construction (\d+)/)?.[1]) - 1
              ]!.name,
          },
        })),
      {
        name: `receiver drops the second error identity`,
        history: { fixed: `two open query delivery errors` },
        law: `HEALTH-1 (health failureReason)`,
        driver: onlyDeclared(campaign.deliveryErrorIdentityDriver),
      },
    ],
    timeout: 120_000,
  })
}
