import { generateKeyBetween } from "fractional-indexing"
import { DifferenceStreamWriter, UnaryOperator } from "../graph.js"
import { StreamBuilder } from "../d2.js"
import { MultiSet } from "../multiset.js"
import { Index } from "../indexes.js"
import { binarySearch, globalObjectIdGenerator } from "../utils.js"
import type { DifferenceStreamReader } from "../graph.js"
import type { IStreamBuilder, KeyValue, PipedOperator } from "../types.js"

export interface TopKWithFractionalIndexOptions {
  limit?: number
  offset?: number
}

export type TopKChanges<V> = {
  /** Indicates which element moves into the topK (if any) */
  moveIn: IndexedValue<V> | null
  /** Indicates which element moves out of the topK (if any) */
  moveOut: IndexedValue<V> | null
}

/**
 * A topK data structure that supports insertions and deletions
 * and returns changes to the topK.
 */
export interface TopK<V> {
  insert: (value: V) => TopKChanges<V>
  delete: (value: V) => TopKChanges<V>
}

/**
 * Implementation of a topK data structure.
 * Uses a sorted array internally to store the values and keeps a topK window over that array.
 * Inserts and deletes are O(n) operations because worst case an element is inserted/deleted
 * at the start of the array which causes all the elements to shift to the right/left.
 */
class TopKArray<V> implements TopK<V> {
  #sortedValues: Array<IndexedValue<V>> = []
  #comparator: (a: V, b: V) => number
  #topKStart: number
  #topKEnd: number

  constructor(
    offset: number,
    limit: number,
    comparator: (a: V, b: V) => number
  ) {
    this.#topKStart = offset
    this.#topKEnd = offset + limit
    this.#comparator = comparator
  }

