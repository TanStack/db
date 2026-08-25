import { getLoadSubsetDemandKey } from './ir-stable-identity.js'
import { snapshotLoadSubsetDemand } from './load-subset-options.js'
import { isLoadSubsetRequestSubsumedBy } from './predicate-utils.js'
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
  leases: Set<DemandLease<unknown>>
  claims: Map<DemandLease<unknown>, CoverageClaim<TCoverage>>
  release: () => void
  releaseSettled: boolean
  rows: Set<TRowKey>
}

type CoverageClaim<TCoverage> = {
  sequence: number
  generation: number
  scopeKey: string
  scope: {
    collectionId: string
    sourceId: string | undefined
    demandKey: string | undefined
  }
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
    {
      acquisition: AcquisitionToken
      lease: DemandLease<unknown>
      generation: number
    }
  >()
  private claimSequence = 0

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
    const claim = this.createClaim(options.generation, options.scope)
    this.acquisitions.set(acquisition, {
      leases: new Set(options.leases as ReadonlyArray<DemandLease<unknown>>),
      claims: new Map(
        options.leases.map((lease) => [
          lease as DemandLease<unknown>,
          { ...claim, sequence: this.claimSequence++ },
        ]),
      ),
      release: options.release,
      releaseSettled: false,
      rows: new Set(),
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
    options?: {
      generation: number
      scope: {
        collectionId: string
        sourceId?: string
        demand: LoadSubsetOptions
      }
      coverage?: TCoverage
    },
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
    if (acquisitionRecord.leases.has(lease as DemandLease<unknown>)) return

    leaseRecord.acquisitions.add(acquisition)
    acquisitionRecord.leases.add(lease as DemandLease<unknown>)
    const fallback = acquisitionRecord.claims.values().next().value
    const claim = options
      ? this.createClaim(options.generation, options.scope)
      : fallback
        ? {
            generation: fallback.generation,
            scopeKey: fallback.scopeKey,
            scope: fallback.scope,
            coverage: undefined,
          }
        : undefined
    if (!claim) throw new Error(`Cannot attach to an unscoped acquisition`)
    acquisitionRecord.claims.set(lease as DemandLease<unknown>, {
      ...claim,
      sequence: this.claimSequence++,
      coverage:
        options?.coverage === undefined
          ? undefined
          : this.snapshotCoverage(options.coverage),
    })
    if (options?.coverage !== undefined) {
      this.restoreCurrentAcquisition(claim.scopeKey)
    }
  }

  coveringAcquisitions(demand: TDemand): Array<{
    acquisition: AcquisitionToken
    coverage: TCoverage
    generation: number
  }> {
    return this.currentCoverageClaims().flatMap(
      ({ acquisition, record, claim }) =>
        !record.releaseSettled &&
        claim.coverage !== undefined &&
        this.coversDemand(claim.coverage, demand)
          ? [
              {
                acquisition,
                coverage: this.snapshotCoverage(claim.coverage),
                generation: claim.generation,
              },
            ]
          : [],
    )
  }

  /**
   * Publishes only coverage proved by an exact, applied source outcome.
   * Unknown source extent is request state, not achieved coverage.
   */
  publishOutcome(
    acquisition: AcquisitionToken,
    outcome: AppliedLoadSubsetOutcome,
  ): CoveragePublicationResult<TRowKey>
  publishOutcome(
    acquisition: AcquisitionToken,
    lease: DemandLease<TDemand>,
    outcome: AppliedLoadSubsetOutcome,
  ): CoveragePublicationResult<TRowKey>
  publishOutcome(
    acquisition: AcquisitionToken,
    leaseOrOutcome: DemandLease<TDemand> | AppliedLoadSubsetOutcome,
    maybeOutcome?: AppliedLoadSubsetOutcome,
  ): CoveragePublicationResult<TRowKey> {
    const record = this.acquisitions.get(acquisition)
    const outcome = maybeOutcome ?? (leaseOrOutcome as AppliedLoadSubsetOutcome)
    const lease = maybeOutcome
      ? (leaseOrOutcome as DemandLease<TDemand>)
      : this.findMatchingLease(record, outcome)
    const claim =
      lease === undefined
        ? undefined
        : record?.claims.get(lease as DemandLease<unknown>)
    if (
      !record ||
      !claim ||
      record.releaseSettled ||
      !this.canPublish(acquisition, claim) ||
      !matchesOutcome(claim, outcome) ||
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
    claim.coverage = nextCoverage
    if (nextCoverage !== undefined) {
      // One physical result proves the same exact scope for every logical
      // owner attached to that acquisition, even when only one observer
      // publishes the adapter result.
      for (const peer of record.claims.values()) {
        if (peer.scopeKey === claim.scopeKey) {
          peer.coverage = this.snapshotCoverage(nextCoverage)
        }
      }
    }

    if (nextCoverage !== undefined) {
      this.restoreCurrentAcquisition(claim.scopeKey)
    } else {
      const current = this.currentAcquisitions.get(claim.scopeKey)
      if (current?.acquisition === acquisition && current.lease === lease) {
        this.restoreCurrentAcquisition(claim.scopeKey)
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
  ): RowOwnershipUpdate<TRowKey>
  replaceRows(
    acquisition: AcquisitionToken,
    lease: DemandLease<TDemand>,
    rows: Iterable<TRowKey>,
  ): RowOwnershipUpdate<TRowKey>
  replaceRows(
    acquisition: AcquisitionToken,
    leaseOrRows: DemandLease<TDemand> | Iterable<TRowKey>,
    maybeRows?: Iterable<TRowKey>,
  ): RowOwnershipUpdate<TRowKey> {
    const record = this.acquisitions.get(acquisition)
    const lease = maybeRows
      ? (leaseOrRows as DemandLease<TDemand>)
      : (Array.from(record?.claims.keys() ?? []).find((candidate) =>
          record?.leases.has(candidate),
        ) as DemandLease<TDemand> | undefined)
    const rows = maybeRows ?? (leaseOrRows as Iterable<TRowKey>)
    const claim =
      lease === undefined
        ? undefined
        : record?.claims.get(lease as DemandLease<unknown>)
    if (
      !record ||
      !claim ||
      record.releaseSettled ||
      !this.canPublish(acquisition, claim)
    ) {
      return { accepted: false, rowsToRemove: [] }
    }

    const nextRows = new Set(rows)
    const affectedScopes = new Set<string>()
    for (const [claimLease, existingClaim] of record.claims) {
      existingClaim.coverage = undefined
      const current = this.currentAcquisitions.get(existingClaim.scopeKey)
      if (
        current?.acquisition === acquisition &&
        current.lease === claimLease
      ) {
        affectedScopes.add(existingClaim.scopeKey)
      }
    }
    affectedScopes.forEach((scopeKey) =>
      this.restoreCurrentAcquisition(scopeKey),
    )
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
    claim: CoverageClaim<TCoverage>,
  ): boolean {
    const current = this.currentAcquisitions.get(claim.scopeKey)
    return (
      current === undefined ||
      current.acquisition === acquisition ||
      claim.generation > current.generation
    )
  }

  private isCurrent(
    acquisition: AcquisitionToken,
    lease: DemandLease<unknown>,
    claim: CoverageClaim<TCoverage>,
  ): boolean {
    const current = this.currentAcquisitions.get(claim.scopeKey)
    return current?.acquisition === acquisition && current.lease === lease
  }

  covers(demand: TDemand): boolean {
    return this.coverageAntichain().some((coverage) =>
      this.coversDemand(coverage, demand),
    )
  }

  coverageAntichain(): Array<TCoverage> {
    const facts = this.currentCoverageClaims().flatMap(({ claim }) =>
      claim.coverage === undefined
        ? []
        : [claim as CoverageClaim<TCoverage> & { coverage: TCoverage }],
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

  coverageEvidence(): Array<{ coverage: TCoverage; generation: number }> {
    return this.currentCoverageClaims().flatMap(({ claim }) =>
      claim.coverage === undefined
        ? []
        : [
            {
              coverage: this.snapshotCoverage(claim.coverage),
              generation: claim.generation,
            },
          ],
    )
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
      const claim = record.claims.get(lease as DemandLease<unknown>)
      record.leases.delete(lease as DemandLease<unknown>)
      if (claim) {
        const current = this.currentAcquisitions.get(claim.scopeKey)
        if (current?.acquisition === acquisition && current.lease === lease) {
          this.restoreCurrentAcquisition(claim.scopeKey)
        }
      }
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
    const affectedScopes = new Set<string>()
    for (const [lease, claim] of record.claims) {
      const current = this.currentAcquisitions.get(claim.scopeKey)
      if (current?.acquisition === acquisition && current.lease === lease) {
        affectedScopes.add(claim.scopeKey)
      }
    }
    affectedScopes.forEach((scopeKey) =>
      this.restoreCurrentAcquisition(scopeKey),
    )
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
      .flatMap(([acquisition, record]) =>
        record.releaseSettled
          ? []
          : Array.from(record.claims.entries()).flatMap(([lease, claim]) =>
              record.leases.has(lease) &&
              claim.scopeKey === scopeKey &&
              claim.coverage !== undefined
                ? [{ acquisition, lease, claim }]
                : [],
            ),
      )
      .sort((left, right) =>
        left.claim.generation === right.claim.generation
          ? right.claim.sequence - left.claim.sequence
          : right.claim.generation - left.claim.generation,
      )[0]

    if (candidate) {
      this.currentAcquisitions.set(scopeKey, {
        acquisition: candidate.acquisition,
        lease: candidate.lease,
        generation: candidate.claim.generation,
      })
    } else {
      this.currentAcquisitions.delete(scopeKey)
    }
  }

  private createClaim(
    generation: number,
    scope: {
      collectionId: string
      sourceId?: string
      demand: LoadSubsetOptions
    },
  ): Omit<CoverageClaim<TCoverage>, `sequence`> {
    const demand = snapshotLoadSubsetDemand(scope.demand)
    const demandKey = getLoadSubsetDemandKey(demand)
    return {
      generation,
      scopeKey: createScopeKey(scope.collectionId, scope.sourceId, demandKey),
      scope: {
        collectionId: scope.collectionId,
        sourceId: scope.sourceId,
        demandKey,
      },
      coverage: undefined,
    }
  }

  private findMatchingLease(
    record: AcquisitionRecord<TCoverage, TRowKey> | undefined,
    outcome: AppliedLoadSubsetOutcome,
  ): DemandLease<TDemand> | undefined {
    if (!record) return undefined
    const matching = Array.from(record.claims.entries()).filter(([, claim]) =>
      matchesOutcome(claim, outcome),
    )
    return (matching.find(([lease]) => record.leases.has(lease)) ??
      matching[0])?.[0] as DemandLease<TDemand> | undefined
  }

  private currentCoverageClaims(): Array<{
    acquisition: AcquisitionToken
    record: AcquisitionRecord<TCoverage, TRowKey>
    lease: DemandLease<unknown>
    claim: CoverageClaim<TCoverage>
  }> {
    return Array.from(this.acquisitions.entries()).flatMap(
      ([acquisition, record]) =>
        Array.from(record.claims.entries()).flatMap(([lease, claim]) =>
          record.leases.has(lease) &&
          claim.coverage !== undefined &&
          this.isCurrent(acquisition, lease, claim)
            ? [{ acquisition, record, lease, claim }]
            : [],
        ),
    )
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
      isLoadSubsetRequestSubsumedBy(demand, coverage.demand),
    coversCoverage: (coverage, candidate) =>
      coverage.collectionId === candidate.collectionId &&
      coverage.sourceId === candidate.sourceId &&
      isLoadSubsetRequestSubsumedBy(candidate.demand, coverage.demand),
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

function matchesOutcome<TCoverage>(
  claim: CoverageClaim<TCoverage>,
  outcome: AppliedLoadSubsetOutcome,
): boolean {
  return (
    claim.generation === outcome.generation &&
    claim.scope.collectionId === outcome.collectionId &&
    claim.scope.sourceId === outcome.sourceId &&
    claim.scope.demandKey === getLoadSubsetDemandKey(outcome.demand)
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
