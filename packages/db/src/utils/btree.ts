// This file was copied from https://github.com/qwertie/btree-typescript/tree/master and adapted to our needs.
// We removed methods that we don't need.

// B+ tree by David Piepgrass. License: MIT
// Informative microbenchmarks & stuff:
// http://www.jayconrod.com/posts/52/a-tour-of-v8-object-representation (very educational)
// https://blog.mozilla.org/luke/2012/10/02/optimizing-javascript-variable-access/ (local vars are faster than properties)
// http://benediktmeurer.de/2017/12/13/an-introduction-to-speculative-optimization-in-v8/ (other stuff)
// https://jsperf.com/js-in-operator-vs-alternatives (avoid 'in' operator; `.p!==undefined` faster than `hasOwnProperty('p')` in all browsers)
// https://jsperf.com/instanceof-vs-typeof-vs-constructor-vs-member (speed of type tests varies wildly across browsers)
// https://jsperf.com/detecting-arrays-new (a.constructor===Array is best across browsers, assuming a is an object)
// https://jsperf.com/shallow-cloning-methods (a constructor is faster than Object.create; hand-written clone faster than Object.assign)
// https://jsperf.com/ways-to-fill-an-array (slice-and-replace is fastest)
// https://jsperf.com/math-min-max-vs-ternary-vs-if (Math.min/max is slow on Edge)
// https://jsperf.com/array-vs-property-access-speed (v.x/v.y is faster than a[0]/a[1] in major browsers IF hidden class is constant)
// https://jsperf.com/detect-not-null-or-undefined (`x==null` slightly slower than `x===null||x===undefined` on all browsers)
// Overall, microbenchmarks suggest Firefox is the fastest browser for JavaScript and Edge is the slowest.
// Lessons from https://v8project.blogspot.com/2017/09/elements-kinds-in-v8.html:
//   - Avoid holes in arrays. Avoid `new Array(N)`, it will be "holey" permanently.
//   - Don't read outside bounds of an array (it scans prototype chain).
//   - Small integer arrays are stored differently from doubles
//   - Adding non-numbers to an array deoptimizes it permanently into a general array
//   - Objects can be used like arrays (e.g. have length property) but are slower
//   - V8 source (NewElementsCapacity in src/objects.h): arrays grow by 50% + 16 elements

/**
 * Mutable B+ tree used by BTreeIndex for sorted value buckets. Keys use the
 * supplied comparator, which must return a number that is not NaN; BTreeIndex
 * checks custom comparators. Point operations cost O(log size). This fork has
 * no copy-on-write sharing, cloning, optional-value storage, early-exit range
 * callbacks, or in-place range edits: only the operations BTreeIndex uses,
 * plus `has()` and the `get()` fallback that the Map oracle observes
 * (tests/btree-map-oracle.test.ts).
 * @author David Piepgrass
 */
export class BTree<K = any, V = any> {
  private _root: BNode<K, V> = new BNode<K, V>()
  _size = 0
  _maxNodeSize: number

  /**
   * provides a total order over keys (and a strict partial order over the type K)
   * @returns a negative value if a < b, 0 if a === b and a positive value if a > b
   */
  _compare: (a: K, b: K) => number

  /**
   * Initializes an empty B+ tree.
   * @param compare Custom function to compare pairs of elements in the tree.
   * @param maxNodeSize Branching factor (maximum items or children per node)
   *   Must be in range 4..256. If undefined or <4 then default is used; if >256 then 256.
   */
  public constructor(compare: (a: K, b: K) => number, maxNodeSize?: number) {
    this._maxNodeSize = maxNodeSize! >= 4 ? Math.min(maxNodeSize!, 256) : 32
    this._compare = compare
  }

  /** Gets the number of key-value pairs in the tree. */
  get size() {
    return this._size
  }

  /** Releases the tree so that its size is 0. */
  clear() {
    this._root = new BNode<K, V>()
    this._size = 0
  }

  /**
   * Finds a pair in the tree and returns the associated value.
   * @param defaultValue a value to return if the key was not found.
   * @returns the value, or defaultValue if the key was not found.
   * @description Computational complexity: O(log size)
   */
  get(key: K, defaultValue?: V): V | undefined {
    return this._root.get(key, defaultValue, this)
  }

  /** Returns true if the key exists in the B+ tree. */
  has(key: K): boolean {
    const missing = {} as V
    return this.get(key, missing) !== missing
  }

  /**
   * Adds or overwrites a key-value pair in the B+ tree. Overwriting also
   * replaces the stored key.
   * @returns true if a new key-value pair was added.
   * @description Computational complexity: O(log size)
   */
  set(key: K, value: V): boolean {
    const result = this._root.set(key, value, this)
    if (result === true || result === false) return result
    // Root node has split, so create a new root node.
    this._root = new BNodeInternal<K, V>([this._root, result])
    return true
  }

