import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { TextDecoder } from 'node:util'

/** @typedef {Record<string, unknown> & { h02: true, sequence: number, phase: string }} Receipt */

/**
 * Receipt bytes have one synchronous writer and one independent file reader.
 * The writer never uses a pipe, yields, drops a receipt, or changes its payload.
 * Newlines delimit complete UTF-8 JSON receipts. A killed worker may leave a
 * complete prefix; a nonempty final fragment is an instrument failure.
 * These are recording rules, not provider, cache, or product progress rules.
 *
 * @param {string} path
 * @param {{ write?: (fd: number, bytes: Buffer, offset: number, length: number) => number, close?: (fd: number) => void, reportFault?: (value: unknown) => void }} [io]
 */
export function createReceiptWriter(path, io = {}) {
  const write = io.write ?? writeSync
  const close = io.close ?? closeSync
  const reportFault =
    io.reportFault ??
    ((value) =>
      writeFileSync(`${path}.fault.json`, JSON.stringify(value, null, 2), {
        flag: `wx`,
        mode: 0o600,
      }))
  let sequence = 0
  let writtenBytes = 0
  /** @type {number | undefined} */
  let fd
  let closed = false
  let failed = false
  /** @type {unknown} */
  let firstError
  /** @param {unknown} error @returns {never} */
  const fail = (error) => {
    if (!failed) {
      failed = true
      firstError = error
      try {
        reportFault({
          path,
          pid: process.pid,
          sequence,
          writtenBytes,
          message: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })
      } catch {
        // Failure reporting must not replace the write/open/close failure.
        // The receiving runner still rejects with the original error.
      }
    }
    throw firstError
  }
  try {
    fd = openSync(path, `wx`, 0o600)
    if (!fstatSync(fd).isFile()) throw new Error(`receipt sink is not a file`)
    writeFileSync(
      `${path}.writer.json`,
      JSON.stringify({
        path,
        pid: process.pid,
        flags: `wx`,
        mode: 0o600,
        regularFile: true,
      }),
      { flag: `wx`, mode: 0o600 },
    )
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // Preserve the original setup failure.
      }
    }
    fail(error)
  }
  if (fd === undefined) throw new Error(`receipt writer did not open`)
  const writerFd = fd
  return {
    /** @param {string} phase @param {Record<string, unknown>} [details] */
    emit(phase, details = {}) {
      if (failed) throw firstError
      if (closed) return fail(new Error(`receipt writer is closed`))
      try {
        // Preserve the original envelope and payload encoding. The shared
        // sequence includes the receiving runner's worker-error receipt.
        const bytes = Buffer.from(
          JSON.stringify({
            h02: true,
            sequence: ++sequence,
            phase,
            ...details,
          }) + `\n`,
          `utf8`,
        )
        let offset = 0
        while (offset < bytes.length) {
          const count = write(writerFd, bytes, offset, bytes.length - offset)
          if (
            !Number.isInteger(count) ||
            count <= 0 ||
            count > bytes.length - offset
          )
            throw new Error(`invalid receipt write count: ${count}`)
          offset += count
          writtenBytes += count
        }
      } catch (error) {
        fail(error)
      }
    },
    close() {
      if (!closed) {
        closed = true
        try {
          close(writerFd)
        } catch (error) {
          fail(error)
        }
      }
      if (failed) throw firstError
    },
  }
}

/** @param {(receipt: Receipt) => void} accept */
export function createReceiptDecoder(accept) {
  /** @type {Buffer} */
  let fragment = Buffer.alloc(0)
  let sequence = 0
  const utf8 = new TextDecoder(`utf-8`, { fatal: true, ignoreBOM: true })
  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      const bytes = fragment.length ? Buffer.concat([fragment, chunk]) : chunk
      let offset = 0
      for (;;) {
        const end = bytes.indexOf(0x0a, offset)
        if (end < 0) break
        const value = /** @type {unknown} */ (
          JSON.parse(utf8.decode(bytes.subarray(offset, end)))
        )
        if (
          typeof value !== `object` ||
          value === null ||
          !(`h02` in value) ||
          value.h02 !== true ||
          !(`phase` in value) ||
          typeof value.phase !== `string` ||
          !value.phase ||
          !(`sequence` in value) ||
          !Number.isSafeInteger(value.sequence) ||
          value.sequence !== sequence + 1
        )
          throw new Error(
            `invalid receipt envelope or sequence after ${sequence}`,
          )
        sequence++
        accept(/** @type {Receipt} */ (value))
        offset = end + 1
      }
      fragment = Buffer.from(bytes.subarray(offset))
    },
    finish() {
      if (fragment.length)
        throw new Error(`truncated final receipt: ${fragment.length} bytes`)
      if (sequence === 0) throw new Error(`receipt stream is empty`)
      return sequence
    },
  }
}

