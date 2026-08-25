import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { CoverageRegistry } from '../../src/query/coverage-registry.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import type { AppliedLoadSubsetOutcome } from '../../src/types.js'
import type { Command } from 'fast-check'

type Prefix = number
type PrefixCoverage = Readonly<{ prefix: Prefix }>
type RowKey = string

function createPrefixRegistry(): CoverageRegistry<
  Prefix,
  PrefixCoverage,
  RowKey
> {
  return new CoverageRegistry({
    coversDemand: (coverage, demand) => coverage.prefix >= demand,
    coversCoverage: (coverage, candidate) =>
      coverage.prefix >= candidate.prefix,
    snapshotCoverage: (coverage) => Object.freeze({ ...coverage }),
    projectAppliedCoverage: ({ outcome, rows }) => {
      const prefix = outcome.demand.limit
      if (outcome.collectionId !== `prefixes` || prefix === undefined) {
        return undefined
      }
      if (rows.size < prefix && outcome.extent !== `exhausted`) {
        return undefined
      }
      return { prefix }
    },
  })
}

function createPrefixOutcome(
  generation: number,
  prefix: Prefix,
  extent: AppliedLoadSubsetOutcome['extent'] = `exhausted`,
  collectionId = `prefixes`,
  sourceId = `items`,
  rows: ReadonlyArray<RowKey> = [],
): AppliedLoadSubsetOutcome {
  return {
    collectionId,
    sourceId,
    demand: { limit: prefix },
    generation,
    extent,
    appliedRowKeys: rows,
  }
}

function addPrefixAcquisition(
  registry: CoverageRegistry<Prefix, PrefixCoverage, RowKey>,
  options: {
    generation: number
    leases: ReadonlyArray<ReturnType<typeof registry.addLease>>
    release: () => void
    prefix: Prefix
    sourceId?: string
  },
) {
  return registry.addAcquisition({
    generation: options.generation,
    leases: options.leases,
    release: options.release,
    scope: {
      collectionId: `prefixes`,
      sourceId: options.sourceId ?? `items`,
      demand: { limit: options.prefix },
    },
  })
}

function publishPrefix(
  registry: CoverageRegistry<Prefix, PrefixCoverage, RowKey>,
  acquisition: ReturnType<typeof registry.addAcquisition>,
  generation: number,
  coverage: Prefix,
  rows: ReadonlyArray<RowKey> = [],
): void {
  expect(
    registry.publishOutcome(
      acquisition,
      createPrefixOutcome(
        generation,
        coverage,
        `exhausted`,
        `prefixes`,
        `items`,
        rows,
      ),
    ),
  ).toMatchObject({ accepted: true, published: true })
}

type ModelLease = {
  active: boolean
  prefix: Prefix
  acquisitions: Set<number>
}

type ModelClaim = {
  generation: number
  prefix: Prefix
  sourceId: string
  coverage: Prefix | undefined
  retainedOutcome: AppliedLoadSubsetOutcome | undefined
  sequence: number
}

type ModelAcquisition = {
  active: boolean
  generation: number
  prefix: Prefix
  sourceId: string
  leases: Set<number>
  claims: Map<number, ModelClaim>
  rows: Set<RowKey>
  releaseCalls: number
  releaseFailuresRemaining: number
  releaseSettled: boolean
}

type RegistryModel = {
  leases: Array<ModelLease>
  acquisitions: Array<ModelAcquisition>
  currentByScope: Map<string, { acquisition: number; lease: number }>
  claimSequence: number
}

type ReleaseProbe = {
  calls: number
  failuresRemaining: number
  error: Error
  release: () => void
}

type RegistryReal = {
  registry: CoverageRegistry<Prefix, PrefixCoverage, RowKey>
  leases: Array<
    ReturnType<CoverageRegistry<Prefix, PrefixCoverage, RowKey>[`addLease`]>
  >
  acquisitions: Array<
    ReturnType<
      CoverageRegistry<Prefix, PrefixCoverage, RowKey>[`addAcquisition`]
    >
  >
  releases: Array<ReleaseProbe>
}

const modelRows = [`a`, `b`, `c`, `d`] as const

function activeIndex<T extends { active: boolean }>(
  records: ReadonlyArray<T>,
  rawIndex: number,
): number | undefined {
  const active = records.flatMap((record, index) =>
    record.active ? [index] : [],
  )
  return active.length === 0 ? undefined : active[rawIndex % active.length]
}

function activeAcquisitionWithLeaseIndex(
  model: RegistryModel,
  rawIndex: number,
): number | undefined {
  const candidates = model.acquisitions.flatMap((acquisition, index) =>
    acquisition.active &&
    [...acquisition.leases].some((lease) => model.leases[lease]?.active)
      ? [index]
      : [],
  )
  return candidates.length === 0
    ? undefined
    : candidates[rawIndex % candidates.length]
}

function scopeKey(sourceId: string, prefix: Prefix): string {
  return `${sourceId}:${prefix}`
}