  /**
   * Removes a single key-value pair from the B+ tree.
   * @returns true if a pair was found and removed, false otherwise.
   * @description Computational complexity: O(log size)
   */
  delete(key: K): boolean {
    const size = this._size
    let root = this._root
    root.forRange(key, key, true, true, this)
    // Collapse roots left with at most one child by the deletion.
    while (root.keys.length <= 1 && !root.isLeaf) {
      this._root = root =
        root.keys.length === 0
          ? new BNode<K, V>()
          : (root as any as BNodeInternal<K, V>).children[0]!
    }
    return this._size !== size
  }

  /** Gets the lowest key in the tree. Complexity: O(log size) */
  minKey(): K | undefined {
    return this._root.minKey()
  }

  /** Gets the highest key in the tree. Complexity: O(1) */
  maxKey(): K | undefined {
    return this._root.maxKey()
  }

  /** Returns the next pair whose key is larger than the specified key (or undefined if there is none).
   * If key === undefined, this function returns the lowest pair.
   */
  nextHigherPair(key: K | undefined): [K, V] | undefined {
    return key === undefined
      ? this._root.minPair()
      : this._root.getPairOrNextHigher(key, this._compare)
  }

  /** Returns the next pair whose key is smaller than the specified key (or undefined if there is none).
   *  If key === undefined, this function returns the highest pair.
   */
  nextLowerPair(key: K | undefined): [K, V] | undefined {
    return key === undefined
      ? this._root.maxPair()
      : this._root.getPairOrNextLower(key, this._compare)
  }

  /**
   * Scans the specified range of keys, in ascending order by key.
   * Note: the callback `onFound` must not insert or remove items in the
   * collection. Doing so may cause incorrect data to be sent to the
   * callback afterward.
   * @param low The first key scanned will be greater than or equal to `low`.
   * @param high Scanning stops when a key larger than this is reached.
   * @param includeHigh If the `high` key is present, `onFound` is called for
   *        that final pair if and only if this parameter is true.
   * @description Computational complexity: O(number of items scanned + log size)
   */
  forRange(
    low: K,
    high: K,
    includeHigh: boolean,
    onFound: (k: K, v: V) => void,
  ): void {
    this._root.forRange(low, high, includeHigh, false, this, onFound)
  }
}

/** Leaf node / base class. **************************************************/
class BNode<K, V> {
  // If this is an internal node, _keys[i] is the highest key in children[i].
  keys: Array<K>
  values: Array<V>
  get isLeaf() {
    return (this as any).children === undefined
  }

  constructor(keys: Array<K> = [], values: Array<V> = []) {
    this.keys = keys
    this.values = values
  }

  // /////////////////////////////////////////////////////////////////////////
  // Shared methods /////////////////////////////////////////////////////////

  maxKey() {
    return this.keys[this.keys.length - 1]
  }

  // If key not found, returns i^failXor where i is the insertion index.
  // Callers that don't care whether there was a match will set failXor=0.
  indexOf(key: K, failXor: number, cmp: (a: K, b: K) => number): number {
    const keys = this.keys
    let lo = 0,
      hi = keys.length,
      mid = hi >> 1
    while (lo < hi) {
      const c = cmp(keys[mid]!, key)
      if (c < 0) lo = mid + 1
      else if (c > 0)
        // key < keys[mid]
        hi = mid
      else return mid
      mid = (lo + hi) >> 1
    }
    return mid ^ failXor
  }

  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: misc //////////////////////////////////////////////////////////

  minKey(): K | undefined {
    return this.keys[0]
  }

  /** Returns the pair at index `i`, or undefined when `i` is out of range. */
  pairAt(i: number): [K, V] | undefined {
    return i >= 0 && i < this.keys.length
      ? [this.keys[i]!, this.values[i]!]
      : undefined
  }

  minPair(): [K, V] | undefined {
    return this.pairAt(0)
  }

  maxPair(): [K, V] | undefined {
    return this.pairAt(this.keys.length - 1)
  }

  get(key: K, defaultValue: V | undefined, tree: BTree<K, V>): V | undefined {
    const i = this.indexOf(key, -1, tree._compare)
    return i < 0 ? defaultValue : this.values[i]
  }

  // Strictly lower / higher neighbours of `key` within this leaf.
  getPairOrNextLower(
    key: K,
    compare: (a: K, b: K) => number,
  ): [K, V] | undefined {
    const i = this.indexOf(key, -1, compare)
    return this.pairAt(i < 0 ? ~i - 1 : i - 1)
  }

  getPairOrNextHigher(
    key: K,
    compare: (a: K, b: K) => number,
  ): [K, V] | undefined {
    const i = this.indexOf(key, -1, compare)
    return this.pairAt(i < 0 ? ~i : i + 1)
  }

  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: set & node splitting //////////////////////////////////////////

