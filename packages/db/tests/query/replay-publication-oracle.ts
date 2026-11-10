import { declareOracle } from '../oracle-declaration.js'

/**
 * A live-query Collection keeps its last complete publication while a current
 * replay participant or establishing applied receipt remains outstanding.
 * Failure retains that publication; success publishes the complete replacement.
 * Authority: live/ARCHITECTURE.md, Replay participants and failure, laws 7, 9
 * and 14. The 2026-10-30 raw Collection clarification leaves this law unchanged.
 *
 * This is the existing joint-replay owner's independent judgment, shared with
 * its actual Query receiving driver without changing its rules. PublicRow is
 * the model projection of query results; a receiver may use version zero when
 * its rows have no separate version field. main/peer name independent complete
 * query owners. Attempts are authored work identities, not core generations.
 * The model contains no source subscription queue or Query cache machinery.
 * A receiver supplies only authored rows and controlled participant/receipt
 * events. Cleanup and broader ownership histories remain in the primary driver.
 */

export type PublicRow = { id: string; version: number; value: number }
export type Owner = `main` | `peer`
export const normalize = (rows: ReadonlyArray<PublicRow>) =>
  rows
    .map(({ id, version, value }) => ({ id, version, value }))
    .sort((a, b) => a.id.localeCompare(b.id))

// Last complete publication and current obligations are distinguishable: the
// same new rows remain private with an older participant or a failed owner,
// but become public once all still-owned work and receipts establish success.
export class ReplayPublicationModel {
  readonly owners = new Set<Owner>([`main`, `peer`])
  readonly visible = new Map<Owner, Array<PublicRow>>()
  private replacement: Array<PublicRow>
  private readonly participants = new Map<
    string,
    { owner: Owner; attempt: number }
  >()
  private readonly receipts = new Set<string>()
  private readonly failed = new Set<Owner>()
  private latest = 0
  private readonly replaying = new Set<Owner>()
  private closed = false

  constructor(initial: Array<PublicRow>) {
    this.replacement = normalize(initial)
    for (const owner of this.owners) this.visible.set(owner, normalize(initial))
  }
  start(): number {
    if (this.closed) throw new Error(`model: replay after cleanup`)
    for (const owner of this.owners) this.replaying.add(owner)
    this.failed.clear()
    // A replacement aborts the prior attempts. Accepted writes still owe
    // their receipts, but obsolete provider settlement holds no readiness.
    this.participants.clear()
    const attempt = ++this.latest
    for (const owner of this.owners)
      this.participants.set(`${attempt}:${owner}`, { owner, attempt })
    return attempt
  }
  accept(id: string, rows: Array<PublicRow>): void {
    this.replacement = normalize(rows)
    this.receipts.add(id)
  }
  apply(id: string): void {
    this.receipts.delete(id)
    this.publishIfComplete()
  }
  settle(attempt: number, owner: Owner, failed: boolean): void {
    this.participants.delete(`${attempt}:${owner}`)
    if (
      !this.closed &&
      this.owners.has(owner) &&
      attempt === this.latest &&
      failed
    )
      this.failed.add(owner)
    this.publishIfComplete()
  }
  retire(owner: Owner): void {
    this.owners.delete(owner)
    this.failed.delete(owner)
    for (const [id, participant] of this.participants)
      if (participant.owner === owner) this.participants.delete(id)
    this.publishIfComplete()
  }
  cleanup(): void {
    this.closed = true
  }
  private publishIfComplete(): void {
    if (this.closed || this.receipts.size) return
    for (const owner of this.owners) {
      if (!this.replaying.has(owner) || this.failed.has(owner)) continue
      if (
        [...this.participants.values()].some(
          (participant) => participant.owner === owner,
        )
      )
        continue
      this.visible.set(owner, normalize(this.replacement))
      this.replaying.delete(owner)
    }
  }
}

declareOracle({ model: [ReplayPublicationModel, normalize] })
