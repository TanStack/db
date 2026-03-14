import { describe, expect, it } from 'vitest'
import { serializeLoadSubsetOptions } from '../src/serialization'

describe(`serializeLoadSubsetOptions`, () => {
  it(`includes meta in serialized output`, () => {
    const serialized = serializeLoadSubsetOptions({
      limit: 10,
      meta: { scope: `tenant-a`, includeClients: true },
    })

    expect(serialized).toContain(`"meta"`)
    expect(serialized).toContain(`"scope":"tenant-a"`)
    expect(serialized).toContain(`"includeClients":true`)
  })

  it(`produces different keys when only meta differs`, () => {
    const serializedA = serializeLoadSubsetOptions({
      limit: 10,
      meta: { scope: `tenant-a` },
    })

    const serializedB = serializeLoadSubsetOptions({
      limit: 10,
      meta: { scope: `tenant-b` },
    })

    expect(serializedA).not.toEqual(serializedB)
  })
})
