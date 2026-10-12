/** Native package receiving witness. A real browser executes Vite output built
 * from installed tarballs, with configFile:false and no workspace aliases.
 * The scalar persist/reopen example checks distribution plumbing; the source
 * oracles separately own the broader lifecycle and value laws.
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  buildPackedBrowser,
  createPackedConsumer,
} from '../../package-tests/indexed-db/packed-consumer'

test('loads the packed adapter through a browser bundler and restores a row', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const consumer = createPackedConsumer()
  const server = createServer()
  try {
    const web = await buildPackedBrowser(consumer.root)
    server.on('request', (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      try {
        response.setHeader(
          'Content-Type',
          path.endsWith('.js') ? 'text/javascript' : 'text/html',
        )
        response.end(
          readFileSync(join(web, path === '/' ? 'index.html' : path)),
        )
      } catch {
        response.writeHead(404).end()
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('consumer server did not bind')
    await page.goto(`http://127.0.0.1:${address.port}`)
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { packedResult?: unknown }).packedResult,
        ),
      )
      .toEqual({
        rows: [{ id: 1, name: 'updated' }],
        exports: Array(4).fill('function'),
      })
  } finally {
    try {
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
    } finally {
      consumer.cleanup()
    }
  }
})
