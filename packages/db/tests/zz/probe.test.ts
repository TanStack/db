import { it } from 'vitest'
import { createCollection, createLiveQueryCollection } from '../../src/index'
import { createEffect } from '../../src/query/effect'
import { createDeferred } from '../../src/deferred'

const mk = (
  name: string,
  holds: Record<string, any>,
  params: Record<string, any>,
) =>
  createCollection<any, number>({
    id: `zz-${name}-${Math.random()}`,
    getKey: (r) => r.id,
    gcTime: 0,
    sync: {
      sync: (p) => {
        params[name] = p
        p.begin()
        p.write({ type: `insert`, value: { id: 1 } })
        p.commit()
        p.markReady()
        return () => holds[name]?.promise
      },
    },
  })
it(`1: crash during and after cleanup`, async () => {
  const holds: any = {},
    params: any = {}
  const A = mk(`A`, holds, params)
  await A.preload()
  holds.A = createDeferred<void>()
  const c = A.cleanup()
  A._lifecycle.crash(new Error(`crash during cleanup`))
  console.log(`1 during`, A.status, A.errors.error?.message)
  holds.A.resolve()
  await c.catch((e) => console.log(`1 cleanup rejected`, String(e)))
  console.log(`1 settled`, A.status, A.errors.error?.message ?? null)
  try {
    A._lifecycle.crash(new Error(`crash after cleanup`))
  } catch (e) {
    console.log(`1 crash after threw`, String(e))
  }
  console.log(`1 after`, A.status, A.errors.error?.message ?? null)
  let r = `?`
  await A.reload().then(
    () => (r = `resolved`),
    (e) => (r = `rejected ${e.constructor.name}`),
  )
  console.log(`1 reload`, r, A.status)
  holds.A = undefined
  await A.cleanup()
  await A.preload().then(
    () => console.log(`1 fresh`, A.status, A.size),
    (e) => console.log(`1 fresh rejected`, String(e)),
  )
})
it(`2: query reload after cascade ended it`, async () => {
  const holds: any = {},
    params: any = {}
  const A = mk(`A`, holds, params)
  const q = createLiveQueryCollection((qq) => qq.from({ a: A }))
  await q.preload()
  await A.cleanup({ dependents: true })
  console.log(`2 ended`, q.status, A.status)
  let r = `?`
  const p = q.reload().then(
    () => (r = `resolved`),
    (e) => (r = `rejected ${e.constructor.name}`),
  )
  await new Promise((x) => setTimeout(x, 10))
  await Promise.race([p, new Promise((x) => setTimeout(x, 50))])
  console.log(`2 after query reload`, r, q.status, q.size, `A`, A.status)
})
it(`3: effect created during pending cleanup`, async () => {
  const holds: any = {},
    params: any = {}
  const A = mk(`A`, holds, params)
  await A.preload()
  holds.A = createDeferred<void>()
  const c = A.cleanup({ dependents: true })
  const errs: Array<string> = []
  let threw = `none`
  let e: any
  try {
    e = createEffect({
      query: (qq) => qq.from({ row: A }),
      onBatch: () => {},
      onSourceError: (x) => errs.push(String(x)),
    })
  } catch (x) {
    threw = String(x)
  }
  await new Promise((x) => setTimeout(x, 0))
  console.log(`3 during`, threw, e?.disposed, errs, A.status)
  holds.A.resolve()
  await c.catch(() => {})
  await new Promise((x) => setTimeout(x, 0))
  console.log(`3 settled`, e?.disposed, errs, A.status)
  await e?.dispose()
})
it(`2b: query preload after cascade ended it`, async () => {
  const holds: any = {},
    params: any = {}
  const A = mk(`A`, holds, params)
  const q = createLiveQueryCollection((qq) => qq.from({ a: A }))
  await q.preload()
  await A.cleanup({ dependents: true })
  const p = q.preload()
  await Promise.race([p, new Promise((x) => setTimeout(x, 50))])
  console.log(`2b after query preload`, q.status, q.size, `A`, A.status)
  const sub = q.subscribeChanges(() => {})
  await new Promise((x) => setTimeout(x, 20))
  console.log(`2b after subscribe`, q.status, q.size, `A`, A.status)
  sub.unsubscribe()
})
it(`2c: query reload while its source is cleaning`, async () => {
  const holds: any = {},
    params: any = {}
  const A = mk(`A`, holds, params)
  const q = createLiveQueryCollection((qq) => qq.from({ a: A }))
  await q.preload()
  holds.A = createDeferred<void>()
  const c = A.cleanup({ dependents: true })
  await new Promise((x) => setTimeout(x, 0))
  let r = `?`
  const p = q.reload().then(
    () => (r = `resolved`),
    (e) => (r = `rejected ${e.constructor.name} ${e.message}`),
  )
  await Promise.race([p, new Promise((x) => setTimeout(x, 50))])
  console.log(
    `2c during`,
    r,
    q.status,
    JSON.stringify(q.errors.error?.message ?? null),
    `A`,
    A.status,
  )
  holds.A.resolve()
  await c.catch(() => {})
  await new Promise((x) => setTimeout(x, 10))
  console.log(`2c settled`, q.status, `A`, A.status)
})
