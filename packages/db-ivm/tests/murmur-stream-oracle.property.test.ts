import { afterAll, beforeAll, vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'

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

oracleProperty({
  id: `ivm.murmur-stream`,
  law: {
    statement: `Every prefix digest agrees with the earlier byte-at-a-time stream over the same framed bytes.`,
    authority: `Existing byte-framing contract documented above; ReferenceByteStream.`,
    limits: `One to eight string, number or bigint chunks; no symbol identity or independent murmur3 block/finalizer proof.`,
  },
  // What this oracle owns: the gap report judges these entries, and their
  // reference trees within the package, by this file's tests.
  owns: [
    `src/hashing/murmur.ts#MurmurHashStream.update`,
    `src/hashing/murmur.ts#MurmurHashStream.digest`,
  ],
  histories: {
    arbitrary: fc.array(chunk, { minLength: 1, maxLength: 8 }),
    runs: 2000,
    fixedSeeds: [20261022],
    fixed: [
      { name: `two bytes after one code unit`, history: [`x`, 1.5, -0, `yz`] },
      {
        name: `one byte after a one-byte bigint`,
        history: [7n, 1.5, `ab`, 2 ** 40],
      },
      {
        name: `three bytes after a three-byte bigint`,
        history: [0x123456n, 2.5, `cd`, -1],
      },
    ],
  },
  model: (chunks) => digests(Reference, chunks),
  driver: (chunks, observe) => {
    observe(`prefix digests`, digests(Current, chunks))
  },
  check: (_chunks, trace, expected) =>
    differs(`prefix digests`, `byte framing`, trace[0]?.value, expected) ??
    pass,
})