/**
 * A live drain reads only the size captured at its start, so an unbounded
 * producer cannot prevent the parent's next containment sample. The next
 * drain resumes at the exact byte offset. No complete receipt is replayed.
 *
 * @param {string} path
 * @param {(receipt: Receipt) => void} accept
 * @param {{ read?: (fd: number, bytes: Buffer, offset: number, length: number, position: number) => number }} [io]
 */
export function createReceiptReader(path, accept, io = {}) {
  const decoder = createReceiptDecoder(accept)
  const read = io.read ?? readSync
  /** @type {number | undefined} */
  let fd
  let offset = 0
  let failed = false
  /** @type {unknown} */
  let firstError
  return {
    drain(final = false) {
      if (failed) throw firstError
      try {
        if (fd === undefined) {
          try {
            fd = openSync(path, `r`)
          } catch (error) {
            if (
              !final &&
              error instanceof Error &&
              `code` in error &&
              error.code === `ENOENT`
            )
              return
            throw error
          }
        }
        const stat = fstatSync(fd)
        const named = lstatSync(path)
        if (
          !stat.isFile() ||
          !named.isFile() ||
          named.dev !== stat.dev ||
          named.ino !== stat.ino
        )
          throw new Error(`receipt file changed identity or is not regular`)
        const end = stat.size
        if (end < offset) throw new Error(`receipt file shrank`)
        const bytes = Buffer.alloc(64 * 1024)
        while (offset < end) {
          const length = Math.min(bytes.length, end - offset)
          const count = read(fd, bytes, 0, length, offset)
          if (!Number.isInteger(count) || count <= 0 || count > length)
            throw new Error(`invalid receipt read count: ${count}`)
          offset += count
          decoder.push(bytes.subarray(0, count))
        }
        if (final) return decoder.finish()
        return undefined
      } catch (error) {
        failed = true
        firstError = error
        throw error
      }
    },
    close() {
      if (fd !== undefined) {
        const closing = fd
        fd = undefined
        closeSync(closing)
      }
    },
  }
}

/** @param {string} directory @param {string} path */
export function requireReceiptPath(directory, path) {
  if (path !== resolve(directory, `receipts.jsonl`))
    throw new Error(`receipt path differs from binding directory`)
  return path
}

/** @type {ReturnType<typeof createReceiptWriter> | undefined} */
let progressWriter
let progressWriterFailed = false
/** @type {unknown} */
let progressWriterError
function getProgressWriter() {
  if (progressWriterFailed) throw progressWriterError
  if (!progressWriter) {
    try {
      const directory = process.env.H02_PROGRESS_BINDING_DIR
      const path = process.env.H02_PROGRESS_RECEIPTS
      if (!directory || !path)
        throw new Error(`receipt directory and path are required`)
      progressWriter = createReceiptWriter(requireReceiptPath(directory, path))
    } catch (error) {
      progressWriterFailed = true
      progressWriterError = error
      throw error
    }
  }
  return progressWriter
}
/** @param {string} phase @param {Record<string, unknown>} [details] */
export function emitProgressReceipt(phase, details = {}) {
  getProgressWriter().emit(phase, details)
}
export function closeProgressReceipts() {
  progressWriter?.close()
}

/**
 * The original driver error survives a failure while recording that error.
 * stderr is diagnostic only; it can never supply a missing raw receipt.
 * @param {unknown} error
 * @param {(phase: string, details: Record<string, unknown>) => void} [emit]
 * @param {(error: unknown) => void} [diagnose]
 */
export function recordWorkerError(
  error,
  emit = emitProgressReceipt,
  diagnose = console.error,
) {
  try {
    emit(`worker-error`, {
      message: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  } catch (secondary) {
    try {
      diagnose({
        receiptTransportFailure: String(secondary),
        originalError: String(error),
      })
    } catch {
      /* Preserve the original error. */
    }
  }
  return error
}

/** @param {string} path */
export function checkReceiptWriter(path) {
  const metadata = JSON.parse(readFileSync(`${path}.writer.json`, `utf8`))
  if (
    metadata.path !== path ||
    metadata.flags !== `wx` ||
    metadata.mode !== 0o600 ||
    metadata.regularFile !== true ||
    !Number.isSafeInteger(metadata.pid) ||
    metadata.pid <= 0
  )
    throw new Error(`invalid receipt writer setup metadata`)
  checkReceiptFault(path)
}

/** @param {string} path */
export function checkReceiptFault(path) {
  try {
    const fault = readFileSync(`${path}.fault.json`, `utf8`)
    throw new Error(`receipt writer fault: ${fault}`)
  } catch (error) {
    if (error instanceof Error && `code` in error && error.code === `ENOENT`)
      return
    throw error
  }
}
