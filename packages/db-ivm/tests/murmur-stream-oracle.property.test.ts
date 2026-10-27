import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleRuns } from '../../db/tests/oracle-config.js'

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
 * modules load under one `Math.random` stub that returns a distinct value
 * for each marker, in declaration order, so the seed and each marker are
 * equal across the two modules and different from each other. Swapping two
 * markers therefore changes a digest. Histories are generated chunk
 * sequences. An odd-length string leaves the stream two bytes into a block,
 * and a bigint of one or three bytes leaves one or three, so the words after
 * them take the merge path at each of the three offsets. The comparison runs on the digest
 * of every prefix of the sequence, so an error in an early chunk cannot be
 * hidden by a later one.
 *
 * Scope: the law is the byte framing. The reference copies murmur3's block
 * mixing and finalizer, so this oracle cannot find an error in those.
 * Symbols are not generated: the reference has no symbol identity, so the
 * symbol marker and identity lookup have no owner here.
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
  // One value per randomHash call: seed, string, bigint, negative bigint and
  // symbol markers. The reference declares the first four in the same order.
  const markers = [0.11, 0.23, 0.37, 0.41, 0.53]
  let call = 0
  const random = vi
    .spyOn(Math, `random`)
    .mockImplementation(() => markers[call++ % markers.length]!)
  vi.resetModules()
  Current = (await import(`../src/hashing/murmur`)).MurmurHashStream
  call = 0
  Reference = (await import(`./murmur-stream-reference-oracle`))
    .ReferenceByteStream
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
      { numRuns: oracleRuns(2000) },
    )
  })

  it.each([
    [`two bytes, after a one-code-unit string`, [`x`, 1.5, -0, `yz`]],
    [`one byte, after a one-byte bigint`, [7n, 1.5, `ab`, 2 ** 40]],
    [`three bytes, after a three-byte bigint`, [0x123456n, 2.5, `cd`, -1]],
  ] as Array<[string, Array<Chunk>]>)(
    `digests the words that follow a block offset of %s`,
    (_, chunks) => {
      expect(digests(Current, chunks)).toEqual(digests(Reference, chunks))
    },
  )
})