  set(key: K, value: V, tree: BTree<K, V>): boolean | BNode<K, V> {
    let i = this.indexOf(key, -1, tree._compare)
    if (i >= 0) {
      // Key already exists. Overwrite both key and value.
      this.keys[i] = key
      this.values[i] = value
      return false
    }
    i = ~i
    tree._size++
    let target: BNode<K, V> = this
    let newRightSibling: BNode<K, V> | undefined
    if (this.keys.length >= tree._maxNodeSize) {
      // This leaf node is full and must split
      newRightSibling = this.splitOffRightSide()
      if (i > this.keys.length) {
        i -= this.keys.length
        target = newRightSibling
      }
    }
    target.keys.splice(i, 0, key)
    target.values.splice(i, 0, value)
    return newRightSibling ?? true
  }

  takeFromRight(rhs: BNode<K, V>) {
    // Reminder: parent node must update its copy of key for this node
    this.values.push(rhs.values.shift()!)
    this.keys.push(rhs.keys.shift()!)
  }

  splitOffRightSide(): BNode<K, V> {
    // Reminder: parent node must update its copy of key for this node
    const half = this.keys.length >> 1
    return new BNode<K, V>(this.keys.splice(half), this.values.splice(half))
  }

  // ///////////////////////////////////////////////////////////////////////////
  // Leaf Node: scanning & deletions //////////////////////////////////////////

  // Visits [low, high] (or [low, high)) with `onFound`, or deletes that range
  // when `deleteMode` is set.
  forRange(
    low: K,
    high: K,
    includeHigh: boolean,
    deleteMode: boolean,
    tree: BTree<K, V>,
    onFound?: (k: K, v: V) => void,
  ): void {
    const cmp = tree._compare
    let iLow, iHigh
    if (high === low) {
      // A point range (as used by delete) needs only one search.
      if (!includeHigh) return
      iHigh = (iLow = this.indexOf(low, -1, cmp)) + 1
      if (iLow < 0) return
    } else {
      iLow = this.indexOf(low, 0, cmp)
      iHigh = this.indexOf(high, -1, cmp)
      if (iHigh < 0) iHigh = ~iHigh
      else if (includeHigh) iHigh++
    }
    if (deleteMode) {
      if (iHigh > iLow) {
        this.keys.splice(iLow, iHigh - iLow)
        this.values.splice(iLow, iHigh - iLow)
        tree._size -= iHigh - iLow
      }
    } else {
      for (let i = iLow; i < iHigh; i++)
        onFound!(this.keys[i]!, this.values[i]!)
    }
  }

  /** Adds entire contents of right-hand sibling (rhs is left unchanged) */
  mergeSibling(rhs: BNode<K, V>, _: number) {
    this.keys.push.apply(this.keys, rhs.keys)
    this.values.push.apply(this.values, rhs.values)
  }
}

/** Internal node (non-leaf node) ********************************************/
class BNodeInternal<K, V> extends BNode<K, V> {
  // Note: conventionally B+ trees have one fewer key than the number of
  // children, but I find it easier to keep the array lengths equal: each
  // keys[i] caches the value of children[i].maxKey().
  children: Array<BNode<K, V>>

  constructor(children: Array<BNode<K, V>>, keys?: Array<K>) {
    super(keys ?? children.map((child) => child.maxKey()!))
    this.children = children
  }

  minKey() {
    return this.children[0]!.minKey()
  }

  minPair(): [K, V] | undefined {
    return this.children[0]!.minPair()
  }

  maxPair(): [K, V] | undefined {
    return this.children[this.children.length - 1]!.maxPair()
  }

  get(key: K, defaultValue: V | undefined, tree: BTree<K, V>): V | undefined {
    const i = this.indexOf(key, 0, tree._compare),
      children = this.children
    return i < children.length
      ? children[i]!.get(key, defaultValue, tree)
      : defaultValue
  }

  getPairOrNextLower(
    key: K,
    compare: (a: K, b: K) => number,
  ): [K, V] | undefined {
    const i = this.indexOf(key, 0, compare),
      children = this.children
    if (i >= children.length) return this.maxPair()
    return (
      children[i]!.getPairOrNextLower(key, compare) ??
      (i > 0 ? children[i - 1]!.maxPair() : undefined)
    )
  }

  getPairOrNextHigher(
    key: K,
    compare: (a: K, b: K) => number,
  ): [K, V] | undefined {
    const i = this.indexOf(key, 0, compare),
      children = this.children
    if (i >= children.length) return undefined
    return (
      children[i]!.getPairOrNextHigher(key, compare) ??
      children[i + 1]?.minPair()
    )
  }

  // ///////////////////////////////////////////////////////////////////////////
  // Internal Node: set & node splitting //////////////////////////////////////

