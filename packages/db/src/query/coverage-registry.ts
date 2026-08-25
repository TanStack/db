import { getLoadSubsetDemandKey } from './ir-stable-identity.js'
import { snapshotLoadSubsetDemand } from './load-subset-options.js'
import type { AppliedLoadSubsetOutcome, LoadSubsetOptions } from '../types.js'

const demandLeaseBrand: unique symbol = Symbol(`DemandLease`)
const acquisitionTokenBrand: unique symbol = Symbol(`AcquisitionToken`)

export type DemandLease<TDemand> = {
  readonly [demandLeaseBrand]: TDemand
}

export type AcquisitionToken = {
  readonly [acquisitionTokenBrand]: true
}

export type AuthoritativeAppliedLoadSubsetOutcome = AppliedLoadSubsetOutcome & {
  extent: Exclude<AppliedLoadSubsetOutcome['extent'], `unknown`>
}

export type AppliedLoadSubsetCoverage<TRowKey extends string | number> =
  Readonly<{
    collectionId: string
    sourceId?: string
    demand: LoadSubsetOptions
    extent: AuthoritativeAppliedLoadSubsetOutcome['extent']
    rowKeys: ReadonlyArray<TRowKey>
  }>

type LeaseRecord<TDemand> = {
  demand: TDemand
  acquisitions: Set<AcquisitionToken>
}

type AcquisitionRecord<TCoverage, TRowKey extends string | number> = {
  sequence: number
  generation: number
  scopeKey: string
  scope: {
    collectionId: string
    sourceId: string | undefined
    demandKey: string | undefined
  }
  leases: Set<DemandLease<unknown>>
  release: () => void
  releaseSettled: boolean
  rows: Set<TRowKey>
  coverage: TCoverage | undefined
}

export type CoverageRegistryOptions<TDemand, TCoverage> = {
  coversDemand: (coverage: TCoverage, demand: TDemand) => boolean
  coversCoverage: (coverage: TCoverage, candidate: TCoverage) => boolean
  /** Takes a defensive snapshot for storage and every public read. */
  snapshotCoverage: (coverage: TCoverage) => TCoverage
  /**
   * Projects an exact applied source fact into the registry's coverage
   * domain. Return undefined when that fact cannot prove coverage.
   */
  projectAppliedCoverage: (evidence: {
    outcome: AuthoritativeAppliedLoadSubsetOutcome
    rows: ReadonlySet<string | number>
  }) => TCoverage | undefined
}

export type RowOwnershipUpdate<TRowKey extends string | number> = {
  accepted: boolean
  rowsToRemove: Array<TRowKey>
}

export type CoveragePublicationResult<TRowKey extends string | number> =
  RowOwnershipUpdate<TRowKey> & {
    published: boolean
  }

export type ReleaseResult<TRowKey extends string | number> = {
  rowsToRemove: Array<TRowKey>
}

/**
 * Keeps logical demand, physical adapter resources, achieved coverage, and row
 * provenance separate. Coverage compaction is a derived antichain over active
 * facts, so it cannot erase the leases or acquisitions needed to restore a
 * narrower fact later.
 */
export class CoverageRegistry<
  TDemand,
  TCoverage,
  TRowKey extends string | number,
