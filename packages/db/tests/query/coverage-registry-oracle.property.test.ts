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

type ModelAcquisition = {
  active: boolean
  generation: number
  prefix: Prefix
  sourceId: string
  leases: Set<number>
  rows: Set<RowKey>
  coverage: Prefix | undefined
  releaseCalls: number
  releaseFailuresRemaining: number
  releaseSettled: boolean
}

type RegistryModel = {
  leases: Array<ModelLease>
  acquisitions: Array<ModelAcquisition>
  currentByScope: Map<string, number>
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
    rows: new Set(),
    coverage: undefined,
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
): boolean {
  const acquisition = model.acquisitions[acquisitionIndex]!
  if (!acquisition.active || acquisition.releaseSettled) return false
  const currentIndex = model.currentByScope.get(
    scopeKey(acquisition.sourceId, acquisition.prefix),
  )
  if (currentIndex === undefined || currentIndex === acquisitionIndex) {
    return true
  }
  return acquisition.generation > model.acquisitions[currentIndex]!.generation
}

function restoreModelCurrent(model: RegistryModel, scope: string): void {
  const candidate = model.acquisitions
    .map((acquisition, index) => ({ acquisition, index }))
    .filter(
      ({ acquisition }) =>
        acquisition.active &&
        !acquisition.releaseSettled &&
        acquisition.coverage !== undefined &&
        scopeKey(acquisition.sourceId, acquisition.prefix) === scope,
    )
    .sort(({ acquisition: left, index: leftIndex }, right) =>
      left.generation === right.acquisition.generation
        ? right.index - leftIndex
        : right.acquisition.generation - left.generation,
    )[0]

  if (candidate) model.currentByScope.set(scope, candidate.index)
  else model.currentByScope.delete(scope)
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
  acquisition.coverage = undefined
  for (const leaseIndex of acquisition.leases) {
    model.leases[leaseIndex]?.acquisitions.delete(acquisitionIndex)
  }
  const scope = scopeKey(acquisition.sourceId, acquisition.prefix)
  if (model.currentByScope.get(scope) === acquisitionIndex) {
    restoreModelCurrent(model, scope)
  }
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
  const activeCoverage = model.acquisitions.flatMap((acquisition, index) =>
    acquisition.active &&
    acquisition.coverage !== undefined &&
    model.currentByScope.get(
      scopeKey(acquisition.sourceId, acquisition.prefix),
    ) === index
      ? [acquisition.coverage]
      : [],
  )
  expect(real.registry.coverageAntichain()).toEqual(
    activeCoverage.length === 0
      ? []
      : [{ prefix: Math.max(...activeCoverage) }],
  )
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
      model.leases[leaseIndex]!.acquisitions.add(acquisitionIndex)
      acquisition.leases.add(leaseIndex)
      real.registry.attachLease(
        real.leases[leaseIndex]!,
        real.acquisitions[acquisitionIndex]!,
      )
    }
    assertRegistryModel(model, real)
  }

  toString = () =>
    `attachLease(lease=${this.rawLease}, acquisition=${this.rawAcquisition})`
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
    const release = createReleaseProbe(false)
    addModelAcquisition(model, {
      generation: old.generation + 1,
      prefix: old.prefix,
      sourceId: old.sourceId,
      leaseIndex,
      failFirstRelease: false,
    })
    real.acquisitions.push(
      addPrefixAcquisition(real.registry, {
        generation: old.generation + 1,
        leases: [real.leases[leaseIndex]!],
        release: () => release.release(),
        prefix: old.prefix,
        sourceId: old.sourceId,
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
    const accepted = canPublishModelAcquisition(model, acquisitionIndex)
    const rowsToRemove = accepted
      ? replaceModelRows(model, acquisitionIndex, new Set(this.rows))
      : []
    if (accepted) {
      acquisition.coverage = undefined
      const scope = scopeKey(acquisition.sourceId, acquisition.prefix)
      if (model.currentByScope.get(scope) === acquisitionIndex) {
        restoreModelCurrent(model, scope)
      }
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
    const outcome = createPrefixOutcome(
      acquisition.generation + this.generationDelta,
      acquisition.prefix,
      this.extent,
      this.exactScope ? `prefixes` : `other`,
      acquisition.sourceId,
      this.rows,
    )
    const accepted =
      canPublishModelAcquisition(model, acquisitionIndex) &&
      this.generationDelta === 0 &&
      this.exactScope
    const rowsToRemove = accepted
      ? replaceModelRows(model, acquisitionIndex, new Set(this.rows))
      : []
    const published =
      accepted &&
      (this.rows.length >= acquisition.prefix || this.extent === `exhausted`)
    if (accepted) {
      acquisition.coverage = published ? acquisition.prefix : undefined
      const scope = scopeKey(acquisition.sourceId, acquisition.prefix)
      if (published) {
        model.currentByScope.set(scope, acquisitionIndex)
      } else if (model.currentByScope.get(scope) === acquisitionIndex) {
        restoreModelCurrent(model, scope)
      }
    }
    expect(
      real.registry.publishOutcome(
        real.acquisitions[acquisitionIndex]!,
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
      acquisition.leases.delete(leaseIndex)
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
  it(`shares one physical acquisition until its final demand lease releases`, () => {
    const registry = createPrefixRegistry()
    const release = vi.fn()
    const first = registry.addLease(20)
    const second = registry.addLease(10)
    const acquisition = addPrefixAcquisition(registry, {
      generation: 1,
      leases: [first, second],
      release,
      prefix: 20,
    })

    publishPrefix(registry, acquisition, 1, 20, [`a`, `b`])

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
      .tuple(fc.nat(), fc.nat())
      .map(
        ([lease, acquisition]) => new AttachLeaseCommand(lease, acquisition),
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
