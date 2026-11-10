import { strict as assert } from 'node:assert'
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  readFileSync,
  readSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  checkReceiptFault,
  checkReceiptWriter,
  createReceiptDecoder,
  createReceiptReader,
  createReceiptWriter,
  requireReceiptPath,
  recordWorkerError,
} from './receipt-transport.mjs'

// Pure logging fixtures only. No production driver, provider, query, history
// grammar, oracle comparison, process-group sampler, or receiving run executes.
function fixture(run) {
  const directory = mkdtempSync(resolve(tmpdir(), `h02-transport-calibration-`))
  try {
    return run(resolve(directory, `receipts.jsonl`), directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const line = (sequence, details = {}) =>
  Buffer.from(
    JSON.stringify({ h02: true, sequence, phase: `authored`, ...details }) +
      `\n`,
  )

test(`writes exact ordered payloads through partial synchronous writes`, () =>
  fixture((path) => {
    const writer = createReceiptWriter(path, {
      write: (fd, bytes, offset, length) =>
        writeSync(fd, bytes, offset, Math.min(3, length)),
    })
    writer.emit(`authored`, {
      value: `é🙂`,
      keys: [null, 1, `1`],
      nested: { raw: true },
    })
    writer.emit(`worker-error`, { message: `original` })
    writer.close()
    assert.deepEqual(
      readFileSync(path),
      Buffer.concat([
        line(1, { value: `é🙂`, keys: [null, 1, `1`], nested: { raw: true } }),
        line(2, { phase: `worker-error`, message: `original` }),
      ]),
    )
    assert.equal(statSync(path).isFile(), true)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    checkReceiptWriter(path)
    assert.throws(() => createReceiptWriter(path), { code: `EEXIST` })
    assert.deepEqual(
      readFileSync(path),
      Buffer.concat([
        line(1, { value: `é🙂`, keys: [null, 1, `1`], nested: { raw: true } }),
        line(2, { phase: `worker-error`, message: `original` }),
      ]),
    )
  }))

test(`binds the raw path to the existing supervisor directory`, () =>
  fixture((path, directory) => {
    assert.equal(requireReceiptPath(directory, path), path)
    for (const wrong of [
      `receipts.jsonl`,
      `${path}.other`,
      resolve(directory, `..`, `receipts.jsonl`),
    ])
      assert.throws(
        () => requireReceiptPath(directory, wrong),
        /differs from binding directory/,
      )
  }))

test(`retains a large raw stream and a multibyte receipt larger than the read chunk`, () =>
  fixture((path) => {
    const writer = createReceiptWriter(path)
    const expected = []
    const seen = []
    const reader = createReceiptReader(path, (receipt) => seen.push(receipt))
    try {
      for (let index = 0; index < 4096; index++) {
        const details = { index, value: `é🙂`.repeat(40) }
        writer.emit(`authored`, details)
        expected.push({
          h02: true,
          sequence: expected.length + 1,
          phase: `authored`,
          ...details,
        })
      }
      assert.ok(statSync(path).size > 1024 * 1024)
      reader.drain()
      assert.deepEqual(seen, expected)
      const details = { value: `漢🙂`.repeat(40_000) }
      writer.emit(`authored`, details)
      expected.push({
        h02: true,
        sequence: expected.length + 1,
        phase: `authored`,
        ...details,
      })
      reader.drain()
      writer.emit(`worker-error`, { message: `authored final receipt` })
      expected.push({
        h02: true,
        sequence: expected.length + 1,
        phase: `worker-error`,
        message: `authored final receipt`,
      })
      writer.close()
      assert.equal(reader.drain(true), expected.length)
      assert.deepEqual(seen, expected)
      assert.deepEqual(
        readFileSync(path),
        Buffer.from(
          expected.map((receipt) => JSON.stringify(receipt) + `\n`).join(``),
        ),
      )
    } finally {
      reader.close()
    }
  }))

test(`decodes UTF-8 across every byte boundary and consumes each receipt once`, () =>
  fixture((path) => {
    const seen = []
    const writer = createReceiptWriter(path)
    const reader = createReceiptReader(path, (receipt) => seen.push(receipt), {
      read: (fd, bytes, offset, length, position) =>
        readSync(fd, bytes, offset, Math.min(1, length), position),
    })
    try {
      writer.emit(`authored`, { value: `é🙂漢字` })
      reader.drain()
      reader.drain()
      writer.emit(`authored`, { value: `β` })
      writer.close()
      assert.equal(reader.drain(true), 2)
      assert.equal(reader.drain(true), 2)
      assert.deepEqual(
        seen.map(({ sequence, value }) => [sequence, value]),
        [
          [1, `é🙂漢字`],
          [2, `β`],
        ],
      )
    } finally {
      reader.close()
    }
  }))

test(`a live drain stops at its captured byte boundary`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    const seen = []
    let appended = false
    const reader = createReceiptReader(
      path,
      (receipt) => seen.push(receipt.sequence),
      {
        read(fd, bytes, offset, length, position) {
          if (!appended) {
            appended = true
            appendFileSync(path, line(2))
          }
          return readSync(fd, bytes, offset, length, position)
        },
      },
    )
    try {
      reader.drain()
      assert.deepEqual(seen, [1])
      assert.equal(reader.drain(true), 2)
      assert.deepEqual(seen, [1, 2])
    } finally {
      reader.close()
    }
  }))

test(`holds a live partial line until a later drain completes it`, () =>
  fixture((path) => {
    const bytes = line(1, { value: `🙂` })
    const split = bytes.indexOf(Buffer.from(`🙂`)) + 1
    writeFileSync(path, bytes.subarray(0, split))
    const seen = []
    const reader = createReceiptReader(path, (receipt) => seen.push(receipt))
    try {
      reader.drain()
      assert.equal(seen.length, 0)
      appendFileSync(path, bytes.subarray(split))
      assert.equal(reader.drain(true), 1)
      assert.equal(seen[0].value, `🙂`)
    } finally {
      reader.close()
    }
  }))

test(`missing live file is pending but a missing final file fails`, () =>
  fixture((path) => {
    const reader = createReceiptReader(path, () => assert.fail(`no receipt`))
    try {
      reader.drain()
      assert.throws(() => reader.drain(true), { code: `ENOENT` })
    } finally {
      reader.close()
    }
  }))

for (const [name, bytes, message] of [
  [`gap`, Buffer.concat([line(1), line(3)]), /sequence/],
  [`duplicate`, Buffer.concat([line(1), line(1)]), /sequence/],
  [`reversed`, Buffer.concat([line(2), line(1)]), /sequence/],
  [`wrong envelope`, line(1, { h02: false }), /envelope/],
  [`missing phase`, line(1, { phase: null }), /envelope/],
  [`blank line`, Buffer.from(`\n`), /JSON/],
  [`malformed JSON`, Buffer.from(`{broken}\n`), /JSON/],
  [`invalid UTF-8`, Buffer.from([0xff, 0x0a]), /encoded data/],
  [`truncated final line`, line(1).subarray(0, -1), /truncated/],
  [`empty final stream`, Buffer.alloc(0), /empty/],
])
  test(`rejects ${name}`, () =>
    fixture((path) => {
      writeFileSync(path, bytes)
      const reader = createReceiptReader(path, () => {})
      try {
        assert.throws(() => reader.drain(true), message)
      } finally {
        reader.close()
      }
    }))

test(`rejects a file that shrinks after a completed drain`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    const reader = createReceiptReader(path, () => {})
    try {
      reader.drain()
      writeFileSync(path, ``)
      assert.throws(() => reader.drain(true), /shrank/)
    } finally {
      reader.close()
    }
  }))

