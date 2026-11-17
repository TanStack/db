// Checker calibrations for the shared window-history comparison in
// conformance/window-history-oracle.ts. These tests run no production and use
// no framework driver: each hands a hand-built observation to the shared check
// and requires it to accept or reject it, so they run once here instead of once
// per framework registration.
import { describe, expect, it } from 'vitest'
import { oracleAssertion } from './oracle-assertion-adapter'
import {
  checkWindowObservation,
  checkWindowState,
  checkWindowSubscriptions,
  windowHistoryExamples,
  windowRows,
} from './conformance/window-history-oracle'

describe(`window history`, () => {
  it(`rejects a pending keyed map that differs from the settled rows`, () => {
    const history = windowHistoryExamples[0]![0]
    const input = history.inputs[0]!
    const rows = windowRows(history.rows, input, false)
    const collection = {}
    // data and Collection are valid. The empty map alone is the wrong answer.
    oracleAssertion('checkWindowObservation', () =>
      checkWindowObservation(
        { rows, collection },
        { rows, previousCollection: collection, retain: true },
        `held acquisition`,
      ),
    )
    oracleAssertion('expect(() =>', () =>
      expect(() =>
        oracleAssertion('checkWindowState', () =>
          checkWindowState(new Map(), rows, `held acquisition`),
        ),
      ).toThrow(`keyed window rows at held acquisition`),
    )
    oracleAssertion('checkWindowState', () =>
      checkWindowState(
        new Map(rows.map((row) => [row.id, row])),
        rows,
        `held acquisition`,
      ),
    )
  })
  // These controls use the campaign's shared comparison. Owner-only recording
  // accepts 1 -> 2 -> 1 when a replacement subscribes before its predecessor
  // retires. A retired Collection's 2 -> 1 decrement must still be accepted.
  it(`retained subscriptions distinguish overlapping replacement from GC`, () => {
    const collection = {}
    const overlappingReplacement = [
      {
        owners: [collection],
        previousSubscriberCount: 1,
        subscriberCount: 2,
      },
      {
        owners: [collection],
        previousSubscriberCount: 2,
        subscriberCount: 1,
      },
    ]
    oracleAssertion('expect(() =>', () =>
      expect(() =>
        oracleAssertion('checkWindowSubscriptions', () =>
          checkWindowSubscriptions(overlappingReplacement, collection),
        ),
      ).toThrow(`retained upstream subscription count`),
    )
    oracleAssertion('checkWindowSubscriptions', () =>
      checkWindowSubscriptions(
        [
          {
            owners: [collection],
            previousSubscriberCount: 2,
            subscriberCount: 1,
          },
        ],
        collection,
      ),
    )
  })
})
