/*
 * Implementation of murmur hash based on the Composites polyfill implementation:
 * https://github.com/tc39/proposal-composites
 */

const RANDOM_SEED = randomHash()
const STRING_MARKER = randomHash()
const BIG_INT_MARKER = randomHash()
const NEG_BIG_INT_MARKER = randomHash()
const SYMBOL_MARKER = randomHash()

type SymbolIdStore = {
  get: (key: symbol) => number | undefined
  set: (key: symbol, value: number) => unknown
}

const symbolIds = createSymbolIdStore()
const registeredSymbolIds = new Map<string, number>()
let nextSymbolId = 0

export function getSymbolIdentity(symbol: symbol): number {
  const registeredKey = Symbol.keyFor(symbol)
  if (registeredKey !== undefined) {
    let id = registeredSymbolIds.get(registeredKey)
    if (id === undefined) {
      id = ++nextSymbolId
      registeredSymbolIds.set(registeredKey, id)
    }
    return id
  }

  let id = symbolIds.get(symbol)
  if (id === undefined) {
    id = ++nextSymbolId
    symbolIds.set(symbol, id)
  }
  return id
}

function createSymbolIdStore(): SymbolIdStore {
  const weakIds = new WeakMap<object, number>() as unknown as SymbolIdStore
  const probe = Symbol()

  try {
    weakIds.set(probe, 0)
    if (weakIds.get(probe) === 0) return weakIds
  } catch {
    // Older runtimes reject symbols as weak keys. Retain them rather than
    // merge distinct symbols and corrupt differential state.
  }

  return new Map<symbol, number>()
}

export type Hash = number

export function randomHash() {
  return (Math.random() * (2 ** 31 - 1)) >>> 0
}

export interface Hasher {
  update: (val: symbol | string | number | bigint) => void
  digest: () => number
}

// Allocate this once, outside the hot path
const dv = new DataView(new ArrayBuffer(8))

/**
 * This implementation of Murmur hash uses a random initial seed and random markers.
 * This means that hashes aren't deterministic across app restarts.
 * This is intentional in the composites polyfill to be resistent to hash-flooding attacks
 * where malicious users would precompute lots of different objects whose hashes collide with each other.
 *
 * Currently, for ts/db-ivm this is fine because we don't persist client state.
 * However, when we will introduce persistence we will either need to store the seeds or remove the randomness
 * to ensure deterministic hashes across app restarts.
 */
export class MurmurHashStream implements Hasher {
  private hash: number = RANDOM_SEED
  private length = 0
  private carry = 0
  private carryBytes = 0

  private _mix(k1: number): void {
    k1 = Math.imul(k1, 0xcc9e2d51)
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 = Math.imul(k1, 0x1b873593)
    this.hash ^= k1
    this.hash = (this.hash << 13) | (this.hash >>> 19)
    this.hash = Math.imul(this.hash, 5) + 0xe6546b64
  }

  writeByte(byte: number): void {
    this.carry |= (byte & 0xff) << (8 * this.carryBytes)
    this.carryBytes++
    this.length++

    if (this.carryBytes === 4) {
      this._mix(this.carry >>> 0)
      this.carry = 0
      this.carryBytes = 0
    }
  }

  /** Write four bytes, low byte first, as four `writeByte` calls would. */
  private writeWord(word: number): void {
    if (this.carryBytes === 0) {
      this.length += 4
      this._mix(word >>> 0)
      return
    }
    this.writeByte(word & 0xff)
    this.writeByte((word >>> 8) & 0xff)
    this.writeByte((word >>> 16) & 0xff)
    this.writeByte((word >>> 24) & 0xff)
  }

  update(chunk: symbol | string | number | bigint): void {
    switch (typeof chunk) {
      case `symbol`: {
        this.update(SYMBOL_MARKER)
        this.update(getSymbolIdentity(chunk))
        return
      }
      case `string`:
        this.update(STRING_MARKER)
        {
          // Each code unit is two bytes, so a pair of them is one word.
          const pairs = chunk.length - (chunk.length % 2)
          for (let i = 0; i < pairs; i += 2) {
            this.writeWord(
              chunk.charCodeAt(i) | (chunk.charCodeAt(i + 1) << 16),
            )
          }
          if (pairs < chunk.length) {
            const code = chunk.charCodeAt(pairs)
            this.writeByte(code & 0xff)
            this.writeByte((code >>> 8) & 0xff)
          }
        }
        return
      case `number`:
        dv.setFloat64(0, chunk, true) // fixed little-endian
        this.writeWord(dv.getUint32(0, true))
        this.writeWord(dv.getUint32(4, true))
        return
      case `bigint`: {
        let value = chunk
        if (value < 0n) {
          value = -value
          this.update(NEG_BIG_INT_MARKER)
        } else {
          this.update(BIG_INT_MARKER)
        }
        while (value > 0n) {
          this.writeByte(Number(value & 0xffn))
          value >>= 8n
        }
        if (chunk === 0n) this.writeByte(0)
        return
      }
      default:
        throw new TypeError(`Unsupported input type: ${typeof chunk}`)
    }
  }

  digest(): number {
    if (this.carryBytes > 0) {
      let k1 = this.carry >>> 0
      k1 = Math.imul(k1, 0xcc9e2d51)
      k1 = (k1 << 15) | (k1 >>> 17)
      k1 = Math.imul(k1, 0x1b873593)
      this.hash ^= k1
    }

    this.hash ^= this.length
    this.hash ^= this.hash >>> 16
    this.hash = Math.imul(this.hash, 0x85ebca6b)
    this.hash ^= this.hash >>> 13
    this.hash = Math.imul(this.hash, 0xc2b2ae35)
    this.hash ^= this.hash >>> 16

    return this.hash >>> 0
  }
}