function addModelAcquisition(
  model: RegistryModel,
  options: {
    generation: number
    prefix: Prefix
    sourceId: string
    leaseIndex: number
    failFirstRelease: boolean
  },
): number {
  const index = model.acquisitions.length
  model.acquisitions.push({
    active: true,
    generation: options.generation,
    prefix: options.prefix,
    sourceId: options.sourceId,
    leases: new Set([options.leaseIndex]),
    claims: new Map([
      [
        options.leaseIndex,
        {
          generation: options.generation,
          prefix: options.prefix,
          sourceId: options.sourceId,
          coverage: undefined,
          retainedOutcome: undefined,
          sequence: model.claimSequence++,
        },
      ],
    ]),
    rows: new Set(),
    releaseCalls: 0,
    releaseFailuresRemaining: options.failFirstRelease ? 1 : 0,
    releaseSettled: false,
  })
  model.leases[options.leaseIndex]!.acquisitions.add(index)
  return index
}

function canPublishModelAcquisition(
  model: RegistryModel,
  acquisitionIndex: number,
  leaseIndex: number,
): boolean {
  const acquisition = model.acquisitions[acquisitionIndex]!
  const claim = acquisition.claims.get(leaseIndex)
  if (!claim) return false
  if (!acquisition.active || acquisition.releaseSettled) return false
  const currentIndex = model.currentByScope.get(
    scopeKey(claim.sourceId, claim.prefix),
  )
  if (
    currentIndex === undefined ||
    currentIndex.acquisition === acquisitionIndex
  ) {
    return true
  }
  const currentClaim = model.acquisitions[currentIndex.acquisition]!.claims.get(
    currentIndex.lease,
  )!
  return claim.generation > currentClaim.generation
}

function restoreModelCurrent(model: RegistryModel, scope: string): void {
  const candidate = model.acquisitions
    .flatMap((acquisition, acquisitionIndex) =>
      !acquisition.active || acquisition.releaseSettled
        ? []
        : Array.from(acquisition.claims.entries()).map(([lease, claim]) => ({
            acquisition,
            acquisitionIndex,
            lease,
            claim,
          })),
    )
    .filter(
      ({ acquisition, lease, claim }) =>
        acquisition.leases.has(lease) &&
        claim.coverage !== undefined &&
        scopeKey(claim.sourceId, claim.prefix) === scope,
    )
    .sort((left, right) =>
      left.claim.generation === right.claim.generation
        ? right.claim.sequence - left.claim.sequence
        : right.claim.generation - left.claim.generation,
    )[0]

  if (candidate) {
    model.currentByScope.set(scope, {
      acquisition: candidate.acquisitionIndex,
      lease: candidate.lease,
    })
  } else model.currentByScope.delete(scope)
}

function replaceModelRows(
  model: RegistryModel,
  acquisitionIndex: number,
  nextRows: ReadonlySet<RowKey>,
): Array<RowKey> {
  const acquisition = model.acquisitions[acquisitionIndex]!
  const rowsToRemove = [...acquisition.rows].filter(
    (row) =>
      !nextRows.has(row) &&
      model.acquisitions.filter(
        (candidate) => candidate.active && candidate.rows.has(row),
      ).length === 1,
  )
  acquisition.rows = new Set(nextRows)
  return rowsToRemove.sort()
}

function retireModelAcquisition(
  model: RegistryModel,
  acquisitionIndex: number,
): Array<RowKey> {
  const acquisition = model.acquisitions[acquisitionIndex]!
  if (!acquisition.active) return []
  const rowsToRemove = replaceModelRows(model, acquisitionIndex, new Set())
  acquisition.active = false
  const affectedScopes = new Set<string>()
  for (const [lease, claim] of acquisition.claims) {
    const scope = scopeKey(claim.sourceId, claim.prefix)
    const current = model.currentByScope.get(scope)
    if (current?.acquisition === acquisitionIndex && current.lease === lease) {
      affectedScopes.add(scope)
    }
    claim.coverage = undefined
    claim.retainedOutcome = undefined
  }
  for (const leaseIndex of acquisition.leases) {
    model.leases[leaseIndex]?.acquisitions.delete(acquisitionIndex)
  }
  for (const scope of affectedScopes) restoreModelCurrent(model, scope)
  return rowsToRemove
}

function settleModelRelease(acquisition: ModelAcquisition): boolean {
  if (acquisition.releaseSettled) return true
  acquisition.releaseCalls++
  if (acquisition.releaseFailuresRemaining > 0) {
    acquisition.releaseFailuresRemaining--
    return false
  }
  acquisition.releaseSettled = true
  return true
}

function createReleaseProbe(failFirst: boolean): ReleaseProbe {
  const probe: ReleaseProbe = {
    calls: 0,
    failuresRemaining: failFirst ? 1 : 0,
    error: new Error(`release failed`),
    release: () => {
      probe.calls++
      if (probe.failuresRemaining > 0) {
        probe.failuresRemaining--
        throw probe.error
      }
    },
  }
  return probe
}

function expectReleaseFailure(release: () => unknown): void {
  let threw = false
  try {
    release()
  } catch {
    threw = true
  }
  expect(threw).toBe(true)
}

