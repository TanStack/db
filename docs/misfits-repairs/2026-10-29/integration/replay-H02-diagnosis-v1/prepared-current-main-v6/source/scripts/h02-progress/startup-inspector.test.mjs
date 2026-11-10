import { strict as assert } from 'node:assert'
import { Session } from 'node:inspector'
import { test } from 'node:test'
import { prepareStartupInspector } from './startup-inspector.mjs'

test(`acknowledges passive policy and disconnects before a history could start`, async () => {
  const calls = []
  const records = []
  const session = {
    post(method, parameters, callback) {
      calls.push([method, parameters])
      callback(null)
    },
    disconnect() {
      calls.push([`disconnect`])
    },
  }
  const startup = await prepareStartupInspector(session, (record) =>
    records.push(record),
  )
  await startup.seal(async () => {
    calls.push([`capture-and-bind`])
  })
  assert.deepEqual(calls, [
    [`Debugger.setSkipAllPauses`, { skip: true }],
    [`Debugger.enable`, {}],
    [`capture-and-bind`],
    [`Debugger.disable`, {}],
    [`disconnect`],
  ])
  assert.equal(records.at(-1).phase, `inspector-disconnected-before-history`)
  await assert.rejects(() => startup.seal(async () => {}), /already sealed/)
})

for (const failed of [
  `Debugger.setSkipAllPauses`,
  `Debugger.enable`,
  `Debugger.disable`,
])
  test(`fails closed when ${failed} is not acknowledged`, async () => {
    const original = new Error(`authored ${failed} error`)
    let disconnected = false
    const session = {
      post(method, parameters, callback) {
        callback(method === failed ? original : null)
      },
      disconnect() {
        disconnected = true
      },
    }
    await assert.rejects(
      async () => {
        const startup = await prepareStartupInspector(session, () => {})
        await startup.seal(async () => {})
      },
      (error) => error === original,
    )
    assert.equal(disconnected, false)
  })

test(`does not seal when source binding fails`, async () => {
  const calls = []
  const session = {
    post(method, parameters, callback) {
      calls.push(method)
      callback(null)
    },
    disconnect() {
      assert.fail(`failed source binding cannot seal`)
    },
  }
  const startup = await prepareStartupInspector(session, () => {})
  const original = new Error(`authored missing source binding`)
  await assert.rejects(
    () =>
      startup.seal(async () => {
        throw original
      }),
    (error) => error === original,
  )
  assert.deepEqual(calls, [`Debugger.setSkipAllPauses`, `Debugger.enable`])
})

test(`installed Node acknowledges startup policy, disable and disconnect`, async () => {
  // This real-host handshake loads no DB, QueryClient, history, or driver.
  const session = new Session()
  const records = []
  session.connect()
  try {
    const startup = await prepareStartupInspector(session, (record) =>
      records.push(record),
    )
    await startup.seal(async () => {})
    assert.deepEqual(
      records
        .filter(({ phase }) => phase === `inspector-ack`)
        .map(({ method, error }) => [method, error]),
      [
        [`Debugger.setSkipAllPauses`, undefined],
        [`Debugger.enable`, undefined],
        [`Debugger.disable`, undefined],
      ],
    )
    assert.equal(records.at(-1).phase, `inspector-disconnected-before-history`)
  } finally {
    session.disconnect()
  }
})
