import type { AppliedLoadSubsetOutcome } from '../types.js'

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

type LeaseRecord<TDemand> = {
  demand: TDemand
  acquisitions: Set<AcquisitionToken>
}

type AcquisitionRecord<TCoverage, TRowKey extends string | number> = {
  sequence: number
  generation: number
  leases: Set<DemandLease<unknown>>
  release: () => void
  rows: Set<TRowKey>
  coverage: TCoverage | undefined
}

export type CoverageRegistryOptions<TDemand, TCoverage> = {
  coversDemand: (coverage: TCoverage, demand: TDemand) => boolean
  coversCoverage: (coverage: TCoverage, candidate: TCoverage) => boolean
  /**
   * Projects an exact applied source fact into the registry's coverage
   * domain. Return undefined when that fact cannot prove coverage.
   */
  projectAppliedCoverage: (
    outcome: AuthoritativeAppliedLoadSubsetOutcome,
  ) => TCoverage | undefined
}

export type RowOwnershipUpdate<TRowKey extends string | number> = {
  accepted: boolean
  rowsToRemove: Array<TRowKey>
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
  private readonly projectAppliedCoverage: (
    outcome: AuthoritativeAppliedLoadSubsetOutcome,
  ) => TCoverage | undefined
  private readonly leases = new Map<
    DemandLease<TDemand>,
    LeaseRecord<TDemand>
  >()
  private readonly acquisitions = new Map<
    AcquisitionToken,
    AcquisitionRecord<TCoverage, TRowKey>
  >()
  private readonly rowOwners = new Map<TRowKey, Set<AcquisitionToken>>()
  private acquisitionSequence = 0

  constructor(options: CoverageRegistryOptions<TDemand, TCoverage>) {
    this.coversDemand = options.coversDemand
    this.coversCoverage = options.coversCoverage
    this.projectAppliedCoverage = options.projectAppliedCoverage
  }

  addLease(demand: TDemand): DemandLease<TDemand> {
    const lease = { [demandLeaseBrand]: demand } as DemandLease<TDemand>
    this.leases.set(lease, { demand, acquisitions: new Set() })
    return lease
  }

  addAcquisition(options: {
    generation: number
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
    this.acquisitions.set(acquisition, {
      sequence: this.acquisitionSequence++,
      generation: options.generation,
      leases: new Set(options.leases as ReadonlyArray<DemandLease<unknown>>),
      release: options.release,
      rows: new Set(),
      coverage: undefined,
    })
    leaseRecords.forEach((record) => record.acquisitions.add(acquisition))
    return acquisition
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
  ): boolean {
    const record = this.acquisitions.get(acquisition)
    if (
      !record ||
      record.generation !== outcome.generation ||
      !hasAuthoritativeExtent(outcome)
    ) {
      return false
    }

    const coverage = this.projectAppliedCoverage(outcome)
    if (coverage === undefined) return false

    record.coverage = coverage
    return true
  }

  replaceRows(
    acquisition: AcquisitionToken,
    generation: number,
    rows: Iterable<TRowKey>,
  ): RowOwnershipUpdate<TRowKey> {
    const record = this.acquisitions.get(acquisition)
    if (!record || record.generation !== generation) {
      return { accepted: false, rowsToRemove: [] }
    }

    const nextRows = new Set(rows)
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
    return { accepted: true, rowsToRemove: sortKeys(rowsToRemove) }
  }

  covers(demand: TDemand): boolean {
    return this.coverageAntichain().some((coverage) =>
      this.coversDemand(coverage, demand),
    )
  }

  coverageAntichain(): Array<TCoverage> {
    const facts = Array.from(this.acquisitions.values()).filter(
      (
        record,
      ): record is AcquisitionRecord<TCoverage, TRowKey> & {
        coverage: TCoverage
      } => record.coverage !== undefined,
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
      .map(({ coverage }) => coverage)
  }

  rowOwnerCount(row: TRowKey): number {
    return this.rowOwners.get(row)?.size ?? 0
  }

  releaseLease(lease: DemandLease<TDemand>): ReleaseResult<TRowKey> {
    const leaseRecord = this.leases.get(lease)
    if (!leaseRecord) return { rowsToRemove: [] }

    this.leases.delete(lease)
    const rowsToRemove = new Set<TRowKey>()
    const releaseErrors: Array<unknown> = []
    for (const acquisition of leaseRecord.acquisitions) {
      const record = this.acquisitions.get(acquisition)
      if (!record) continue
      record.leases.delete(lease as DemandLease<unknown>)
      if (record.leases.size === 0) {
        this.retireAcquisition(acquisition, rowsToRemove, releaseErrors)
      }
    }
    throwReleaseErrors(releaseErrors)
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  releaseAcquisition(acquisition: AcquisitionToken): ReleaseResult<TRowKey> {
    const rowsToRemove = new Set<TRowKey>()
    const releaseErrors: Array<unknown> = []
    this.retireAcquisition(acquisition, rowsToRemove, releaseErrors)
    throwReleaseErrors(releaseErrors)
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  dispose(): ReleaseResult<TRowKey> {
    const rowsToRemove = new Set<TRowKey>()
    const releaseErrors: Array<unknown> = []
    for (const acquisition of Array.from(this.acquisitions.keys())) {
      this.retireAcquisition(acquisition, rowsToRemove, releaseErrors)
    }
    this.leases.clear()
    throwReleaseErrors(releaseErrors)
    return { rowsToRemove: sortKeys(rowsToRemove) }
  }

  private retireAcquisition(
    acquisition: AcquisitionToken,
    rowsToRemove: Set<TRowKey>,
    releaseErrors: Array<unknown>,
  ): void {
    const record = this.acquisitions.get(acquisition)
    if (!record) return

    // Retire first. A throwing release callback cannot make a later cleanup
    // invoke the same physical release twice.
    this.acquisitions.delete(acquisition)
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

    try {
      record.release()
    } catch (error) {
      releaseErrors.push(error)
    }
  }
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