function assertRegistryModel(model: RegistryModel, real: RegistryReal): void {
  const activeCoverage = model.acquisitions.flatMap(
    (acquisition, acquisitionIndex) =>
      acquisition.active
        ? Array.from(acquisition.claims.entries()).flatMap(([lease, claim]) => {
            const current = model.currentByScope.get(
              scopeKey(claim.sourceId, claim.prefix),
            )
            return acquisition.leases.has(lease) &&
              claim.coverage !== undefined &&
              current?.acquisition === acquisitionIndex &&
              current.lease === lease
              ? [claim.coverage]
              : []
          })
        : [],
  )
  expect(real.registry.coverageAntichain()).toEqual(
    activeCoverage.length === 0
      ? []
      : [{ prefix: Math.max(...activeCoverage) }],
  )
  const retainedOutcomes = model.acquisitions.flatMap((acquisition) =>
    acquisition.active
      ? Array.from(acquisition.claims.entries()).flatMap(([lease, claim]) =>
          acquisition.leases.has(lease) && claim.retainedOutcome !== undefined
            ? [claim.retainedOutcome]
            : [],
        )
      : [],
  )
  expect(real.registry.retainedOutcomeEvidence()).toEqual(retainedOutcomes)
  for (const row of modelRows) {
    expect(real.registry.rowOwnerCount(row)).toBe(
      model.acquisitions.filter(
        (acquisition) => acquisition.active && acquisition.rows.has(row),
      ).length,
    )
  }
  model.acquisitions.forEach((acquisition, index) => {
    expect(real.releases[index]?.calls).toBe(acquisition.releaseCalls)
  })
}

class AddLeaseCommand implements Command<RegistryModel, RegistryReal> {
  constructor(private readonly prefix: Prefix) {}

  check = () => true

  run(model: RegistryModel, real: RegistryReal): void {
    model.leases.push({
      active: true,
      prefix: this.prefix,
      acquisitions: new Set(),
    })
    real.leases.push(real.registry.addLease(this.prefix))
    assertRegistryModel(model, real)
  }

  toString = () => `addLease(${this.prefix})`
}

class AddAcquisitionCommand implements Command<RegistryModel, RegistryReal> {
  constructor(
    private readonly rawLease: number,
    private readonly generation: number,
    private readonly sourceSlot: number,
    private readonly failFirstRelease: boolean,
  ) {}

  check(model: Readonly<RegistryModel>): boolean {
    return model.leases.some(({ active }) => active)
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const leaseIndex = activeIndex(model.leases, this.rawLease)!
    const prefix = model.leases[leaseIndex]!.prefix
    const sourceId = `source-${this.sourceSlot}`
    const release = createReleaseProbe(this.failFirstRelease)
    addModelAcquisition(model, {
      generation: this.generation,
      prefix,
      sourceId,
      leaseIndex,
      failFirstRelease: this.failFirstRelease,
    })
    real.acquisitions.push(
      addPrefixAcquisition(real.registry, {
        generation: this.generation,
        leases: [real.leases[leaseIndex]!],
        release: () => release.release(),
        prefix,
        sourceId,
      }),
    )
    real.releases.push(release)
    assertRegistryModel(model, real)
  }

  toString = () =>
    `addAcquisition(lease=${this.rawLease}, generation=${this.generation}, source=${this.sourceSlot}, failFirst=${this.failFirstRelease})`
}

class AttachLeaseCommand implements Command<RegistryModel, RegistryReal> {
  constructor(
    private readonly rawLease: number,
    private readonly rawAcquisition: number,
    private readonly retainedExtent:
      | AppliedLoadSubsetOutcome[`extent`]
      | undefined,
  ) {}

  check(model: Readonly<RegistryModel>): boolean {
    return (
      model.leases.some(({ active }) => active) &&
      model.acquisitions.some(({ active }) => active)
    )
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const leaseIndex = activeIndex(model.leases, this.rawLease)!
    const acquisitionIndex = activeIndex(
      model.acquisitions,
      this.rawAcquisition,
    )!
    const acquisition = model.acquisitions[acquisitionIndex]!
    if (acquisition.releaseSettled) {
      expect(() =>
        real.registry.attachLease(
          real.leases[leaseIndex]!,
          real.acquisitions[acquisitionIndex]!,
        ),
      ).toThrow(`Cannot attach to a released acquisition`)
    } else {
      if (acquisition.leases.has(leaseIndex)) {
        assertRegistryModel(model, real)
        return
      }
      model.leases[leaseIndex]!.acquisitions.add(acquisitionIndex)
      acquisition.leases.add(leaseIndex)
      const prefix = model.leases[leaseIndex]!.prefix
      const retainedOutcome =
        this.retainedExtent === undefined
          ? undefined
          : createPrefixOutcome(
              acquisition.generation,
              prefix,
              this.retainedExtent,
              `prefixes`,
              acquisition.sourceId,
              [...acquisition.rows],
            )
      acquisition.claims.set(leaseIndex, {
        generation: acquisition.generation,
        prefix,
        sourceId: acquisition.sourceId,
        coverage: undefined,
        retainedOutcome,
        sequence: model.claimSequence++,
      })
      real.registry.attachLease(
        real.leases[leaseIndex]!,
        real.acquisitions[acquisitionIndex]!,
        {
          generation: acquisition.generation,
          scope: {
            collectionId: `prefixes`,
            sourceId: acquisition.sourceId,
            demand: { limit: prefix },
          },
          ...(retainedOutcome === undefined ? {} : { retainedOutcome }),
        },
      )
    }
    assertRegistryModel(model, real)
  }