test(`preserves the first read failure and never replays its prefix`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    const original = new Error(`authored read failure`)
    let reads = 0
    const reader = createReceiptReader(path, () => assert.fail(`no receipt`), {
      read() {
        reads++
        throw original
      },
    })
    try {
      assert.throws(
        () => reader.drain(),
        (error) => error === original,
      )
      assert.throws(
        () => reader.drain(true),
        (error) => error === original,
      )
      assert.equal(reads, 1)
    } finally {
      reader.close()
    }
  }))

test(`rejects replacement of the raw file after a live drain`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    const reader = createReceiptReader(path, () => {})
    try {
      reader.drain()
      renameSync(path, `${path}.original`)
      writeFileSync(path, line(1))
      assert.throws(() => reader.drain(true), /changed identity/)
    } finally {
      reader.close()
    }
  }))

test(`zero-progress reads cannot spin or silently omit the captured prefix`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    const reader = createReceiptReader(path, () => {}, { read: () => 0 })
    try {
      assert.throws(() => reader.drain(true), /invalid receipt read count/)
    } finally {
      reader.close()
    }
  }))

test(`preserves a partial-write failure and forbids later appends`, () =>
  fixture((path) => {
    const original = new Error(`authored disk failure`)
    let writes = 0
    const writer = createReceiptWriter(path, {
      write(fd, bytes, offset, length) {
        if (writes++ === 0)
          return writeSync(fd, bytes, offset, Math.min(7, length))
        throw original
      },
    })
    assert.throws(
      () => writer.emit(`authored`),
      (error) => error === original,
    )
    assert.throws(
      () => writer.emit(`worker-error`),
      (error) => error === original,
    )
    assert.throws(
      () => writer.close(),
      (error) => error === original,
    )
    assert.equal(writes, 2)
    assert.equal(readFileSync(path).length, 7)
    assert.throws(() => checkReceiptFault(path), /authored disk failure/)
  }))

