import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { CoverageRegistry } from '../../src/query/coverage-registry.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import type { AppliedLoadSubsetOutcome } from '../../src/types.js'

type Prefix = number
type RowKey = string

function createPrefixRegistry(): CoverageRegistry<Prefix, Prefix, RowKey> {
  return new CoverageRegistry({
    coversDemand: (coverage, demand) => coverage >= demand,
    coversCoverage: (coverage, candidate) => coverage >= candidate,
    projectAppliedCoverage: (outcome) =>
      outcome.collectionId === `prefixes` ? outcome.demand.limit : undefined,
  })
}

function createPrefixOutcome(
  generation: number,
  prefix: Prefix,
  extent: AppliedLoadSubsetOutcome['extent'] = `exhausted`,
  collectionId = `prefixes`,
): AppliedLoadSubsetOutcome {
  return {
    collectionId,
    demand: { limit: prefix },
    generation,
    extent,
  }
}

function publishPrefix(
  registry: CoverageRegistry<Prefix, Prefix, RowKey>,
  acquisition: ReturnType<typeof registry.addAcquisition>,
  generation: number,
  coverage: Prefix,
): void {
  expect(
    registry.publishOutcome(
      acquisition,
      createPrefixOutcome(generation, coverage),
    ),
  ).toBe(true)
}

describe(`coverage registry oracle`, () => {
  it(`shares one physical acquisition until its final demand lease releases`, () => {
    const registry = createPrefixRegistry()
    const release = vi.fn()
    const first = registry.addLease(20)
    const second = registry.addLease(10)
    const acquisition = registry.addAcquisition({
      generation: 1,
      leases: [first, second],
      release,
    })

    registry.replaceRows(acquisition, 1, [`a`, `b`])
    publishPrefix(registry, acquisition, 1, 20)

    expect(registry.releaseLease(first)).toEqual({ rowsToRemove: [] })
    expect(release).not.toHaveBeenCalled()
    expect(registry.covers(10)).toBe(true)
    expect(registry.rowOwnerCount(`a`)).toBe(1)

    expect(registry.releaseLease(second)).toEqual({
      rowsToRemove: [`a`, `b`],
    })
    expect(release).toHaveBeenCalledOnce()
    expect(registry.covers(10)).toBe(false)
    expect(registry.rowOwnerCount(`a`)).toBe(0)

    expect(registry.releaseLease(second)).toEqual({ rowsToRemove: [] })
    registry.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it(`restores a compacted narrower fact when the wider acquisition retires`, () => {
    const registry = createPrefixRegistry()
    const narrowLease = registry.addLease(20)
    const wideLease = registry.addLease(100)
    const narrowAcquisition = registry.addAcquisition({
      generation: 1,
      leases: [narrowLease],
      release: vi.fn(),
    })
    const wideAcquisition = registry.addAcquisition({
      generation: 1,
      leases: [wideLease],
      release: vi.fn(),
    })

    publishPrefix(registry, narrowAcquisition, 1, 20)
    publishPrefix(registry, wideAcquisition, 1, 100)
    expect(registry.coverageAntichain()).toEqual([100])

    registry.releaseLease(wideLease)
    expect(registry.coverageAntichain()).toEqual([20])
    expect(registry.covers(20)).toBe(true)
    expect(registry.covers(21)).toBe(false)
  })

  it(`keeps shared rows through overlapping destructive snapshots and GC`, () => {
    const registry = createPrefixRegistry()
    const firstLease = registry.addLease(20)
    const secondLease = registry.addLease(20)
    const first = registry.addAcquisition({
      generation: 1,
      leases: [firstLease],
      release: vi.fn(),
    })
    const second = registry.addAcquisition({
      generation: 1,
      leases: [secondLease],
      release: vi.fn(),
    })

    expect(registry.replaceRows(first, 1, [`shared`, `first`])).toEqual({
      accepted: true,
      rowsToRemove: [],
    })
    expect(registry.replaceRows(second, 1, [`shared`, `second`])).toEqual({
      accepted: true,
      rowsToRemove: [],
    })

    expect(registry.replaceRows(first, 1, [])).toEqual({
      accepted: true,
      rowsToRemove: [`first`],
    })
    expect(registry.rowOwnerCount(`shared`)).toBe(1)

    expect(registry.releaseLease(secondLease)).toEqual({
      rowsToRemove: [`second`, `shared`],
    })
  })

  it(`publishes only current authoritative coverage projected from an applied outcome`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(20)
    const acquisition = registry.addAcquisition({
      generation: 2,
      leases: [lease],
      release: vi.fn(),
    })

    expect(
      registry.publishOutcome(acquisition, createPrefixOutcome(1, 20)),
    ).toBe(false)
    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(2, 20, `unknown`),
      ),
    ).toBe(false)
    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(2, 20, `exhausted`, `other`),
      ),
    ).toBe(false)
    expect(registry.coverageAntichain()).toEqual([])

    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(2, 30, `continues`),
      ),
    ).toBe(true)
    expect(registry.coverageAntichain()).toEqual([30])
  })

  fcTest.prop(
    [
      fc.array(
        fc.record({
          prefix: fc.integer({ min: 1, max: 8 }),
          rows: fc.uniqueArray(fc.constantFrom(`a`, `b`, `c`, `d`), {
            maxLength: 4,
          }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      fc.array(fc.nat(), { maxLength: 16 }),
    ],
    oraclePropertyOptions(50),
  )(
    `preserves lease, acquisition, antichain, and row-provenance laws across release histories`,
    (claims, releaseOrder) => {
      const registry = createPrefixRegistry()
      const releases = claims.map(() => vi.fn())
      const leases = claims.map((claim, index) => {
        const lease = registry.addLease(claim.prefix)
        const acquisition = registry.addAcquisition({
          generation: index + 1,
          leases: [lease],
          release: releases[index]!,
        })
        registry.replaceRows(acquisition, index + 1, claim.rows)
        publishPrefix(registry, acquisition, index + 1, claim.prefix)
        return lease
      })
      const active = new Set(claims.map((_, index) => index))

      const assertModel = () => {
        const activeClaims = claims.filter((_, index) => active.has(index))
        expect(registry.coverageAntichain()).toEqual(
          activeClaims.length === 0
            ? []
            : [Math.max(...activeClaims.map(({ prefix }) => prefix))],
        )
        for (const row of [`a`, `b`, `c`, `d`]) {
          expect(registry.rowOwnerCount(row)).toBe(
            activeClaims.filter(({ rows }) => rows.includes(row)).length,
          )
        }
        releases.forEach((release, index) => {
          expect(release).toHaveBeenCalledTimes(active.has(index) ? 0 : 1)
        })
      }

      assertModel()
      for (const rawIndex of releaseOrder) {
        const index = rawIndex % claims.length
        registry.releaseLease(leases[index]!)
        active.delete(index)
        assertModel()
      }

      registry.dispose()
      active.clear()
      assertModel()
    },
  )
})
