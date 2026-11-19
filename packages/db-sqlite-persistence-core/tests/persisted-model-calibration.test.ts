/**
 * Calibrations of the durability models, checks, and grammar in
 * persisted-durability-model-oracle.ts: the generated persistence grammars
 * reconstruct their samples and reject ablated, out-of-range, and foreign
 * histories; each observation check rejects a named wrong answer; the
 * append-only ledger rejects omission and reordering; and the on-demand
 * evidence law rejects an evidence-coupled mutant. They run no production, so
 * they are ordinary tests. The oracle that drives production is
 * persisted-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { oracleReplayRequested } from '../../db/tests/oracle-config.js'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { describeUnlessOracleReplay } from './persisted-support'

import {
  expectAbortGraphObservation,
  expectOnDemandEvidenceLaw,
  expectOpenTransactionBoundaryObservation,
  expectOwnerIsolationAdmission,
  expectRequestLocalFailureObservation,
  expectSourceFifoOrderingObservation,
  foldDurabilityLedger,
  generatedPersistenceGrammarSamples,
  generatedPersistenceGrammars,
  generatedTitleMaxLength,
  reconstructGeneratedPersistenceHistory,
} from './persisted-durability-model-oracle'
import type { DurabilityLedgerEvent } from './persisted-durability-model-oracle'

describe(`generated persistence durability oracles`, () => {
  if (!oracleReplayRequested()) {
    it(`reconstructs the full grammar and rejects ablated, out-of-range, and foreign histories`, () => {
      for (const {
        grammar,
        histories,
      } of generatedPersistenceGrammarSamples()) {
        for (const history of histories) {
          oracleAssertion('existing comparison at 1490', () =>
            expect(
              reconstructGeneratedPersistenceHistory(grammar, history),
            ).toEqual(history),
          )
        }
      }

      for (const grammar of generatedPersistenceGrammars) {
        oracleAssertion('existing comparison at 1497', () =>
          expect(Object.keys(grammar.axisContribution).sort()).toEqual(
            [...grammar.axes].sort(),
          ),
        )
        for (const contribution of Object.values(grammar.axisContribution)) {
          oracleAssertion('existing comparison at 1501', () =>
            expect(contribution).not.toBe(``),
          )
        }
        oracleAssertion('existing comparison at 1503', () =>
          expect(
            reconstructGeneratedPersistenceHistory(grammar, grammar.witness),
          ).toEqual(grammar.witness),
        )

        for (const omittedAxis of grammar.axes) {
          oracleAssertion('existing comparison at 1508', () =>
            expect(() =>
              reconstructGeneratedPersistenceHistory(grammar, {
                ...grammar.witness,
                axes: grammar.witness.axes.filter(
                  (axis) => axis !== omittedAxis,
                ),
              }),
            ).toThrow(`invalid generated persistence history`),
          )
        }

        oracleAssertion('existing comparison at 1516', () =>
          expect(
            reconstructGeneratedPersistenceHistory(grammar, {
              axes: [...grammar.axes],
              titles: Array.from({ length: grammar.titleCount }, () =>
                `x`.repeat(generatedTitleMaxLength),
              ),
            }).titles,
          ).toEqual(
            Array.from({ length: grammar.titleCount }, () =>
              `x`.repeat(generatedTitleMaxLength),
            ),
          ),
        )
        oracleAssertion('existing comparison at 1528', () =>
          expect(
            reconstructGeneratedPersistenceHistory(grammar, {
              axes: [...grammar.axes],
              titles: Array.from({ length: grammar.titleCount }, () => ``),
            }).titles,
          ).toEqual(Array.from({ length: grammar.titleCount }, () => ``)),
        )
        oracleAssertion('existing comparison at 1534', () =>
          expect(() =>
            reconstructGeneratedPersistenceHistory(grammar, {
              axes: [...grammar.axes],
              titles: [
                `x`.repeat(generatedTitleMaxLength + 1),
                ...Array.from(
                  { length: Math.max(0, grammar.titleCount - 1) },
                  () => ``,
                ),
              ],
            }),
          ).toThrow(`invalid generated persistence history`),
        )
        oracleAssertion('existing comparison at 1546', () =>
          expect(() =>
            reconstructGeneratedPersistenceHistory(grammar, {
              ...grammar.witness,
              axes: grammar.axes.map((axis, index) =>
                index === grammar.axes.length - 1 ? grammar.axes[0]! : axis,
              ),
            }),
          ).toThrow(`invalid generated persistence history`),
        )
        oracleAssertion('existing comparison at 1554', () =>
          expect(() =>
            reconstructGeneratedPersistenceHistory(grammar, {
              ...grammar.witness,
              axes: [...grammar.axes.slice(0, -1), `foreign-axis`],
            }),
          ).toThrow(`invalid generated persistence history`),
        )
      }
    })

    it.each([
      {
        name: `source-fifo-order older same-key value wins`,
        reject: () =>
          expectSourceFifoOrderingObservation(
            {
              publicRows: [{ id: `shared`, title: `older` }],
              durableRows: [{ id: `shared`, title: `older` }],
              status: `ready`,
              pendingMarkers: 0,
            },
            [{ id: `shared`, title: `newer` }],
          ),
      },
      {
        name: `abort-graph independent sibling inherits the abort`,
        reject: () =>
          expectAbortGraphObservation(
            {
              predecessorStatus: `rejected`,
              predecessorName: `AbortError`,
              successorStatus: `rejected`,
              sameFailure: true,
              status: `crashed`,
              publicSuccessor: undefined,
              durableSuccessor: undefined,
              pendingMarkers: 0,
            },
            `independent`,
            `survivor`,
            `must survive`,
          ),
      },
      {
        name: `owner-isolation bare write steals and publishes a queued marker`,
        reject: () =>
          expectOwnerIsolationAdmission({
            exactError: false,
            strayVisible: true,
          }),
      },
      {
        name: `open-transaction boundary leaks one core marker`,
        reject: () =>
          expectOpenTransactionBoundaryObservation(
            { status: `crashed`, pendingMarkers: 1 },
            `terminal-failure`,
          ),
      },
      {
        name: `request-local partial update drops the unseen baseline field`,
        reject: () =>
          expectRequestLocalFailureObservation(
            {
              receiptStatus: `fulfilled`,
              publicRows: [{ id: `shared`, title: `source` }],
              durableRows: [
                {
                  id: `shared`,
                  title: `source`,
                  detail: `required baseline detail`,
                },
              ],
              status: `ready`,
              publicError: undefined,
            },
            [
              {
                id: `shared`,
                title: `source`,
                detail: `required baseline detail`,
              },
            ],
          ),
      },
    ])(`rejects named wrong answer: $name`, ({ reject }) => {
      oracleAssertion('existing comparison at 1640', () =>
        expect(reject).toThrow(),
      )
    })
  }
})

describeUnlessOracleReplay(`persistedCollectionOptions`, () => {
  it(`append-only transaction judgment rejects omission and reordering`, () => {
    const events: Array<DurabilityLedgerEvent> = [
      { type: `begin`, transactionId: `first` },
      {
        type: `write`,
        transactionId: `first`,
        row: { id: `shared`, title: `first` },
      },
      { type: `commit`, transactionId: `first` },
      { type: `begin`, transactionId: `second` },
      {
        type: `write`,
        transactionId: `second`,
        row: { id: `shared`, title: `second` },
      },
      { type: `commit`, transactionId: `second` },
    ]
    const expected = foldDurabilityLedger(events)

    oracleAssertion('existing comparison at 2042', () =>
      expect(expected.commitOrder).toEqual([`first`, `second`]),
    )
    oracleAssertion('existing comparison at 2043', () =>
      expect(expected.commitOrder).not.toEqual([`second`]),
    )
    oracleAssertion('existing comparison at 2044', () =>
      expect(expected.commitOrder).not.toEqual([`second`, `first`]),
    )
    oracleAssertion('existing comparison at 2045', () =>
      expect(expected.committedRows.get(`shared`)).toEqual({
        id: `shared`,
        title: `second`,
      }),
    )
  })

  it(`rejects an evidence-coupled on-demand hydration mutant`, () => {
    oracleAssertion('existing comparison at 4747', () =>
      expect(() =>
        expectOnDemandEvidenceLaw({
          status: `incompatible`,
          route: `loadSubset`,
          baselineVisible: false,
          onDemandVisible: false,
        }),
      ).toThrow(`on-demand rows must not inherit baseline evidence rejection`),
    )

    expectOnDemandEvidenceLaw({
      status: `incompatible`,
      route: `loadSubset`,
      baselineVisible: false,
      onDemandVisible: true,
    })
  })
})
