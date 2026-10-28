import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import {
  RouterServer,
  attachRouterServerSsrUtils,
  renderRouterToStream,
} from '@tanstack/react-router/ssr/server'
import { makeFixture } from './fixture'
import type { DehydratedDbState } from '@tanstack/react-db'
import type { HostHistory, HostObservation } from './fixture'

const output = process.env.ROUTER_STREAM_OUTPUT!
const sessions = new Map<
  string,
  {
    release: () => void
    observations: Array<HostObservation>
    chunks: Array<{ index: number; text: string; at: number }>
    waiting: boolean
  }
>()
const server = createServer(async (request, response) => {
  const url = new URL(request.url!, `http://localhost`)
  const id = url.searchParams.get(`id`) ?? `default`
  if (url.pathname === `/client.js`) {
    response.setHeader(`content-type`, `text/javascript`)
    response.end(await readFile(`${output}/client.js`))
    return
  }
  if (url.pathname === `/release`) {
    sessions.get(id)?.release()
    response.end(`released`)
    return
  }
  if (url.pathname === `/observations`) {
    const session = sessions.get(id)
    response.setHeader(`content-type`, `application/json`)
    response.end(
      JSON.stringify(
        session && {
          observations: session.observations,
          chunks: session.chunks,
          waiting: session.waiting,
        },
      ),
    )
    return
  }
  if (url.pathname !== `/`) {
    response.end()
    return
  }
  try {
    const history = JSON.parse(url.searchParams.get(`history`)!) as HostHistory
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const session = {
      release,
      observations: [] as Array<HostObservation>,
      chunks: [] as Array<{ index: number; text: string; at: number }>,
      waiting: false,
    }
    sessions.set(id, session)
    const fixture = makeFixture(
      `server`,
      history,
      (observation) => session.observations.push(observation),
      released,
    )
    attachRouterServerSsrUtils({
      router: fixture.router,
      manifest: {
        routes: {
          __root__: {
            scripts: [
              { attrs: { type: `module`, async: true, src: `/client.js` } },
            ],
          },
        },
      },
    })
    await fixture.prepareServer()
    if (history.transport !== `owned`) {
      const dehydrate = fixture.router.options.dehydrate!
      fixture.router.options.dehydrate = async () => {
        const state = await dehydrate()
        const dbStream = new ReadableStream<DehydratedDbState>({
          async start(controller) {
            if (history.transport === `pending-close`) {
              const reader = state.dbStream.getReader()
              const entry = await reader.read()
              if (!entry.done) controller.enqueue(entry.value)
              reader.releaseLock()
              controller.close()
            } else {
              await released
              if (history.transport === `empty-error`)
                controller.error(new Error(`stream transport failed`))
              else controller.close()
            }
          },
        })
        return { ...state, dbStream }
      }
    }
    await fixture.router.load()
    await fixture.router.serverSsr!.dehydrate()
    const rendered = await renderRouterToStream({
      request: new Request(`http://localhost/`, {
        headers: {
          'User-Agent': `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`,
        },
      }),
      router: fixture.router,
      responseHeaders: new Headers({ 'content-type': `text/html` }),
      children: <RouterServer router={fixture.router} />,
    })
    response.writeHead(200, {
      'content-type': `text/html`,
      'cache-control': `no-store`,
    })
    const reader = rendered.response.body!.getReader()
    let held = false
    for (;;) {
      const entry = await reader.read()
      if (entry.done) break
      const text = new TextDecoder().decode(entry.value)
      // Only the HTTP sink waits. Serializer records and HTML retain their
      // original order, including every byte following the held record.
      if (!held && history.delivery === `held` && text.includes(`queryHash`)) {
        held = true
        session.waiting = true
        await released
        session.waiting = false
      }
      session.chunks.push({
        index: session.chunks.length,
        text,
        at: Date.now(),
      })
      response.write(entry.value)
    }
    response.end()
  } catch (error) {
    console.error(error)
    response.end(String(error))
  }
})
server.listen(0, `127.0.0.1`, () => {
  const address = server.address()
  if (address && typeof address === `object`)
    console.info(JSON.stringify({ port: address.port }))
})