> {
  private readonly coversDemand: (
    coverage: TCoverage,
    demand: TDemand,
  ) => boolean
  private readonly coversCoverage: (
    coverage: TCoverage,
    candidate: TCoverage,
  ) => boolean
  private readonly projectAppliedCoverage: (evidence: {
    outcome: AuthoritativeAppliedLoadSubsetOutcome
    rows: ReadonlySet<string | number>
  }) => TCoverage | undefined
  private readonly snapshotCoverage: (coverage: TCoverage) => TCoverage
  private readonly leases = new Map<
    DemandLease<TDemand>,
    LeaseRecord<TDemand>
  >()
  private readonly acquisitions = new Map<
    AcquisitionToken,
    AcquisitionRecord<TCoverage, TRowKey>
  >()
  private readonly rowOwners = new Map<TRowKey, Set<AcquisitionToken>>()
  private readonly currentAcquisitions = new Map<
    string,
    { acquisition: AcquisitionToken; generation: number }
  >()
  private acquisitionSequence = 0

  constructor(options: CoverageRegistryOptions<TDemand, TCoverage>) {
    this.coversDemand = options.coversDemand
    this.coversCoverage = options.coversCoverage
    this.projectAppliedCoverage = options.projectAppliedCoverage
    this.snapshotCoverage = options.snapshotCoverage
  }

  addLease(demand: TDemand): DemandLease<TDemand> {
    const lease = { [demandLeaseBrand]: demand } as DemandLease<TDemand>
    this.leases.set(lease, { demand, acquisitions: new Set() })
    return lease
  }

  addAcquisition(options: {
    generation: number
    scope: {
      collectionId: string
      sourceId?: string
      demand: LoadSubsetOptions
    }
    leases: ReadonlyArray<DemandLease<TDemand>>
    release: () => void
  }): AcquisitionToken {
    if (options.leases.length === 0) {
      throw new Error(`A physical acquisition must have a demand lease`)
    }

    const leaseRecords = options.leases.map((lease) => {
      const record = this.leases.get(lease)
      if (!record) throw new Error(`Cannot attach an inactive demand lease`)
      return record
    })
    const acquisition = {
      [acquisitionTokenBrand]: true,
    } as AcquisitionToken
    const demand = snapshotLoadSubsetDemand(options.scope.demand)
    const demandKey = getLoadSubsetDemandKey(demand)
    const scopeKey = createScopeKey(
      options.scope.collectionId,
      options.scope.sourceId,
      demandKey,
    )
    this.acquisitions.set(acquisition, {
      sequence: this.acquisitionSequence++,
      generation: options.generation,
      scopeKey,
      scope: {
        collectionId: options.scope.collectionId,
        sourceId: options.scope.sourceId,
        demandKey,
      },
      leases: new Set(options.leases as ReadonlyArray<DemandLease<unknown>>),
      release: options.release,
      releaseSettled: false,
      rows: new Set(),
      coverage: undefined,
    })
    leaseRecords.forEach((record) => record.acquisitions.add(acquisition))
    return acquisition
  }

  isAcquisitionAttachable(acquisition: AcquisitionToken): boolean {
    const record = this.acquisitions.get(acquisition)
    return record !== undefined && !record.releaseSettled
  }

  attachLease(
    lease: DemandLease<TDemand>,
    acquisition: AcquisitionToken,
  ): void {
    const leaseRecord = this.leases.get(lease)
    const acquisitionRecord = this.acquisitions.get(acquisition)
    if (!leaseRecord) throw new Error(`Cannot attach an inactive demand lease`)
    if (!acquisitionRecord) {
      throw new Error(`Cannot attach to an inactive acquisition`)
    }
    if (acquisitionRecord.releaseSettled) {
      throw new Error(`Cannot attach to a released acquisition`)
    }

    leaseRecord.acquisitions.add(acquisition)
    acquisitionRecord.leases.add(lease as DemandLease<unknown>)
  }

  /**
   * Publishes only coverage proved by an exact, applied source outcome.
   * Unknown source extent is request state, not achieved coverage.
   */
  publishOutcome(
    acquisition: AcquisitionToken,
    outcome: AppliedLoadSubsetOutcome,
  ): CoveragePublicationResult<TRowKey> {
    const record = this.acquisitions.get(acquisition)
    if (
      !record ||
      record.releaseSettled ||
      !this.canPublish(acquisition, record) ||
      !matchesOutcome(record, outcome) ||
      outcome.appliedRowKeys === undefined
    ) {
      return { accepted: false, published: false, rowsToRemove: [] }
    }

    const nextRows = new Set(outcome.appliedRowKeys as ReadonlyArray<TRowKey>)
    const coverage = hasAuthoritativeExtent(outcome)
      ? this.projectAppliedCoverage({ outcome, rows: nextRows })
      : undefined
    const nextCoverage =
      coverage === undefined ? undefined : this.snapshotCoverage(coverage)
    const rowsToRemove = this.replaceRowsForRecord(
      acquisition,
      record,
      nextRows,
    )
    record.coverage = nextCoverage

    if (nextCoverage !== undefined) {
      this.currentAcquisitions.set(record.scopeKey, {
        acquisition,
        generation: record.generation,
      })
    } else {
      const current = this.currentAcquisitions.get(record.scopeKey)
      if (current?.acquisition === acquisition) {
        this.restoreCurrentAcquisition(record.scopeKey)
      }
    }

    return {
      accepted: true,
      published: nextCoverage !== undefined,
      rowsToRemove,
    }
  }

  replaceRows(
    acquisition: AcquisitionToken,
    rows: Iterable<TRowKey>,
  ): RowOwnershipUpdate<TRowKey> {
    const record = this.acquisitions.get(acquisition)
    if (
      !record ||
      record.releaseSettled ||
      !this.canPublish(acquisition, record)
    ) {
      return { accepted: false, rowsToRemove: [] }
    }

    const nextRows = new Set(rows)
    record.coverage = undefined
    const current = this.currentAcquisitions.get(record.scopeKey)
    if (current?.acquisition === acquisition) {
      this.restoreCurrentAcquisition(record.scopeKey)
    }
    return {
      accepted: true,
      rowsToRemove: this.replaceRowsForRecord(acquisition, record, nextRows),
    }
  }

  private replaceRowsForRecord(
    acquisition: AcquisitionToken,
    record: AcquisitionRecord<TCoverage, TRowKey>,
    nextRows: Set<TRowKey>,
  ): Array<TRowKey> {
    const rowsToRemove = new Set<TRowKey>()
    for (const row of record.rows) {
      if (nextRows.has(row)) continue
      const owners = this.rowOwners.get(row)
      owners?.delete(acquisition)
      if (!owners?.size) {
        this.rowOwners.delete(row)
        rowsToRemove.add(row)
      }
    }
    for (const row of nextRows) {
      const owners = this.rowOwners.get(row) ?? new Set<AcquisitionToken>()
      owners.add(acquisition)
      this.rowOwners.set(row, owners)
    }
    record.rows = nextRows
    return sortKeys(rowsToRemove)
  }

  private canPublish(
    acquisition: AcquisitionToken,
    record: AcquisitionRecord<TCoverage, TRowKey>,
  ): boolean {
    const current = this.currentAcquisitions.get(record.scopeKey)
    return (
      current === undefined ||
      current.acquisition === acquisition ||
      record.generation > current.generation
    )
  }

  private isCurrent(
    acquisition: AcquisitionToken,
    record: AcquisitionRecord<TCoverage, TRowKey>,
  ): boolean {
    return (
      this.currentAcquisitions.get(record.scopeKey)?.acquisition === acquisition
    )
  }

  covers(demand: TDemand): boolean {
    return this.coverageAntichain().some((coverage) =>
      this.coversDemand(coverage, demand),
    )
  }

  coverageAntichain(): Array<TCoverage> {
    const facts = Array.from(this.acquisitions.entries()).flatMap(
      ([acquisition, record]) =>
        record.coverage !== undefined && this.isCurrent(acquisition, record)
          ? [
              record as AcquisitionRecord<TCoverage, TRowKey> & {
                coverage: TCoverage
              },
            ]
          : [],
    )

    return facts
      .filter((candidate) =>
        facts.every((covering) => {
          if (candidate === covering) return true
          if (!this.coversCoverage(covering.coverage, candidate.coverage)) {
            return true
          }

          // Equivalent facts retain the oldest stable representative. Strictly
          // stronger facts dominate regardless of publication order.
          const equivalent = this.coversCoverage(
            candidate.coverage,
            covering.coverage,
          )
          return equivalent && candidate.sequence < covering.sequence
        }),
      )
      .map(({ coverage }) => this.snapshotCoverage(coverage))
  }

  rowOwnerCount(row: TRowKey): number {
    return this.rowOwners.get(row)?.size ?? 0
  }

  releaseLease(lease: DemandLease<TDemand>): ReleaseResult<TRowKey> {
    const leaseRecord = this.leases.get(lease)
    if (!leaseRecord) return { rowsToRemove: [] }

    const acquisitions = Array.from(leaseRecord.acquisitions)
    const finalAcquisitions = acquisitions.filter((acquisition) => {
      const record = this.acquisitions.get(acquisition)
      return record?.leases.size === 1 && record.leases.has(lease)
    })
    const releaseErrors: Array<unknown> = []
    this.settleReleases(finalAcquisitions, releaseErrors)
    // A failed adapter cleanup leaves the logical graph unchanged. A later
    // release retries only callbacks that did not settle successfully.
    throwReleaseErrors(releaseErrors)

    const rowsToRemove = new Set<TRowKey>()
    for (const acquisition of acquisitions) {
      const record = this.acquisitions.get(acquisition)
      if (!record) continue
      record.leases.delete(lease as DemandLease<unknown>)
      leaseRecord.acquisitions.delete(acquisition)
      if (record.leases.size === 0) {
        this.retireAcquisitionState(acquisition, rowsToRemove)
      }
    }
    this.leases.delete(lease)
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  releaseAcquisition(acquisition: AcquisitionToken): ReleaseResult<TRowKey> {
    if (!this.acquisitions.has(acquisition)) return { rowsToRemove: [] }
    const releaseErrors: Array<unknown> = []
    this.settleReleases([acquisition], releaseErrors)
    throwReleaseErrors(releaseErrors)

    const rowsToRemove = new Set<TRowKey>()
    this.retireAcquisitionState(acquisition, rowsToRemove)
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  dispose(): ReleaseResult<TRowKey> {
    const acquisitions = Array.from(this.acquisitions.keys())
    const releaseErrors: Array<unknown> = []
    this.settleReleases(acquisitions, releaseErrors)
    // Keep every logical owner intact until all physical cleanup callbacks
    // settle. This preserves the full GC result for the successful retry.
    throwReleaseErrors(releaseErrors)

    const rowsToRemove = new Set<TRowKey>()
    for (const acquisition of acquisitions) {
      this.retireAcquisitionState(acquisition, rowsToRemove)
    }
    this.leases.clear()
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  private settleReleases(
    acquisitions: ReadonlyArray<AcquisitionToken>,
    releaseErrors: Array<unknown>,
  ): void {
    for (const acquisition of acquisitions) {
      const record = this.acquisitions.get(acquisition)
      if (!record || record.releaseSettled) continue
      try {
        record.release()
        record.releaseSettled = true
      } catch (error) {
        releaseErrors.push(error)
      }
    }
  }

  private retireAcquisitionState(
    acquisition: AcquisitionToken,
    rowsToRemove: Set<TRowKey>,
  ): void {
    const record = this.acquisitions.get(acquisition)
    if (!record) return

    this.acquisitions.delete(acquisition)
    const current = this.currentAcquisitions.get(record.scopeKey)
    if (current?.acquisition === acquisition) {
      this.restoreCurrentAcquisition(record.scopeKey)
    }
    for (const lease of record.leases) {
      this.leases
        .get(lease as DemandLease<TDemand>)
        ?.acquisitions.delete(acquisition)
    }
    for (const row of record.rows) {
      const owners = this.rowOwners.get(row)
      owners?.delete(acquisition)
      if (!owners?.size) {
        this.rowOwners.delete(row)
        rowsToRemove.add(row)
      }
    }
  }

  private restoreCurrentAcquisition(scopeKey: string): void {
    const candidate = Array.from(this.acquisitions.entries())
      .filter(
        ([, record]) =>
          record.scopeKey === scopeKey &&
          record.coverage !== undefined &&
          !record.releaseSettled,
      )
      .sort(([, left], [, right]) =>
        left.generation === right.generation
          ? right.sequence - left.sequence
          : right.generation - left.generation,
      )[0]

    if (candidate) {
      this.currentAcquisitions.set(scopeKey, {
        acquisition: candidate[0],
        generation: candidate[1].generation,
      })
    } else {
      this.currentAcquisitions.delete(scopeKey)
    }
  }
}

/**
 * Creates the conservative production registry used at the collection source
 * boundary. It publishes only exact demand facts backed by acquisition-owned
 * applied row keys.
 */
export function createLoadSubsetCoverageRegistry<
  TRowKey extends string | number,
>(): CoverageRegistry<
  LoadSubsetOptions,
  AppliedLoadSubsetCoverage<TRowKey>,
  TRowKey
> {
  return new CoverageRegistry({
    coversDemand: (coverage, demand) =>
      getLoadSubsetDemandKey(coverage.demand) ===
      getLoadSubsetDemandKey(demand),
    coversCoverage: (coverage, candidate) =>
      coverage.collectionId === candidate.collectionId &&
      coverage.sourceId === candidate.sourceId &&
      getLoadSubsetDemandKey(coverage.demand) ===
        getLoadSubsetDemandKey(candidate.demand),
    snapshotCoverage: snapshotAppliedCoverage,
    projectAppliedCoverage: ({ outcome, rows }) => {
      const limit = outcome.demand.limit
      if (limit === undefined) {
        if (outcome.extent !== `exhausted`) return undefined
      } else if (rows.size < limit && outcome.extent !== `exhausted`) {
        return undefined
      }

      return {
        collectionId: outcome.collectionId,
        ...(outcome.sourceId === undefined
          ? {}
          : { sourceId: outcome.sourceId }),
        demand: snapshotLoadSubsetDemand(outcome.demand),
        extent: outcome.extent,
        rowKeys: [...rows] as Array<TRowKey>,
      }
    },
  })
}

function snapshotAppliedCoverage<TRowKey extends string | number>(
  coverage: AppliedLoadSubsetCoverage<TRowKey>,
): AppliedLoadSubsetCoverage<TRowKey> {
  return Object.freeze({
    collectionId: coverage.collectionId,
    ...(coverage.sourceId === undefined ? {} : { sourceId: coverage.sourceId }),
    demand: snapshotLoadSubsetDemand(coverage.demand),
    extent: coverage.extent,
    rowKeys: Object.freeze([...coverage.rowKeys]),
  })
}

function createScopeKey(
  collectionId: string,
  sourceId: string | undefined,
  demandKey: string | undefined,
): string {
  return JSON.stringify([collectionId, sourceId ?? null, demandKey ?? null])
}

function matchesOutcome<TCoverage, TRowKey extends string | number>(
  record: AcquisitionRecord<TCoverage, TRowKey>,
  outcome: AppliedLoadSubsetOutcome,
): boolean {
  return (
    record.generation === outcome.generation &&
    record.scope.collectionId === outcome.collectionId &&
    record.scope.sourceId === outcome.sourceId &&
    record.scope.demandKey === getLoadSubsetDemandKey(outcome.demand)
  )
}

function hasAuthoritativeExtent(
  outcome: AppliedLoadSubsetOutcome,
): outcome is AuthoritativeAppliedLoadSubsetOutcome {
  return outcome.extent !== `unknown`
}

function sortKeys<TKey extends string | number>(
  keys: Iterable<TKey>,
): Array<TKey> {
  return Array.from(keys).sort((left, right) => {
    if (typeof left === `number` && typeof right === `number`) {
      return left - right
    }
    if (typeof left === `number`) return -1
    if (typeof right === `number`) return 1
    return left.localeCompare(right)
  })
}

function throwReleaseErrors(errors: Array<unknown>): void {
  if (errors.length === 0) return
  if (errors.length === 1) throw errors[0]
  throw new AggregateError(errors, `Several acquisition releases failed`)
}
