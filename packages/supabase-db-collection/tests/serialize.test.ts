import {  Query } from '@tanstack/db'
import { describe, expect, test } from 'vitest'
import { serializeQueryIR } from '../src/serialize'
import {
  createMockFetch,
  createMockedTodosCollection,
  createMockedUsersCollection,
} from './test.utils'
import type {BaseQueryBuilder} from '@tanstack/db';

describe('serializeQueryIR FROM variants', () => {
  const mockFetch = createMockFetch()
  const usersCollection = createMockedUsersCollection(mockFetch)
  const todosCollection = createMockedTodosCollection(mockFetch)

  test('serializes a plain collection FROM as a table', () => {
    const ir = (
      new Query().from({
        user: usersCollection,
      }) as unknown as BaseQueryBuilder
    )._getQuery()

    const serialized = serializeQueryIR(ir)
    expect(serialized.from).toMatchObject({ type: 'table', name: 'users' })
  })

  // Regression: @tanstack/db 0.6.x widened IR.From to include UnionFrom /
  // UnionAll. Serialization used to only accept CollectionRef | QueryRef, so
  // the package no longer type-checked and a union FROM was unrepresentable.
  test('serializes a unionAll FROM without throwing', () => {
    const ir = (
      new Query().unionAll(
        new Query().from({ user: usersCollection }),
        new Query().from({ todo: todosCollection }),
      ) as unknown as BaseQueryBuilder
    )._getQuery()

    const serialized = serializeQueryIR(ir)
    expect(serialized.from.type).toBe('unionAll')
    if (serialized.from.type === 'unionAll') {
      expect(serialized.from.queries).toHaveLength(2)
      expect(serialized.from.queries[0]?.from).toMatchObject({
        type: 'table',
        name: 'users',
      })
    }
  })
})