  set(key: K, value: V, tree: BTree<K, V>): boolean | BNodeInternal<K, V> {
    const c = this.children,
      max = tree._maxNodeSize,
      cmp = tree._compare
    let i = Math.min(this.indexOf(key, 0, cmp), c.length - 1)
    const child = c[i]!

    if (child.keys.length >= max) {
      // child is full; inserting anything else will cause a split.
      // Shifting an item to the left sibling may avoid a split. We can do a
      // shift if that sibling is not full and if the current key can still be
      // placed in the same node after the shift. A right shift would need a
      // key above child.maxKey(), and that only reaches the last child.
      let other: BNode<K, V> | undefined
      if (
        i > 0 &&
        (other = c[i - 1]!).keys.length < max &&
        cmp(child.keys[0]!, key) < 0
      ) {
        other.takeFromRight(child)
        this.keys[i - 1] = other.maxKey()!
      }
    }

    const result = child.set(key, value, tree)
    if (result === false) return false
    this.keys[i] = child.maxKey()!
    if (result === true) return true

    // The child has split and `result` is a new right child... does it fit?
    let target: BNodeInternal<K, V> = this
    let newRightSibling: BNodeInternal<K, V> | undefined
    if (this.keys.length >= max) {
      // no, we must split also
      newRightSibling = this.splitOffRightSide()
      // The new child follows i; no comparison is needed after mutation.
      if (i + 1 >= this.keys.length) {
        target = newRightSibling
        i -= this.keys.length
      }
    }
    target.children.splice(i + 1, 0, result)
    target.keys.splice(i + 1, 0, result.maxKey()!)
    return newRightSibling ?? true
  }

  /**
   * Split this node.
   * Modifies this to remove the second half of the items, returning a separate node containing them.
   */
  splitOffRightSide() {
    const half = this.children.length >> 1
    return new BNodeInternal<K, V>(
      this.children.splice(half),
      this.keys.splice(half),
    )
  }

  takeFromRight(rhs: BNode<K, V>) {
    // Reminder: parent node must update its copy of key for this node
    this.keys.push(rhs.keys.shift()!)
    this.children.push((rhs as BNodeInternal<K, V>).children.shift()!)
  }

  // ///////////////////////////////////////////////////////////////////////////
  // Internal Node: scanning & deletions //////////////////////////////////////

  forRange(
    low: K,
    high: K,
    includeHigh: boolean,
    deleteMode: boolean,
    tree: BTree<K, V>,
    onFound?: (k: K, v: V) => void,
  ): void {
    const cmp = tree._compare
    const keys = this.keys,
      children = this.children
    let iLow = this.indexOf(low, 0, cmp),
      i = iLow
    // A point range (as used by delete) needs only one search.
    const iHigh = Math.min(
      high === low ? iLow : this.indexOf(high, 0, cmp),
      keys.length - 1,
    )
    for (; i <= iHigh; i++) {
      children[i]!.forRange(low, high, includeHigh, deleteMode, tree, onFound)
      // Note: if children[i] is empty then keys[i]=undefined.
      //       This is an invalid state, but it is fixed below.
      if (deleteMode) keys[i] = children[i]!.maxKey()!
    }
    if (deleteMode) {
      // Deletions may have occurred, so look for opportunities to merge nodes.
      const half = tree._maxNodeSize >> 1
      if (iLow > 0) iLow--
      for (i = iHigh; i >= iLow; i--) {
        if (children[i]!.keys.length <= half) {
          if (children[i]!.keys.length !== 0) {
            this.tryMerge(i, tree._maxNodeSize)
          } else {
            // child is empty! delete it!
            keys.splice(i, 1)
            children.splice(i, 1)
          }
        }
      }
    }
  }

  /** Merges child i with child i+1 if their combined size is not too large */
  tryMerge(i: number, maxSize: number): void {
    const children = this.children
    if (
      i >= 0 &&
      i + 1 < children.length &&
      children[i]!.keys.length + children[i + 1]!.keys.length <= maxSize
    ) {
      children[i]!.mergeSibling(children[i + 1]!, maxSize)
      children.splice(i + 1, 1)
      this.keys.splice(i + 1, 1)
      this.keys[i] = children[i]!.maxKey()!
    }
  }

  /**
   * Move children from `rhs` into this.
   * `rhs` must be part of this tree, and be removed from it after this call.
   */
  mergeSibling(rhs: BNode<K, V>, maxNodeSize: number) {
    const oldLength = this.keys.length
    this.keys.push.apply(this.keys, rhs.keys)
    const rhsChildren = (rhs as any as BNodeInternal<K, V>).children
    this.children.push.apply(this.children, rhsChildren)

    // If our children are themselves almost empty due to a mass-delete,
    // they may need to be merged too (but only the oldLength-1 and its
    // right sibling should need this).
    this.tryMerge(oldLength - 1, maxNodeSize)
  }
}