  toString = () =>
    `attachLease(lease=${this.rawLease}, acquisition=${this.rawAcquisition}, retainedExtent=${this.retainedExtent})`
}

class RetryAcquisitionCommand implements Command<RegistryModel, RegistryReal> {
  constructor(private readonly rawAcquisition: number) {}

  check(model: Readonly<RegistryModel>): boolean {
    return activeAcquisitionWithLeaseIndex(model, 0) !== undefined
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const oldIndex = activeAcquisitionWithLeaseIndex(
      model,
      this.rawAcquisition,
    )!
    const old = model.acquisitions[oldIndex]!
    const leaseIndex = [...old.leases].find(
      (index) => model.leases[index]?.active,
    )!
    const claim = old.claims.get(leaseIndex)!
    const release = createReleaseProbe(false)
    addModelAcquisition(model, {
      generation: claim.generation + 1,
      prefix: claim.prefix,
      sourceId: claim.sourceId,
      leaseIndex,
      failFirstRelease: false,
    })
    real.acquisitions.push(
      addPrefixAcquisition(real.registry, {
        generation: claim.generation + 1,
        leases: [real.leases[leaseIndex]!],
        release: () => release.release(),
        prefix: claim.prefix,
        sourceId: claim.sourceId,
      }),
    )
    real.releases.push(release)
    assertRegistryModel(model, real)
  }

  toString = () => `retry(acquisition=${this.rawAcquisition})`
}

class ReplaceRowsCommand implements Command<RegistryModel, RegistryReal> {
  constructor(
    private readonly rawAcquisition: number,
    private readonly rows: ReadonlyArray<RowKey>,
  ) {}

  check(model: Readonly<RegistryModel>): boolean {
    return model.acquisitions.some(({ active }) => active)
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const acquisitionIndex = activeIndex(
      model.acquisitions,
      this.rawAcquisition,
    )!
    const acquisition = model.acquisitions[acquisitionIndex]!
    const leaseIndex = Array.from(acquisition.claims.keys()).find((candidate) =>
      acquisition.leases.has(candidate),
    )
    const accepted =
      leaseIndex !== undefined &&
      canPublishModelAcquisition(model, acquisitionIndex, leaseIndex)
    const rowsToRemove = accepted
      ? replaceModelRows(model, acquisitionIndex, new Set(this.rows))
      : []
    if (accepted) {
      const affectedScopes = new Set<string>()
      for (const [claimLease, existingClaim] of acquisition.claims) {
        existingClaim.coverage = undefined
        existingClaim.retainedOutcome = undefined
        const scope = scopeKey(existingClaim.sourceId, existingClaim.prefix)
        const current = model.currentByScope.get(scope)
        if (
          current?.acquisition === acquisitionIndex &&
          current.lease === claimLease
        ) {
          affectedScopes.add(scope)
        }
      }
      for (const scope of affectedScopes) restoreModelCurrent(model, scope)
    }
    expect(
      real.registry.replaceRows(
        real.acquisitions[acquisitionIndex]!,
        this.rows,
      ),
    ).toEqual({ accepted, rowsToRemove })
    assertRegistryModel(model, real)
  }

  toString = () =>
    `replaceRows(acquisition=${this.rawAcquisition}, rows=${this.rows.join(``)})`
}

class PublishCommand implements Command<RegistryModel, RegistryReal> {
  constructor(
    private readonly rawAcquisition: number,
    private readonly rows: ReadonlyArray<RowKey>,
    private readonly generationDelta: number,
    private readonly exactScope: boolean,
    private readonly extent: AppliedLoadSubsetOutcome[`extent`],
  ) {}

  check(model: Readonly<RegistryModel>): boolean {
    return model.acquisitions.some(({ active }) => active)
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const acquisitionIndex = activeIndex(
      model.acquisitions,
      this.rawAcquisition,
    )!
    const acquisition = model.acquisitions[acquisitionIndex]!
    const claimEntry = acquisition.claims.entries().next().value
    const leaseIndex = claimEntry?.[0]
    const claim = claimEntry?.[1]
    const outcome = createPrefixOutcome(
      (claim?.generation ?? acquisition.generation) + this.generationDelta,
      claim?.prefix ?? acquisition.prefix,
      this.extent,
      this.exactScope ? `prefixes` : `other`,
      claim?.sourceId ?? acquisition.sourceId,
      this.rows,
    )
    const accepted =
      leaseIndex !== undefined &&
      canPublishModelAcquisition(model, acquisitionIndex, leaseIndex) &&
      this.generationDelta === 0 &&
      this.exactScope
    const rowsToRemove = accepted
      ? replaceModelRows(model, acquisitionIndex, new Set(this.rows))
      : []
    const published =
      accepted &&
      this.extent !== `unknown` &&
      (this.rows.length >= claim!.prefix || this.extent === `exhausted`)
    if (accepted) {
      for (const peer of acquisition.claims.values()) {
        peer.retainedOutcome = undefined
      }
      claim!.coverage = published ? claim!.prefix : undefined
      const scope = scopeKey(claim!.sourceId, claim!.prefix)
      if (published) {
        for (const peer of acquisition.claims.values()) {
          if (scopeKey(peer.sourceId, peer.prefix) === scope) {
            peer.coverage = claim!.prefix
          }
        }
        restoreModelCurrent(model, scope)
      } else {
        const current = model.currentByScope.get(scope)
        if (
          current?.acquisition === acquisitionIndex &&
          current.lease === leaseIndex
        ) {
          restoreModelCurrent(model, scope)
        }
      }
    }
    expect(
      real.registry.publishOutcome(
        real.acquisitions[acquisitionIndex]!,
        real.leases[leaseIndex!]!,
        outcome,
      ),
    ).toEqual({ accepted, published, rowsToRemove })
    assertRegistryModel(model, real)
  }

