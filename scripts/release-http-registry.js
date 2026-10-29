/** Loopback HTTP production receiver. It supplies registry facts, not tag policy. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'

const statePath = process.argv[2]
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const requests = []
let origin
const save = () => {
  writeFileSync(`${statePath}.next`, JSON.stringify({ ...state, requests }))
  renameSync(`${statePath}.next`, statePath)
}

// Observe the packed manifest without extracting any filesystem path. Fixture
// archives are small USTAR streams made by the real package manager.
function packedManifest(attachment) {
  const compressed = Buffer.from(attachment.data, 'base64')
  assert.equal(compressed.length, attachment.length, 'attachment byte length')
  const tar = gunzipSync(compressed, { maxOutputLength: 4 * 1024 * 1024 })
  let manifest
  let files = 0
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) break
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '')
    const size = Number.parseInt(
      header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(),
      8,
    )
    assert(Number.isSafeInteger(size) && size >= 0, 'tar entry size')
    const data = tar.subarray(offset + 512, offset + 512 + size)
    assert.equal(data.length, size, 'complete tar entry')
    files++
    if (name === 'package/package.json') {
      assert.equal(manifest, undefined, 'one packed manifest')
      manifest = JSON.parse(data.toString())
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  assert(manifest, 'packed package.json exists')
  return {
    manifest,
    files,
    shasum: createHash('sha1').update(compressed).digest('hex'),
  }
}

const server = http.createServer((request, response) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > 4 * 1024 * 1024)
      request.destroy(new Error('fixture request exceeds limit'))
    else chunks.push(chunk)
  })
  request.on('end', () => {
    const observed = {
      method: request.method,
      path: request.url,
      registry: `http://${request.headers.host}`,
      authenticated:
        request.headers.authorization === 'Bearer release-http-fixture',
    }
    const reply = (status, value) => {
      save()
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    try {
      const url = new URL(request.url, origin)
      assert.equal(observed.registry, origin, 'loopback Host header')
      assert.equal(url.origin, origin, 'loopback request target')
      assert.equal(url.search, '', 'registry request has no unrecognized query')
      if (
        request.method === 'GET' &&
        url.pathname === '/-/npm/v1/user/profile'
      ) {
        requests.push({ ...observed, type: 'profile' })
        return reply(200, {
          name: 'release-fixture',
          tfa: { mode: 'auth-only' },
        })
      }
      const name = decodeURIComponent(url.pathname.slice(1))
      assert(Object.hasOwn(state.packages, name), 'known public package route')
      const entry = state.packages[name]
      if (request.method === 'GET') {
        requests.push({
          ...observed,
          type: 'info',
          name,
          versions: [...entry.versions],
          tags: { ...entry.tags },
        })
        if (entry.versions.length === 0)
          return reply(404, { error: 'not_found' })
        return reply(200, {
          _id: name,
          name,
          'dist-tags': entry.tags,
          versions: Object.fromEntries(
            entry.versions.map((version) => [
              version,
              {
                name,
                version,
                dist: {
                  tarball: `${origin}/${encodeURIComponent(name)}/-/fixture-${version}.tgz`,
                },
              },
            ]),
          ),
        })
      }
      assert.equal(request.method, 'PUT', 'registry publish method')
      assert.equal(
        observed.authenticated,
        true,
        'isolated fixture authentication',
      )
      let body = Buffer.concat(chunks)
      if (request.headers['content-encoding'] === 'gzip')
        body = gunzipSync(body, { maxOutputLength: 4 * 1024 * 1024 })
      else
        assert.equal(
          request.headers['content-encoding'],
          undefined,
          'known body encoding',
        )
      const document = JSON.parse(body.toString())
      assert.equal(document.name, name, 'document matches route')
      const versions = Object.keys(document.versions)
      const tags = Object.entries(document['dist-tags'])
      const attachments = Object.values(document._attachments)
      assert.equal(versions.length, 1, 'one uploaded version')
      assert.equal(tags.length, 1, 'one publication tag')
      assert.equal(attachments.length, 1, 'one packed attachment')
      const [version] = versions
      const [[tag, taggedVersion]] = tags
      assert.equal(taggedVersion, version, 'tag points to uploaded version')
      const archive = packedManifest(attachments[0])
      assert.equal(archive.manifest.name, name, 'packed name matches route')
      assert.equal(
        archive.manifest.version,
        version,
        'packed version matches document',
      )
      assert.equal(
        document.versions[version].dist.shasum,
        archive.shasum,
        'packed digest matches document',
      )
      const duplicate = entry.versions.includes(version)
      // Fail the next candidate only after an actual candidate upload succeeded.
      // This observes arrival order and imposes no package scheduling strategy.
      const priorCandidateSuccess = requests.some(
        (request) =>
          request.type === 'publish' &&
          request.success &&
          state.candidateNames?.includes(request.name),
      )
      const controlledFailure =
        !state.failed &&
        !duplicate &&
        (name === state.failureName ||
          (state.failureMode === 'candidate-after-success' &&
            state.candidateNames.includes(name) &&
            priorCandidateSuccess))
      const success = !controlledFailure && !duplicate
      requests.push({
        ...observed,
        type: 'publish',
        name,
        version,
        tag,
        access: document.access,
        success,
        controlledFailure,
        duplicate,
        archive: {
          name: archive.manifest.name,
          version: archive.manifest.version,
          files: archive.files,
        },
      })
      if (controlledFailure) {
        state.failed = true
        return reply(400, {
          error: 'EORACLE',
          reason: 'controlled publication failure',
        })
      }
      if (duplicate)
        return reply(409, {
          error: 'EPUBLISHCONFLICT',
          reason: 'version already exists',
        })
      entry.versions.push(version)
      entry.tags[tag] = version
      return reply(201, { ok: true, id: name, rev: 'fixture' })
    } catch (error) {
      requests.push({
        ...observed,
        type: 'protocol-error',
        error: error.message,
      })
      return reply(422, { error: 'EORACLEPROTOCOL', reason: error.message })
    }
  })
  request.on('error', (error) => {
    requests.push({ type: 'request-error', error: error.message })
    save()
  })
})
server.on('error', (error) => {
  process.send?.({ setupError: error.message, code: error.code })
  process.exitCode = 1
})
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`
  process.send?.({ origin })
})
process.on('message', (message) => {
  if (message === 'close') {
    server.close(() => process.exit(0))
    server.closeAllConnections()
  }
})
process.on('disconnect', () => {
  server.close(() => process.exit(0))
  server.closeAllConnections()
})
