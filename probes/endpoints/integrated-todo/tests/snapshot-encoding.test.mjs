import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeSnapshots } from '../src/snapshot-encoding.server.ts'
const expand = (value) =>
  value.kind === 'confirmed'
    ? value.snapshots
    : value.snapshots.map((snapshot) => ({
        id: snapshot.id,
        rows: snapshot.indexes.map((index) => value.pool[index]),
      }))
test('shared encoding preserves differing rows with the same key, types, order and empty results', () => {
  const first = {
    id: 'same',
    text: 'x'.repeat(1000),
    createdAt: new Date('2026-01-01'),
    nullable: null,
  }
  const second = { ...first, text: 'y'.repeat(1000) }
  const asText = { ...first, createdAt: first.createdAt.toISOString() }
  const snapshots = [
    { id: 'a', rows: [first, second, asText] },
    { id: 'b', rows: [asText, first, second] },
    { id: 'empty', rows: [] },
  ]
  const encoded = encodeSnapshots(snapshots)
  assert.equal(encoded.kind, 'confirmed-shared')
  assert.equal(encoded.pool.length, 3)
  assert.deepEqual(expand(encoded), snapshots)
})
test('adaptive encoding keeps full snapshots when sharing adds bytes or values are unsupported', () => {
  for (const snapshots of [
    [],
    [{ id: 'a', rows: [] }],
    [
      { id: 'a', rows: [] },
      { id: 'b', rows: [] },
    ],
    [
      { id: 'a', rows: [{ id: 'x', value: 1n }] },
      { id: 'b', rows: [{ id: 'x', value: 1n }] },
    ],
  ])
    assert.deepEqual(encodeSnapshots(snapshots), {
      kind: 'confirmed',
      snapshots,
    })
})

test('distinct compiler relation groups bypass row encoding entirely', () => {
  const row = {
    id: 'x',
    get text() {
      throw Error('must not inspect rows')
    },
  }
  const snapshots = [
    { id: 'a', rows: [row] },
    { id: 'b', rows: [row] },
  ]
  assert.equal(
    encodeSnapshots(snapshots, 'adaptive', { a: 'first', b: 'second' }).kind,
    'confirmed',
  )
})

test('disjoint row keys bypass payload encoding even within the same relation', () => {
  const first = {
    id: 'a',
    get text() {
      throw Error('must not encode payload')
    },
  }
  const second = {
    id: 'b',
    get text() {
      throw Error('must not encode payload')
    },
  }
  assert.equal(
    encodeSnapshots(
      [
        { id: 'x', rows: [first] },
        { id: 'y', rows: [second] },
      ],
      'adaptive',
      { x: 'same', y: 'same' },
    ).kind,
    'confirmed',
  )
})
