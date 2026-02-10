const { contextBridge, ipcRenderer } = require(`electron`)
const {
  createElectronPersistenceInvoke,
  createElectronRendererPersistenceAdapter,
} = require(`../../../dist/cjs/renderer.cjs`)

async function runScenario(input) {
  const adapter = createElectronRendererPersistenceAdapter({
    invoke: createElectronPersistenceInvoke(ipcRenderer),
    channel: input.channel,
    timeoutMs: input.timeoutMs,
  })

  const scenario = input.scenario
  switch (scenario.type) {
    case `noop`:
      return { type: `noop` }

    case `writeTodo`: {
      await adapter.applyCommittedTx(input.collectionId, {
        txId: scenario.txId,
        term: 1,
        seq: scenario.seq,
        rowVersion: scenario.rowVersion,
        mutations: [
          {
            type: `insert`,
            key: scenario.todo.id,
            value: scenario.todo,
          },
        ],
      })
      return { type: `writeTodo` }
    }

    case `loadTodos`: {
      const rows = await adapter.loadSubset(
        scenario.collectionId ?? input.collectionId,
        {},
      )
      return {
        type: `loadTodos`,
        rows: rows.map((row) => ({
          key: String(row.key),
          value: {
            id: String(row.value?.id ?? ``),
            title: String(row.value?.title ?? ``),
            score: Number(row.value?.score ?? 0),
          },
        })),
      }
    }

    case `loadUnknownCollectionError`: {
      try {
        await adapter.loadSubset(scenario.collectionId, {})
        return {
          type: `loadUnknownCollectionError`,
          error: {
            name: `Error`,
            message: `Expected unknown collection error but operation succeeded`,
          },
        }
      } catch (error) {
        if (error instanceof Error) {
          return {
            type: `loadUnknownCollectionError`,
            error: {
              name: error.name,
              message: error.message,
              code:
                `code` in error && typeof error.code === `string`
                  ? error.code
                  : undefined,
            },
          }
        }

        return {
          type: `loadUnknownCollectionError`,
          error: {
            name: `Error`,
            message: `Unknown error type`,
          },
        }
      }
    }

    default:
      throw new Error(`Unsupported electron runtime bridge scenario`)
  }
}

contextBridge.exposeInMainWorld(`__tanstackDbRuntimeBridge__`, {
  runScenario,
})
