/**
 * Scientific settlement model. Authority: LoadSubsetFn, SyncAppliedReceipt and
 * LoadSubsetOptions.signal in db/src/types.ts. A successful attempt owes its
 * exact establishing receipts; cancellation cannot withdraw accepted writes.
 *
 * Facts are independently authored row/version tokens. The driver declares
 * which actual batches establish which attempts, then records their real
 * applied receipts and caller outcomes. The relation is many-to-many: one
 * accepted batch can establish several attempts. Pages, cursor encodings,
 * queues and the adapter's chosen commit partition have no model meaning.
 * Zero new receipts is legal only when the required facts already applied.
 * Cancellation with no accepted work may settle promptly. Accepted work
 * cannot be withdrawn and its caller waits for application even on cancellation
 * (LoadSubsetOptions.signal). Ordinary rejection discharges no receipt.
 * An uncancelable baseline initiated before abort may still be accepted later.
 * The driver authors that in-flight obligation explicitly; it is neither a
 * provider response count nor a pager phase. Core permits fulfillment after
 * abort once coverage and receipts apply. Receivers separately check their
 * own cancellation outcome policy.
 * Cleanup is separate authority: it cancels remaining attempts and permits
 * actual pending receipts to reject as abandoned (SyncAppliedReceipt). Merely
 * calling cleanup does not discharge a receipt; its rejection must be observed.
 */
export class LazyReceiptModel {
  readonly events: Array<string> = []
  private readonly attempts = new Map<
    string,
    {
      facts: Set<string>
      receipts: Set<string>
      aborted: boolean
      settled: boolean
      inFlight: Set<string>
    }
  >()
  private readonly receipts = new Map<
    string,
    { facts: Set<string>; state: `pending` | `applied` | `abandoned` }
  >()
  private readonly appliedFacts = new Set<string>()
  private cleanedUp = false

  acquire(id: string, facts: ReadonlyArray<string>): void {
    if (this.cleanedUp)
      throw new Error(`receipt model: acquisition after cleanup`)
    if (this.attempts.has(id))
      throw new Error(`receipt model: duplicate attempt`)
    this.attempts.set(id, {
      facts: new Set(facts),
      receipts: new Set(),
      aborted: false,
      settled: false,
      inFlight: new Set(),
    })
    this.events.push(`acquire ${id}`)
  }

  initiate(id: string, work: string): void {
    const attempt = this.attempts.get(id)!
    if (attempt.aborted || attempt.settled || attempt.inFlight.has(work))
      throw new Error(`receipt model: invalid in-flight initiation`)
    attempt.inFlight.add(work)
    this.events.push(`initiate ${id} ${work}`)
  }

  finish(id: string, work: string): void {
    if (!this.attempts.get(id)!.inFlight.delete(work))
      throw new Error(`receipt model: unknown in-flight completion`)
    this.events.push(`finish ${id} ${work}`)
  }

  accept(
    id: string,
    facts: ReadonlyArray<string>,
    establishes: ReadonlyArray<string>,
  ): void {
    if (this.cleanedUp)
      throw new Error(`receipt model: acceptance after cleanup`)
    if (this.receipts.has(id))
      throw new Error(`receipt model: duplicate receipt`)
    this.receipts.set(id, { facts: new Set(facts), state: `pending` })
    for (const attempt of establishes) {
      const demand = this.attempts.get(attempt)!
      if (demand.settled)
        throw new Error(`receipt model: establishment after attempt ended`)
      demand.receipts.add(id)
    }
    this.events.push(`accept ${id} -> ${establishes.join(`,`)}`)
  }

  apply(id: string): void {
    const receipt = this.receipts.get(id)!
    if (receipt.state !== `pending`)
      throw new Error(`receipt model: duplicate or abandoned application`)
    receipt.state = `applied`
    for (const fact of receipt.facts) this.appliedFacts.add(fact)
    this.events.push(`apply ${id}`)
  }

  cleanup(): void {
    this.cleanedUp = true
    for (const attempt of this.attempts.values()) attempt.aborted = true
    this.events.push(`cleanup`)
  }

  abandon(id: string): void {
    const receipt = this.receipts.get(id)!
    if (!this.cleanedUp || receipt.state !== `pending`)
      throw new Error(`receipt law: abandonment without pending cleanup work`)
    receipt.state = `abandoned`
    this.events.push(`abandon ${id}`)
  }

  abort(id: string): void {
    this.attempts.get(id)!.aborted = true
    this.events.push(`abort ${id}`)
  }

  observe(id: string, outcome: `success` | `canceled` | `rejected`): void {
    const attempt = this.attempts.get(id)!
    if (attempt.settled)
      throw new Error(`receipt law: duplicate settlement ${id}`)
    if (outcome !== `rejected` && attempt.inFlight.size)
      throw new Error(
        `receipt law: ${id} settled before in-flight work finished`,
      )
    if (outcome !== `rejected`)
      for (const receipt of attempt.receipts)
        if (
          this.receipts.get(receipt)!.state === `pending` ||
          (outcome === `success` &&
            this.receipts.get(receipt)!.state === `abandoned`)
        )
          throw new Error(
            `receipt law: ${id} settled before ${receipt} applied`,
          )
    if (outcome === `success`) {
      for (const fact of attempt.facts)
        if (!this.appliedFacts.has(fact))
          throw new Error(`receipt law: ${id} lacks applied fact ${fact}`)
    }
    if (outcome === `canceled` && !attempt.aborted)
      throw new Error(`receipt law: cancellation without abort ${id}`)
    attempt.settled = true
    this.events.push(`${outcome} ${id}`)
  }

  /** Driver has released every authored establishing hold and drained the
   * responsive environment. This is a semantic quiescent checkpoint, never a
   * page/call budget or a claim about an arbitrary infinite execution. */
  complete(): void {
    for (const [id, attempt] of this.attempts) {
      if (!attempt.settled)
        throw new Error(`receipt progress: quiescent attempt ${id} stranded`)
      if (attempt.inFlight.size)
        throw new Error(`receipt progress: in-flight work for ${id} stranded`)
    }
    for (const [id, receipt] of this.receipts)
      if (receipt.state === `pending`)
        throw new Error(`receipt law: accepted work ${id} abandoned`)
  }
}