  toString = () =>
    `publish(acquisition=${this.rawAcquisition}, rows=${this.rows.join(``)}, generationDelta=${this.generationDelta}, exact=${this.exactScope}, extent=${this.extent})`
}

class ReleaseAcquisitionCommand implements Command<
  RegistryModel,
  RegistryReal
> {
  constructor(private readonly rawAcquisition: number) {}

  check(model: Readonly<RegistryModel>): boolean {
    return model.acquisitions.some(({ active }) => active)
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const acquisitionIndex = activeIndex(
      model.acquisitions,
      this.rawAcquisition,
    )!
    const acquisition = model.acquisitions[acquisitionIndex]!
    if (!settleModelRelease(acquisition)) {
      expectReleaseFailure(() =>
        real.registry.releaseAcquisition(real.acquisitions[acquisitionIndex]!),
      )
    } else {
      const rowsToRemove = retireModelAcquisition(model, acquisitionIndex)
      expect(
        real.registry.releaseAcquisition(real.acquisitions[acquisitionIndex]!),
      ).toEqual({ rowsToRemove })
    }
    assertRegistryModel(model, real)
  }

  toString = () => `releaseAcquisition(${this.rawAcquisition})`
}

class ReleaseLeaseCommand implements Command<RegistryModel, RegistryReal> {
  constructor(private readonly rawLease: number) {}

  check(model: Readonly<RegistryModel>): boolean {
    return model.leases.some(({ active }) => active)
  }

  run(model: RegistryModel, real: RegistryReal): void {
    const leaseIndex = activeIndex(model.leases, this.rawLease)!
    const lease = model.leases[leaseIndex]!
    const finalAcquisitions = [...lease.acquisitions].filter((index) => {
      const acquisition = model.acquisitions[index]!
      return acquisition.active && acquisition.leases.size === 1
    })
    const releaseFailed = finalAcquisitions
      .map((index) => settleModelRelease(model.acquisitions[index]!))
      .some((settled) => !settled)
    if (releaseFailed) {
      expectReleaseFailure(() =>
        real.registry.releaseLease(real.leases[leaseIndex]!),
      )
      assertRegistryModel(model, real)
      return
    }

    const rowsToRemove = new Set<RowKey>()
    for (const acquisitionIndex of [...lease.acquisitions]) {
      const acquisition = model.acquisitions[acquisitionIndex]!
      const claim = acquisition.claims.get(leaseIndex)
      acquisition.leases.delete(leaseIndex)
      if (claim) {
        const scope = scopeKey(claim.sourceId, claim.prefix)
        const current = model.currentByScope.get(scope)
        if (
          current?.acquisition === acquisitionIndex &&
          current.lease === leaseIndex
        ) {
          restoreModelCurrent(model, scope)
        }
      }
      if (acquisition.leases.size === 0) {
        retireModelAcquisition(model, acquisitionIndex).forEach((row) =>
          rowsToRemove.add(row),
        )
      }
    }
    lease.active = false
    lease.acquisitions.clear()
    expect(real.registry.releaseLease(real.leases[leaseIndex]!)).toEqual({
      rowsToRemove: [...rowsToRemove].sort(),
    })
    assertRegistryModel(model, real)
  }

  toString = () => `releaseLease(${this.rawLease})`
}

class DisposeCommand implements Command<RegistryModel, RegistryReal> {
  check = () => true

  run(model: RegistryModel, real: RegistryReal): void {
    const releaseFailed = model.acquisitions
      .filter(({ active }) => active)
      .map(settleModelRelease)
      .some((settled) => !settled)
    if (releaseFailed) {
      expectReleaseFailure(() => real.registry.dispose())
      assertRegistryModel(model, real)
      return
    }

    const rowsToRemove = new Set<RowKey>()
    model.acquisitions.forEach((acquisition, index) => {
      if (!acquisition.active) return
      retireModelAcquisition(model, index).forEach((row) =>
        rowsToRemove.add(row),
      )
    })
    model.leases.forEach((lease) => {
      lease.active = false
      lease.acquisitions.clear()
    })
    expect(real.registry.dispose()).toEqual({
      rowsToRemove: [...rowsToRemove].sort(),
    })
    assertRegistryModel(model, real)
  }

  toString = () => `dispose()`
}

