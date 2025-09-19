/**
 * # Direct Join Algorithms for Incremental View Maintenance
 *
 * High-performance join operations implementing all join types (inner, left, right, full, anti)
 * with minimal state and optimized performance.
 *
 * ## Algorithm
 *
 * For each tick, the algorithm processes incoming changes (deltas) and emits join results:
 *
 * 1. **Build deltas**: Extract new/changed/deleted rows from input messages
 * 2. **Inner results**: Emit `ΔA⋈B_old + A_old⋈ΔB + ΔA⋈ΔB` (matched pairs)
 * 3. **Outer results**: For unmatched rows, emit null-extended tuples:
 *    - New unmatched rows from deltas (when opposite side empty)
 *    - Presence transitions: when key goes `0→>0` (retract nulls) or `>0→0` (emit nulls)
 * 4. **Update state**: Append deltas to indexes and update mass counters
 *
 * **Mass tracking** enables O(1) presence checks instead of scanning index buckets.
 *
 * ## State
 *
 * **Indexes** store the actual data:
 * - `indexA: Index<K, V1>` - all left-side rows accumulated over time
 * - `indexB: Index<K, V2>` - all right-side rows accumulated over time
 *
 * **Mass maps** track presence efficiently:
 * - `massA/massB: Map<K, number>` - sum of multiplicities per key
 * - Used for O(1) presence checks: `mass.get(key) !== 0` means key exists
 * - Avoids scanning entire index buckets just to check if key has any rows
 *
 * ## Join Types
 *
 * - **Inner**: Standard delta terms only
 * - **Outer**: Inner results + null-extended unmatched rows with transition handling
 * - **Anti**: Unmatched rows only (no inner results)
 *
 * ## Key Optimizations
 *
 * - **No temp copying**: Uses `(A⊎ΔA)⋈ΔB = A⋈ΔB ⊎ ΔA⋈ΔB` distributive property
 * - **Early-out checks**: Skip phases when no deltas present
 * - **Zero-entry pruning**: Keep maps compact, O(distinct keys) memory
 * - **Final presence logic**: Avoid emit→retract churn within same tick
 *
 * ## Correctness
 *
 * - **Ordering**: Pre-append snapshots for emissions, post-emit state updates
 * - **Presence**: Key matched iff mass ≠ 0, transitions trigger null handling
 * - **Bag semantics**: Proper multiplicity handling including negatives
 */

import { BinaryOperator, DifferenceStreamWriter } from "../graph.js"
import { StreamBuilder } from "../d2.js"
import { MultiSet } from "../multiset.js"
import { Index } from "../indexes.js"
import type { DifferenceStreamReader } from "../graph.js"
import type { IStreamBuilder, KeyValue, PipedOperator } from "../types.js"

/**
 * Type of join to perform
 */
export type JoinType = `inner` | `left` | `right` | `full` | `anti`

/**
 * Helper to build delta index and mass map from messages
 */
function buildDelta<K, V>(
  messages: Array<unknown>
): [Index<K, V>, Map<K, number>] {
  const delta = new Index<K, V>()
  const deltaMass = new Map<K, number>()

  for (const message of messages) {
    const multiSetMessage = message as MultiSet<[K, V]>
    for (const [item, multiplicity] of multiSetMessage.getInner()) {
      const [key, value] = item
      delta.addValue(key, [value, multiplicity])

      // Keep deltaMass small by deleting zero entries
      const next = (deltaMass.get(key) || 0) + multiplicity
      if (next === 0) {
        deltaMass.delete(key)
      } else {
        deltaMass.set(key, next)
      }
    }
  }

  return [delta, deltaMass]
}

/**
 * Operator that joins two input streams using direct join algorithms
 */
export class JoinOperator<K, V1, V2> extends BinaryOperator<
  [K, V1] | [K, V2] | [K, [V1, V2]] | [K, [V1 | null, V2 | null]]