test(`a failed new line is detected even when the raw prefix is well formed`, () =>
  fixture((path) => {
    const original = new Error(`authored zero-byte failure`)
    let writes = 0
    const writer = createReceiptWriter(path, {
      write(fd, bytes, offset, length) {
        if (writes++ === 0) return writeSync(fd, bytes, offset, length)
        throw original
      },
    })
    writer.emit(`authored`)
    assert.throws(
      () => writer.emit(`worker-error`),
      (error) => error === original,
    )
    assert.throws(
      () => writer.close(),
      (error) => error === original,
    )
    const seen = []
    const reader = createReceiptReader(path, (receipt) => seen.push(receipt))
    try {
      assert.equal(reader.drain(true), 1)
    } finally {
      reader.close()
    }
    assert.equal(seen.length, 1)
    assert.throws(() => checkReceiptWriter(path), /authored zero-byte failure/)
  }))

test(`writer failure survives failure of its own diagnostic write`, () =>
  fixture((path) => {
    const original = new Error(`authored primary write failure`)
    const writer = createReceiptWriter(path, {
      write() {
        throw original
      },
      reportFault() {
        throw new Error(`authored diagnostic failure`)
      },
    })
    assert.throws(
      () => writer.emit(`authored`),
      (error) => error === original,
    )
    assert.throws(
      () => writer.close(),
      (error) => error === original,
    )
  }))

test(`close failure remains a recorded instrument failure`, () =>
  fixture((path) => {
    const original = new Error(`authored close failure`)
    const writer = createReceiptWriter(path, {
      close(fd) {
        closeSync(fd)
        throw original
      },
    })
    writer.emit(`authored`)
    assert.throws(
      () => writer.close(),
      (error) => error === original,
    )
    assert.throws(() => checkReceiptWriter(path), /authored close failure/)
  }))

test(`zero-progress writes cannot spin`, () =>
  fixture((path) => {
    const writer = createReceiptWriter(path, { write: () => 0 })
    assert.throws(() => writer.emit(`authored`), /invalid receipt write count/)
    assert.throws(() => writer.close(), /invalid receipt write count/)
  }))

test(`worker error reporting and its diagnostic cannot replace the original error`, () => {
  const original = new Error(`authored original driver error`)
  let diagnosed = false
  assert.equal(
    recordWorkerError(
      original,
      () => {
        throw new Error(`receipt failed`)
      },
      () => {
        diagnosed = true
        throw new Error(`stderr failed`)
      },
    ),
    original,
  )
  assert.equal(diagnosed, true)
})

test(`driver and worker-error reporter use the same sink and sequence`, async () => {
  const directory = mkdtempSync(
    resolve(tmpdir(), `h02-shared-sink-calibration-`),
  )
  const path = resolve(directory, `receipts.jsonl`)
  const previousDirectory = process.env.H02_PROGRESS_BINDING_DIR
  const previousPath = process.env.H02_PROGRESS_RECEIPTS
  try {
    process.env.H02_PROGRESS_BINDING_DIR = directory
    process.env.H02_PROGRESS_RECEIPTS = path
    const shared = await import(
      `./receipt-transport.mjs?shared-sink-calibration`
    )
    shared.emitProgressReceipt(`worker-start`)
    const original = new Error(`authored driver error`)
    assert.equal(shared.recordWorkerError(original), original)
    shared.closeProgressReceipts()
    const seen = []
    const reader = createReceiptReader(path, (receipt) =>
      seen.push([receipt.sequence, receipt.phase]),
    )
    try {
      assert.equal(reader.drain(true), 2)
    } finally {
      reader.close()
    }
    assert.deepEqual(seen, [
      [1, `worker-start`],
      [2, `worker-error`],
    ])
  } finally {
    if (previousDirectory === undefined)
      delete process.env.H02_PROGRESS_BINDING_DIR
    else process.env.H02_PROGRESS_BINDING_DIR = previousDirectory
    if (previousPath === undefined) delete process.env.H02_PROGRESS_RECEIPTS
    else process.env.H02_PROGRESS_RECEIPTS = previousPath
    rmSync(directory, { recursive: true, force: true })
  }
})

test(`missing writer metadata fails closed`, () =>
  fixture((path) => {
    writeFileSync(path, line(1))
    assert.throws(() => checkReceiptWriter(path), { code: `ENOENT` })
  }))

test(`pure decoder rejects a corrupt supplied receipt without a product judgment`, () => {
  const decoder = createReceiptDecoder(() =>
    assert.fail(`corrupt receipt cannot dispatch`),
  )
  assert.throws(() => decoder.push(line(5)), /sequence/)
})