  insert(value: V): TopKChanges<V> {
    const result: TopKChanges<V> = { moveIn: null, moveOut: null }

    // Lookup insert position
    const index = this.#findIndex(value)
    // Generate fractional index based on the fractional indices of the elements before and after it
    const indexBefore =
      index === 0 ? null : getIndex(this.#sortedValues[index - 1]!)
    const indexAfter =
      index === this.#sortedValues.length
        ? null
        : getIndex(this.#sortedValues[index]!)
    const fractionalIndex = generateKeyBetween(indexBefore, indexAfter)

    // Insert the value at the correct position
    const val = indexedValue(value, fractionalIndex)
    // Splice is O(n) where n = all elements in the collection (i.e. n >= k) !
    this.#sortedValues.splice(index, 0, val)

    // Check if the topK changed
    if (index < this.#topKEnd) {
      // The inserted element is either before the top K or within the top K
      // If it is before the top K then it moves the element that was right before the topK into the topK
      // If it is within the top K then the inserted element moves into the top K
      // In both cases the last element of the old top K now moves out of the top K
      const moveInIndex = Math.max(index, this.#topKStart)
      if (moveInIndex < this.#sortedValues.length) {
        // We actually have a topK
        // because in some cases there may not be enough elements in the array to reach the start of the topK
        // e.g. [1, 2, 3] with K = 2 and offset = 3 does not have a topK
        result.moveIn = this.#sortedValues[moveInIndex]!

        // We need to remove the element that falls out of the top K
        // The element that falls out of the top K has shifted one to the right
        // because of the element we inserted, so we find it at index topKEnd
        if (this.#topKEnd < this.#sortedValues.length) {
          result.moveOut = this.#sortedValues[this.#topKEnd]!
        }
      }
    }

    return result
  }

  /**
   * Deletes a value that may or may not be in the topK.
   * IMPORTANT: this assumes that the value is present in the collection
   *            if it's not the case it will remove the element
   *            that is on the position where the provided `value` would be.
   */
  delete(value: V): TopKChanges<V> {
    const result: TopKChanges<V> = { moveIn: null, moveOut: null }

    // Lookup delete position
    const index = this.#findIndex(value)
    // Remove the value at that position
    const [removedElem] = this.#sortedValues.splice(index, 1)

    // Check if the topK changed
    if (index < this.#topKEnd) {
      // The removed element is either before the top K or within the top K
      // If it is before the top K then the first element of the topK moves out of the topK
      // If it is within the top K then the removed element moves out of the topK
      result.moveOut = removedElem!
      if (index < this.#topKStart) {
        // The removed element is before the topK
        // so actually, the first element of the topK moves out of the topK
        // and not the element that we removed
        // The first element of the topK is now at index topKStart - 1
        // since we removed an element before the topK
        const moveOutIndex = this.#topKStart - 1
        if (moveOutIndex < this.#sortedValues.length) {
          result.moveOut = this.#sortedValues[moveOutIndex]!
        } else {
          // No value is moving out of the topK
          // because there are no elements in the topK
          result.moveOut = null
        }
      }

      // Since we removed an element that was before or in the topK
      // the first element after the topK moved one position to the left
      // and thus falls into the topK now
      const moveInIndex = this.#topKEnd - 1
      if (moveInIndex < this.#sortedValues.length) {
        result.moveIn = this.#sortedValues[moveInIndex]!
      }
    }

    return result
  }

  // TODO: see if there is a way to refactor the code for insert and delete in the topK above
  //       because they are very similar, one is shifting the topK window to the left and the other is shifting it to the right
  //       so i have the feeling there is a common pattern here and we can implement both cases using that pattern

  #findIndex(value: V): number {
    return binarySearch(this.#sortedValues, indexedValue(value, ``), (a, b) =>
      this.#comparator(getValue(a), getValue(b))
    )
  }
}

/**
 * Operator for fractional indexed topK operations
 * This operator maintains fractional indices for sorted elements
 * and only updates indices when elements move position
 */
export class TopKWithFractionalIndexOperator<K, V1> extends UnaryOperator<
  [K, V1],
  [K, IndexedValue<V1>]
> {
  #index = new Index<K, V1>()

  /**
   * topK data structure that supports insertions and deletions
   * and returns changes to the topK.
   */
  #topK: TopK<TaggedValue<V1>>

  constructor(
    id: number,
    inputA: DifferenceStreamReader<[K, V1]>,
    output: DifferenceStreamWriter<[K, [V1, string]]>,
    comparator: (a: V1, b: V1) => number,
    options: TopKWithFractionalIndexOptions
  ) {
    super(id, inputA, output)
    const limit = options.limit ?? Infinity
    const offset = options.offset ?? 0
    const compareTaggedValues = (a: TaggedValue<V1>, b: TaggedValue<V1>) => {
      // First compare on the value
      const valueComparison = comparator(untagValue(a), untagValue(b))
      if (valueComparison !== 0) {
        return valueComparison
      }
      // If the values are equal, compare on the tag (object identity)
      const tieBreakerA = getTag(a)
      const tieBreakerB = getTag(b)
      return tieBreakerA - tieBreakerB
    }
    this.#topK = this.createTopK(offset, limit, compareTaggedValues)
  }

  protected createTopK(
    offset: number,
    limit: number,
    comparator: (a: TaggedValue<V1>, b: TaggedValue<V1>) => number
  ): TopK<TaggedValue<V1>> {
    return new TopKArray(offset, limit, comparator)
  }

  run(): void {
    const result: Array<[[K, [V1, string]], number]> = []
    for (const message of this.inputMessages()) {
      for (const [item, multiplicity] of message.getInner()) {
        const [key, value] = item
        this.processElement(key, value, multiplicity, result)
      }
    }

    if (result.length > 0) {
      this.output.sendData(new MultiSet(result))
    }
  }

  processElement(
    key: K,
    value: V1,
    multiplicity: number,
    result: Array<[[K, [V1, string]], number]>
  ): void {
    const oldMultiplicity = this.#index.getMultiplicity(key, value)
    this.#index.addValue(key, [value, multiplicity])
    const newMultiplicity = this.#index.getMultiplicity(key, value)

    let res: TopKChanges<TaggedValue<V1>> = {
      moveIn: null,
      moveOut: null,
    }
    if (oldMultiplicity <= 0 && newMultiplicity > 0) {
      // The value was invisible but should now be visible
      // Need to insert it into the array of sorted values
      const taggedValue = tagValue(value)
      res = this.#topK.insert(taggedValue)
    } else if (oldMultiplicity > 0 && newMultiplicity <= 0) {
      // The value was visible but should now be invisible
      // Need to remove it from the array of sorted values
      const taggedValue = tagValue(value)
      res = this.#topK.delete(taggedValue)
    } else {
      // The value was invisible and it remains invisible
      // or it was visible and remains visible
      // so it doesn't affect the topK
    }

    if (res.moveIn) {
      const valueWithoutTieBreaker = mapValue(res.moveIn, untagValue)
      result.push([[key, valueWithoutTieBreaker], 1])
    }

    if (res.moveOut) {
      const valueWithoutTieBreaker = mapValue(res.moveOut, untagValue)
      result.push([[key, valueWithoutTieBreaker], -1])
    }

    return
  }
}

/**
 * Limits the number of results based on a comparator, with optional offset.
 * This works on a keyed stream, where the key is the first element of the tuple.
 * The ordering is within a key group, i.e. elements are sorted within a key group
 * and the limit + offset is applied to that sorted group.
 * To order the entire stream, key by the same value for all elements such as null.
 *
 * Uses fractional indexing to minimize the number of changes when elements move positions.
 * Each element is assigned a fractional index that is lexicographically sortable.
 * When elements move, only the indices of the moved elements are updated, not all elements.
 *
 * @param comparator - A function that compares two elements
 * @param options - An optional object containing limit and offset properties
 * @returns A piped operator that orders the elements and limits the number of results
 */
export function topKWithFractionalIndex<
  KType extends T extends KeyValue<infer K, infer _V> ? K : never,
  V1Type extends T extends KeyValue<KType, infer V> ? V : never,
  T,
>(
  comparator: (a: V1Type, b: V1Type) => number,
  options?: TopKWithFractionalIndexOptions
): PipedOperator<T, KeyValue<KType, [V1Type, string]>> {
  const opts = options || {}

  return (
    stream: IStreamBuilder<T>
  ): IStreamBuilder<KeyValue<KType, [V1Type, string]>> => {
    const output = new StreamBuilder<KeyValue<KType, [V1Type, string]>>(
      stream.graph,
      new DifferenceStreamWriter<KeyValue<KType, [V1Type, string]>>()
    )
    const operator = new TopKWithFractionalIndexOperator<KType, V1Type>(
      stream.graph.getNextOperatorId(),
      stream.connectReader() as DifferenceStreamReader<KeyValue<KType, V1Type>>,
      output.writer,
      comparator,
      opts
    )
    stream.graph.addOperator(operator)
    stream.graph.addStream(output.connectReader())
    return output
  }
}

// Abstraction for fractionally indexed values
export type FractionalIndex = string
export type IndexedValue<V> = [V, FractionalIndex]

export function indexedValue<V>(
  value: V,
  index: FractionalIndex
): IndexedValue<V> {
  return [value, index]
}

export function getValue<V>(indexedVal: IndexedValue<V>): V {
  return indexedVal[0]
}

export function getIndex<V>(indexedVal: IndexedValue<V>): FractionalIndex {
  return indexedVal[1]
}

function mapValue<V, W>(
  indexedVal: IndexedValue<V>,
  f: (value: V) => W
): IndexedValue<W> {
  return [f(getValue(indexedVal)), getIndex(indexedVal)]
}

export type Tag = number
export type TaggedValue<V> = [V, Tag]

function tagValue<V>(value: V): TaggedValue<V> {
  return [value, globalObjectIdGenerator.getId(value)]
}

function untagValue<V>(tieBreakerTaggedValue: TaggedValue<V>): V {
  return tieBreakerTaggedValue[0]
}

function getTag<V>(tieBreakerTaggedValue: TaggedValue<V>): Tag {
  return tieBreakerTaggedValue[1]
}