> {
  #indexA = new Index<K, V1>()
  #indexB = new Index<K, V2>()
  #massA = new Map<K, number>() // sum of multiplicities per key on side A
  #massB = new Map<K, number>() // sum of multiplicities per key on side B
  #mode: JoinType

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V1]>,
    inputB: DifferenceStreamReader<[K, V2]>,
    output: DifferenceStreamWriter<any>,
    mode: JoinType = `inner`
  ) {
    super(id, inputA, inputB, output)
    this.#mode = mode
  }

  run(): void {
    // 1) Ingest messages and build deltas (no state mutation yet)
    const [deltaA, deltaMassA] = buildDelta<K, V1>(this.inputAMessages())
    const [deltaB, deltaMassB] = buildDelta<K, V2>(this.inputBMessages())

    // Early-out checks
    const hasDeltaA = deltaA.size > 0
    const hasDeltaB = deltaB.size > 0
    const hasDeltaMassA = deltaMassA.size > 0
    const hasDeltaMassB = deltaMassB.size > 0

    // If nothing happened, bail early
    if (!(hasDeltaA || hasDeltaB || hasDeltaMassA || hasDeltaMassB)) return

    // Precompute mode flags to avoid repeated string comparisons
    const mode = this.#mode
    const emitInner =
      mode === `inner` || mode === `left` || mode === `right` || mode === `full`
    const emitLeftNulls = mode === `left` || mode === `full`
    const emitRightNulls = mode === `right` || mode === `full`
    const emitAntiLeft = mode === `anti`

    const results = new MultiSet<any>()

    // 2) INNER part (used by inner/left/right/full, but NOT anti)
    if (emitInner && (hasDeltaA || hasDeltaB)) {
      // Emit the three standard delta terms: DeltaA⋈B_old, A_old⋈DeltaB, DeltaA⋈DeltaB
      // This avoids copying the entire left index each tick
      if (hasDeltaA) results.extend(deltaA.join(this.#indexB))
      if (hasDeltaB) results.extend(this.#indexA.join(deltaB))
      if (hasDeltaA && hasDeltaB) results.extend(deltaA.join(deltaB))
    }

    // 3) OUTER/ANTI specifics

    // LEFT side nulls or anti-left (depend only on B's presence)
    if ((emitLeftNulls || emitAntiLeft) && (hasDeltaA || hasDeltaMassB)) {
      // 3a) New/deleted left rows that are currently unmatched (only if DeltaA changed)
      if (hasDeltaA) {
        // For initial state, check final presence after applying deltaB
        for (const [key, valueIterator] of deltaA.entriesIterators()) {
          const finalMassB =
            (this.#massB.get(key) || 0) + (deltaMassB.get(key) || 0)
          if (finalMassB === 0) {
            for (const [value, multiplicity] of valueIterator) {
              if (multiplicity !== 0) {
                results.add([key, [value, null]], multiplicity)
              }
            }
          }
        }
      }

      // 3b) Right-side presence transitions (only if some RHS masses changed)
      if (hasDeltaMassB) {
        for (const [key, deltaMass] of deltaMassB) {
          const before = this.#massB.get(key) || 0
          if (deltaMass === 0) continue
          const after = before + deltaMass

          // Skip if presence doesn't flip (0->0, >0->different>0)
          if ((before === 0) === (after === 0)) continue

          const it = this.#indexA.getIterator(key)
          const retract = before === 0 // 0->!0 => retract, else (>0->0) emit
          for (const [value, multiplicity] of it) {
            if (multiplicity !== 0) {
              results.add(
                [key, [value, null]],
                retract ? -multiplicity : +multiplicity
              )
            }
          }
        }
      }
    }

    // RIGHT side nulls (depend only on A's presence)
    if (emitRightNulls && (hasDeltaB || hasDeltaMassA)) {
      // 3a) New/deleted right rows that are currently unmatched (only if DeltaB changed)
      if (hasDeltaB) {
        // For initial state, check final presence after applying deltaA
        for (const [key, valueIterator] of deltaB.entriesIterators()) {
          const finalMassA =
            (this.#massA.get(key) || 0) + (deltaMassA.get(key) || 0)
          if (finalMassA === 0) {
            for (const [value, multiplicity] of valueIterator) {
              if (multiplicity !== 0) {
                results.add([key, [null, value]], multiplicity)
              }
            }
          }
        }
      }

      // 3b) Left-side presence transitions (only if some LHS masses changed)
      if (hasDeltaMassA) {
        for (const [key, deltaMass] of deltaMassA) {
          const before = this.#massA.get(key) || 0
          if (deltaMass === 0) continue
          const after = before + deltaMass

          // Skip if presence doesn't flip (0->0, >0->different>0)
          if ((before === 0) === (after === 0)) continue

          const it = this.#indexB.getIterator(key)
          const retract = before === 0 // 0->!0 => retract, else (>0->0) emit
          for (const [value, multiplicity] of it) {
            if (multiplicity !== 0) {
              results.add(
                [key, [null, value]],
                retract ? -multiplicity : +multiplicity
              )
            }
          }
        }
      }
    }

    // 4) Commit — update state
    // IMPORTANT: All emissions use pre-append snapshots of indexA/indexB.
    // For unmatched-on-delta (3a), use final presence (mass + deltaMass) to avoid churn.
    // Append deltas and update masses only after all emissions.
    this.#indexA.append(deltaA)
    this.#indexB.append(deltaB)

    // Update masses and keep maps small by deleting zero entries
    for (const [key, deltaMass] of deltaMassA) {
      const next = (this.#massA.get(key) || 0) + deltaMass
      if (next === 0) {
        this.#massA.delete(key)
      } else {
        this.#massA.set(key, next)
      }
    }
    for (const [key, deltaMass] of deltaMassB) {
      const next = (this.#massB.get(key) || 0) + deltaMass
      if (next === 0) {
        this.#massB.delete(key)
      } else {
        this.#massB.set(key, next)
      }
    }

    // Send results
    if (results.getInner().length > 0) {
      this.output.sendData(results)
    }
  }
}

/**
 * Joins two input streams
 * @param other - The other stream to join with
 * @param type - The type of join to perform
 */
export function join<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>,
  type: JoinType = `inner`
): PipedOperator<T, KeyValue<K, [V1 | null, V2 | null]>> {
  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<K, [V1 | null, V2 | null]>> => {
    if (stream.graph !== other.graph) {
      throw new Error(`Cannot join streams from different graphs`)
    }
    const output = new StreamBuilder<KeyValue<K, [V1 | null, V2 | null]>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<K, [V1 | null, V2 | null]>>()
    )
    const operator = new JoinOperator<K, V1, V2>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<K, V1>>,
      other.connectReader(),
      output.writer,
      type
    )
    stream.graph.addOperator(operator)
    return output
  }
}

/**
 * Joins two input streams (inner join)
 * @param other - The other stream to join with
 */
export function innerJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, V2]>> {
  return join(other, `inner`) as unknown as PipedOperator<
    T,
    KeyValue<K, [V1, V2]>
  >
}

/**
 * Joins two input streams (anti join)
 * @param other - The other stream to join with
 */
export function antiJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, null]>> {
  return join(other, `anti`) as unknown as PipedOperator<
    T,
    KeyValue<K, [V1, null]>
  >
}

/**
 * Joins two input streams (left join)
 * @param other - The other stream to join with
 */
export function leftJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1, V2 | null]>> {
  return join(other, `left`) as unknown as PipedOperator<
    T,
    KeyValue<K, [V1, V2 | null]>
  >
}

/**
 * Joins two input streams (right join)
 * @param other - The other stream to join with
 */
export function rightJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1 | null, V2]>> {
  return join(other, `right`) as unknown as PipedOperator<
    T,
    KeyValue<K, [V1 | null, V2]>
  >
}

/**
 * Joins two input streams (full join)
 * @param other - The other stream to join with
 */
export function fullJoin<
  K,
  V1 extends T extends KeyValue<infer _KT, infer VT> ? VT : never,
  V2,
  T,
>(
  other: IStreamBuilder<KeyValue<K, V2>>
): PipedOperator<T, KeyValue<K, [V1 | null, V2 | null]>> {
  return join(other, `full`) as unknown as PipedOperator<
    T,
    KeyValue<K, [V1 | null, V2 | null]>
  >
}
