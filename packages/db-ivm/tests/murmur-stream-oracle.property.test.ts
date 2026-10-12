import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'

/**
 * # Does the murmur stream hash the bytes it is given?
 *
 * The stream turns each chunk into bytes: a number is its little-endian
 * float64, a string is its UTF-16 code units low byte first, and a bigint is
 * its magnitude bytes after a sign marker. The digest is murmur3 over that
 * byte sequence. The stream writes whole 32-bit words when it can, and merges
 * a word into a partly filled block when it cannot. Neither shortcut may
 * change which bytes reach murmur.
 *
 * The reference is the earlier stream, which wrote one byte per call. Both
 * modules load under one `Math.random` stub, so their seed and markers are
 * equal and digests are comparable. Histories are generated chunk sequences.
 * Odd-length strings leave the stream two bytes into a block, so the words
 * after them take the merge path. The comparison runs on the digest of every
 * prefix of the sequence, so an error in an early chunk cannot be hidden by
 * a later one. Symbols are out of scope here: they hash as their identity
 * number, which the number lane covers.
 */

type Chunk = string | number | bigint

let Current: new () => {
  update: (chunk: Chunk) => void
  digest: () => number
}
let Reference: new () => {
  update: (chunk: Chunk) => void
  digest: () => number
}

beforeAll(async () => {
  const random = vi.spyOn(Math, `random`).mockReturnValue(0.4375)
  vi.resetModules()
  Current = (await import(`../src/hashing/murmur`)).MurmurHashStream
  Reference = (await import(`./murmur-stream-reference`)).ReferenceByteStream
  random.mockRestore()
})

afterAll(() => {
  vi.resetModules()
})

const chunk: fc.Arbitrary<Chunk> = fc.oneof(
  fc.string({ unit: `binary` }),
  fc.string({ unit: `binary`, minLength: 1, maxLength: 3 }),
  fc.double(),
  fc.constantFrom(0, -0, NaN, Infinity, -Infinity, 1, 2 ** 53),
  fc.integer(),
  fc.bigInt(),
  fc.constantFrom(0n, -1n, 2n ** 64n),
)

function digests(
  Stream: new () => { update: (chunk: Chunk) => void; digest: () => number },
  chunks: Array<Chunk>,
): Array<number> {
  return chunks.map((_, end) => {
    const stream = new Stream()
    for (const value of chunks.slice(0, end + 1)) stream.update(value)
    return stream.digest()
  })
}

describe(`MurmurHashStream`, () => {
  it(`digests every chunk sequence as the byte-at-a-time stream does`, () => {
    fc.assert(
      fc.property(fc.array(chunk, { minLength: 1, maxLength: 8 }), (chunks) => {
        expect(digests(Current, chunks)).toEqual(digests(Reference, chunks))
      }),
      { numRuns: 2000 },
    )
  })

  it(`digests the words after an odd-length string`, () => {
    // One code unit leaves two bytes in the block; the numbers after it
    // each merge across a block boundary.
    const chunks: Array<Chunk> = [`x`, 1.5, -0, `yz`, 7n, `abc`, 2 ** 40]
    expect(digests(Current, chunks)).toEqual(digests(Reference, chunks))
  })
})
