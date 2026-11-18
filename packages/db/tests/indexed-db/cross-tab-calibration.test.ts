// Model and checker calibrations for the cross-tab model in cross-tab-oracle.ts.
// These tests run no production: each steps the model or hands a hand-built
// publication history to a shared check and requires the check to accept or
// reject it. The generated production histories are in
// cross-tab-history-oracle.test.ts.
import { expect, it } from 'vitest'
import {
  CrossTabModel,
  assertPublicationHistory,
  assertReplay,
  assertSnapshot,
  assertStatuses,
} from './cross-tab-oracle'

it('requires local admission to distinguish identical durable deletions', () => {
  const row = { id: 0, name: 'old' }
  const delayed = new CrossTabModel([0, 0], [[row]])
  delayed.accept(0, { rows: [], deletes: [0], replace: false })
  expect(delayed.durable[0]).toEqual([])
  expect(delayed.publicSnapshots[1]).toEqual([row])
  // A durable-only projection rejects the locally legal update: explicit
  // grammar calibration, not a claimed production mutant.
  expect(() =>
    assertSnapshot(
      delayed.durable[0]!,
      delayed.publicSnapshots[1]!,
      'local admission',
    ),
  ).toThrow('public rows at local admission')
  delayed.receive(1, [{ rows: [], deletes: [0], replace: false }])
  expect(delayed.publicSnapshots[1]).toEqual([])
})

it('rejects repaired partial publications and malformed raw deltas', () => {
  const before = [
    { id: 0, name: 'a' },
    { id: 1, name: 'b' },
  ]
  const after = [
    { id: 0, name: 'new a' },
    { id: 1, name: 'new b' },
  ]
  const effect = { rows: after, deletes: [], replace: false }
  const first = {
    key: 0,
    type: 'update' as const,
    value: after[0]!,
    previousValue: before[0]!,
  }
  const second = {
    key: 1,
    type: 'update' as const,
    value: after[1]!,
    previousValue: before[1]!,
  }
  expect(() =>
    assertPublicationHistory(
      before,
      [
        { changes: [first], rows: [after[0]!, before[1]!] },
        { changes: [second], rows: after },
      ],
      [effect],
      'control',
    ),
  ).toThrow('atomic publication')
  for (const corrupt of [
    { ...first, type: 'insert' as const },
    { ...first, previousValue: { id: 0, name: 'wrong' } },
  ])
    expect(() =>
      assertPublicationHistory(
        before,
        [{ changes: [corrupt, second], rows: after }],
        [effect],
        'control',
      ),
    ).toThrow('event semantics')
  assertPublicationHistory(
    before,
    [{ changes: [first, second], rows: after }],
    [effect],
    'healthy control',
  )
  expect(() =>
    assertStatuses(['ready', 'error', 'ready'], ['ready'], 'repaired error'),
  ).toThrow('Collection status')
  expect(() =>
    assertReplay({
      inputReconstructed: true,
      premiseReached: false,
      sameFailure: false,
    }),
  ).toThrow('failure replay')
})

it('rejects wrong raw event keys before folding including duplicate malformed inserts', () => {
  const row = { id: 1, name: 'accepted value' }
  const effect = { rows: [row], deletes: [], replace: false }
  for (const key of ['wrong', '1']) {
    const change = { key, type: 'insert' as const, value: row }
    for (const changes of [[change], [change, change]])
      expect(() =>
        assertPublicationHistory(
          [],
          [{ changes, rows: [row] }],
          [effect],
          'raw key identity',
        ),
      ).toThrow('event semantics')
  }
  expect(() =>
    assertPublicationHistory(
      [row],
      [
        {
          changes: [
            {
              key: 1,
              type: 'update',
              previousValue: row,
              value: { ...row, id: '1' },
            },
          ],
          rows: [{ ...row, id: '1' }],
        },
      ],
      [{ ...effect, rows: [{ ...row, id: '1' }] }],
      'update key identity',
    ),
  ).toThrow('event semantics')
})