describe(`coverage registry oracle`, () => {
  it(`keeps caller-relative claims on one physical acquisition`, () => {
    const registry = createPrefixRegistry()
    const release = vi.fn()
    const first = registry.addLease(20)
    const second = registry.addLease(10)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [first],
      release,
      prefix: 20,
    })

    publishPrefix(registry, acquisition, 1, 20, [`a`, `b`])
    registry.attachLease(second, acquisition, {
      generation: 2,
      scope: {
        collectionId: `prefixes`,
        sourceId: `items`,
        demand: { limit: 10 },
      },
    })
    expect(
      registry.publishOutcome(
        acquisition,
        second,
        createPrefixOutcome(2, 10, `exhausted`, `prefixes`, `items`, [
          `a`,
          `b`,
        ]),
      ),
    ).toMatchObject({ accepted: true, published: true })

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

  it(`retains a released claim as dormant physical publication identity`, () => {
    const registry = createPrefixRegistry()
    const release = vi.fn()
    const physical = registry.addLease(20)
    const peer = registry.addLease(10)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [physical],
      release,
      prefix: 20,
    })
    registry.attachLease(peer, acquisition, {
      generation: 1,
      scope: {
        collectionId: `prefixes`,
        sourceId: `items`,
        demand: { limit: 10 },
      },
    })

    expect(registry.releaseLease(physical)).toEqual({ rowsToRemove: [] })
    expect(
      registry.publishOutcome(
        acquisition,
        physical,
        createPrefixOutcome(1, 20, `exhausted`, `prefixes`, `items`, [
          `a`,
          `b`,
        ]),
      ),
    ).toEqual({ accepted: true, published: true, rowsToRemove: [] })
    expect(registry.coverageAntichain()).toEqual([])
    expect(registry.rowOwnerCount(`a`)).toBe(1)

    expect(registry.releaseLease(peer)).toEqual({
      rowsToRemove: [`a`, `b`],
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it(`restores a compacted narrower fact when the wider acquisition retires`, () => {
    const registry = createPrefixRegistry()
    const narrowLease = registry.addLease(20)
    const wideLease = registry.addLease(100)
    const narrowAcquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [narrowLease],
      release: vi.fn(),
      prefix: 20,
    })
    const wideAcquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [wideLease],
      release: vi.fn(),
      prefix: 100,
    })

    publishPrefix(registry, narrowAcquisition, 1, 20)
    publishPrefix(registry, wideAcquisition, 1, 100)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 100 }])

    registry.releaseLease(wideLease)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 20 }])
    expect(registry.covers(20)).toBe(true)
    expect(registry.covers(21)).toBe(false)
  })

  it(`keeps shared rows through overlapping destructive snapshots and GC`, () => {
    const registry = createPrefixRegistry()
    const firstLease = registry.addLease(20)
    const secondLease = registry.addLease(20)
    const first = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [firstLease],
      release: vi.fn(),
      prefix: 20,
    })
    const second = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [secondLease],
      release: vi.fn(),
      prefix: 20,
      sourceId: `secondary`,
    })

    expect(registry.replaceRows(first, [`shared`, `first`])).toEqual({
      accepted: true,
      rowsToRemove: [],
    })
    expect(registry.replaceRows(second, [`shared`, `second`])).toEqual({
      accepted: true,
      rowsToRemove: [],
    })

    expect(registry.replaceRows(first, [])).toEqual({
      accepted: true,
      rowsToRemove: [`first`],
    })
    expect(registry.rowOwnerCount(`shared`)).toBe(1)

    expect(registry.releaseLease(secondLease)).toEqual({
      rowsToRemove: [`second`, `shared`],
    })
  })

  it(`keeps the last successful generation current while a newer attempt is pending`, () => {
    const registry = createPrefixRegistry()
    const priorLease = registry.addLease(1)
    const retryLease = registry.addLease(1)
    const prior = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [priorLease],
      release: vi.fn(),
      prefix: 1,
    })
    publishPrefix(registry, prior, 1, 1, [`prior`])

    const retry = addPrefixAcquisition(registry, {
      generation: 2,
      leases: [retryLease],
      release: vi.fn(),
      prefix: 1,
    })
    expect(registry.coverageAntichain()).toEqual([{ prefix: 1 }])
    expect(registry.rowOwnerCount(`prior`)).toBe(1)

    registry.releaseAcquisition(retry)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 1 }])
    expect(registry.rowOwnerCount(`prior`)).toBe(1)
  })

  it(`records unknown-extent row ownership without publishing coverage`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(1)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [lease],
      release: vi.fn(),
      prefix: 1,
    })

    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(1, 1, `unknown`, `prefixes`, `items`, [`owned`]),
      ),
    ).toEqual({ accepted: true, published: false, rowsToRemove: [] })
    expect(registry.coverageAntichain()).toEqual([])
    expect(registry.rowOwnerCount(`owned`)).toBe(1)
    expect(registry.releaseLease(lease)).toEqual({
      rowsToRemove: [`owned`],
    })
  })

  it(`keeps projected unknown evidence outside coverage while its lease owns the acquisition`, () => {
    const registry = createPrefixRegistry()
    const physical = registry.addLease(20)
    const satisfied = registry.addLease(10)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [physical],
      release: vi.fn(),
      prefix: 20,
    })
    publishPrefix(registry, acquisition, 1, 20, [`a`, `b`])
    const retainedOutcome = createPrefixOutcome(
      2,
      10,
      `unknown`,
      `prefixes`,
      `items`,
      [`a`, `b`],
    )

    registry.attachLease(satisfied, acquisition, {
      generation: 2,
      scope: {
        collectionId: `prefixes`,
        sourceId: `items`,
        demand: { limit: 10 },
      },
      retainedOutcome,
    })
    expect(registry.retainedOutcomeEvidence()).toEqual([retainedOutcome])

    expect(registry.releaseLease(physical)).toEqual({ rowsToRemove: [] })
    expect(registry.coverageAntichain()).toEqual([])
    expect(registry.covers(10)).toBe(false)
    expect(registry.retainedOutcomeEvidence()).toEqual([retainedOutcome])
    expect(registry.rowOwnerCount(`a`)).toBe(1)

    expect(registry.releaseLease(satisfied)).toEqual({
      rowsToRemove: [`a`, `b`],
    })
    expect(registry.retainedOutcomeEvidence()).toEqual([])
  })

  it(`keeps a final lease intact when adapter release throws and retries it`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(1)
    const releaseError = new Error(`release failed`)
    let shouldFail = true
    const release = vi.fn(() => {
      if (shouldFail) throw releaseError
    })
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [lease],
      release,
      prefix: 1,
    })
    publishPrefix(registry, acquisition, 1, 1, [`a`])

    let caught: unknown
    try {
      registry.releaseLease(lease)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(releaseError)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 1 }])
    expect(registry.rowOwnerCount(`a`)).toBe(1)

    shouldFail = false
    expect(registry.releaseLease(lease)).toEqual({ rowsToRemove: [`a`] })
    expect(release).toHaveBeenCalledTimes(2)
    expect(registry.releaseLease(lease)).toEqual({ rowsToRemove: [] })
    expect(release).toHaveBeenCalledTimes(2)
  })

  it(`keeps an acquisition intact when its direct release throws`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(1)
    const releaseError = new Error(`release failed`)
    let shouldFail = true
    const release = vi.fn(() => {
      if (shouldFail) throw releaseError
    })
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [lease],
      release,
      prefix: 1,
    })
    publishPrefix(registry, acquisition, 1, 1, [`a`])

    expect(() => registry.releaseAcquisition(acquisition)).toThrow(releaseError)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 1 }])
    expect(registry.rowOwnerCount(`a`)).toBe(1)

    shouldFail = false
    expect(registry.releaseAcquisition(acquisition)).toEqual({
      rowsToRemove: [`a`],
    })
    expect(release).toHaveBeenCalledTimes(2)
  })

  it(`keeps disposal atomic across successful and failed adapter releases`, () => {
    const registry = createPrefixRegistry()
    const firstLease = registry.addLease(1)
    const secondLease = registry.addLease(2)
    const firstRelease = vi.fn()
    const releaseError = new Error(`release failed`)
    let shouldFail = true
    const secondRelease = vi.fn(() => {
      if (shouldFail) throw releaseError
    })
    const first = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [firstLease],
      release: firstRelease,
      prefix: 1,
    })
    const second = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [secondLease],
      release: secondRelease,
      prefix: 2,
    })
    publishPrefix(registry, first, 1, 1, [`a`])
    publishPrefix(registry, second, 1, 2, [`b`])

    expect(() => registry.dispose()).toThrow(releaseError)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 2 }])
    expect(registry.rowOwnerCount(`a`)).toBe(1)
    expect(registry.rowOwnerCount(`b`)).toBe(1)

    shouldFail = false
    expect(registry.dispose()).toEqual({ rowsToRemove: [`a`, `b`] })
    expect(firstRelease).toHaveBeenCalledOnce()
    expect(secondRelease).toHaveBeenCalledTimes(2)
  })

  it(`does not attach a new lease to an acquisition whose release settled`, () => {
    const registry = createPrefixRegistry()
    const settledLease = registry.addLease(1)
    const failingLease = registry.addLease(2)
    const settled = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [settledLease],
      release: vi.fn(),
      prefix: 1,
    })
    let fail = true
    const failing = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [failingLease],
      release: () => {
        if (fail) throw new Error(`release failed`)
      },
      prefix: 2,
    })
    expect(() => registry.dispose()).toThrow(`release failed`)

    const lateLease = registry.addLease(1)
    expect(() => registry.attachLease(lateLease, settled)).toThrow(
      `Cannot attach to a released acquisition`,
    )
    expect(registry.replaceRows(settled, [`late`])).toEqual({
      accepted: false,
      rowsToRemove: [],
    })
    expect(
      registry.publishOutcome(
        settled,
        createPrefixOutcome(1, 1, `exhausted`, `prefixes`, `items`, [`late`]),
      ),
    ).toEqual({ accepted: false, published: false, rowsToRemove: [] })

    fail = false
    registry.releaseAcquisition(failing)
    registry.releaseLease(lateLease)
  })

  it(`publishes only current authoritative coverage projected from an applied outcome`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(20)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 2,
      leases: [lease],
      release: vi.fn(),
      prefix: 30,
    })

    expect(
      registry.publishOutcome(acquisition, createPrefixOutcome(1, 20)),
    ).toMatchObject({ accepted: false, published: false })
    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(2, 20, `unknown`),
      ),
    ).toMatchObject({ accepted: false, published: false })
    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(2, 20, `exhausted`, `other`),
      ),
    ).toMatchObject({ accepted: false, published: false })
    expect(registry.coverageAntichain()).toEqual([])

    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(
          2,
          30,
          `continues`,
          `prefixes`,
          `items`,
          Array.from({ length: 30 }, (_, index) => `row-${index}`),
        ),
      ),
    ).toMatchObject({ accepted: true, published: true })
    expect(registry.coverageAntichain()).toEqual([{ prefix: 30 }])
  })

  it(`does not derive a requested prefix from a rowless continuing result`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(30)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [lease],
      release: vi.fn(),
      prefix: 30,
    })

    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(1, 30, `continues`),
      ),
    ).toEqual({ accepted: true, published: false, rowsToRemove: [] })
    expect(registry.coverageAntichain()).toEqual([])

    const rows = Array.from({ length: 30 }, (_, index) => `row-${index}`)
    expect(
      registry.publishOutcome(
        acquisition,
        createPrefixOutcome(1, 30, `continues`, `prefixes`, `items`, rows),
      ),
    ).toEqual({ accepted: true, published: true, rowsToRemove: [] })
    expect(registry.rowOwnerCount(`row-0`)).toBe(1)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 30 }])
  })

  it(`rejects a late outcome from the old token after an exact-scope retry`, () => {
    const registry = createPrefixRegistry()
    const oldLease = registry.addLease(100)
    const nextLease = registry.addLease(100)
    const oldAcquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [oldLease],
      release: vi.fn(),
      prefix: 100,
    })
    const nextAcquisition = addPrefixAcquisition(registry, {
      generation: 2,
      leases: [nextLease],
      release: vi.fn(),
      prefix: 100,
    })

    expect(
      registry.publishOutcome(nextAcquisition, createPrefixOutcome(2, 100)),
    ).toMatchObject({ accepted: true, published: true })
    expect(
      registry.publishOutcome(oldAcquisition, createPrefixOutcome(1, 100)),
    ).toEqual({ accepted: false, published: false, rowsToRemove: [] })
    expect(registry.coverageAntichain()).toEqual([{ prefix: 100 }])
  })

  it(`returns defensive coverage snapshots`, () => {
    const registry = createPrefixRegistry()
    const lease = registry.addLease(20)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [lease],
      release: vi.fn(),
      prefix: 20,
    })
    publishPrefix(registry, acquisition, 1, 20)

    const fact = registry.coverageAntichain()[0]!
    try {
      ;(fact as { prefix: number }).prefix = 1_000
    } catch {
      // Frozen snapshots may reject mutation instead of ignoring it.
    }

    expect(registry.covers(1_000)).toBe(false)
    expect(registry.coverageAntichain()).toEqual([{ prefix: 20 }])
  })

  const rowSet = fc.uniqueArray(fc.constantFrom(...modelRows), {
    maxLength: modelRows.length,
  })
  const commandArbitraries = [
    fc.integer({ min: 1, max: 4 }).map((prefix) => new AddLeaseCommand(prefix)),
    fc
      .record({
        rawLease: fc.nat(),
        generation: fc.integer({ min: 1, max: 4 }),
        sourceSlot: fc.integer({ min: 0, max: 1 }),
        failFirstRelease: fc.boolean(),
      })
      .map(
        ({ rawLease, generation, sourceSlot, failFirstRelease }) =>
          new AddAcquisitionCommand(
            rawLease,
            generation,
            sourceSlot,
            failFirstRelease,
          ),
      ),
    fc
      .tuple(
        fc.nat(),
        fc.nat(),
        fc.option(
          fc.constantFrom<AppliedLoadSubsetOutcome[`extent`]>(
            `unknown`,
            `continues`,
            `exhausted`,
          ),
          { nil: undefined },
        ),
      )
      .map(
        ([lease, acquisition, retainedExtent]) =>
          new AttachLeaseCommand(lease, acquisition, retainedExtent),
      ),
    fc.nat().map((acquisition) => new RetryAcquisitionCommand(acquisition)),
    fc
      .tuple(fc.nat(), rowSet)
      .map(([acquisition, rows]) => new ReplaceRowsCommand(acquisition, rows)),
    fc
      .record({
        acquisition: fc.nat(),
        rows: rowSet,
        generationDelta: fc.integer({ min: -1, max: 1 }),
        exactScope: fc.boolean(),
        extent: fc.constantFrom<AppliedLoadSubsetOutcome[`extent`]>(
          `unknown`,
          `continues`,
          `exhausted`,
        ),
      })
      .map(
        ({ acquisition, rows, generationDelta, exactScope, extent }) =>
          new PublishCommand(
            acquisition,
            rows,
            generationDelta,
            exactScope,
            extent,
          ),
      ),
    fc.nat().map((acquisition) => new ReleaseAcquisitionCommand(acquisition)),
    fc.nat().map((lease) => new ReleaseLeaseCommand(lease)),
    fc.constant(new DisposeCommand()),
  ]

  fcTest.prop(
    [
      fc.commands<RegistryModel, RegistryReal>(commandArbitraries, {
        maxCommands: 40,
      }),
    ],
    oraclePropertyOptions(100),
  )(
    `matches the lease, retry, settlement, publication, ownership, and disposal state machine`,
    (commands) => {
      fc.modelRun(
        () => ({
          model: {
            leases: [],
            acquisitions: [],
            currentByScope: new Map(),
            claimSequence: 0,
          },
          real: {
            registry: createPrefixRegistry(),
            leases: [],
            acquisitions: [],
            releases: [],
          },
        }),
        commands,
      )
    },
  )
})
