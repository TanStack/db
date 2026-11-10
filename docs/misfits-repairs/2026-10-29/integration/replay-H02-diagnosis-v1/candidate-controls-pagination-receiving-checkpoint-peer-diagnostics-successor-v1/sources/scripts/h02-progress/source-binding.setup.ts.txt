import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { resolve } from 'node:path'
import { afterAll } from 'vitest'
import { prepareStartupInspector } from './startup-inspector.mjs'
import type { EvaluatedModules } from 'vite/module-runner'

/**
 * V8 supplies loaded source during startup only. The driver import finishes,
 * original/loader/V8 bindings are sealed, and the debugger disconnects before
 * the product history. Passive registry captures and real callback stacks give
 * separate evaluated/path evidence. Compiled code alone is not execution.
 */
const directory = process.env.H02_PROGRESS_BINDING_DIR
if (directory) {
  mkdirSync(resolve(directory, `v8-sources`), { recursive: true })
  const record = (value: Record<string, unknown>) =>
    appendFileSync(
      resolve(directory, `v8-binding.jsonl`),
      JSON.stringify(value) + `\n`,
    )
  const session = new Session()
  session.connect()
  Error.stackTraceLimit = 80
  const selectedRoot = process.env.H02_PROGRESS_SELECTED_ROOT
  if (!selectedRoot) throw new Error(`selected source root is required`)
  const freezePath = process.env.H02_PROGRESS_SOURCE_FREEZE
  if (!freezePath) throw new Error(`selected source freeze is required`)
  const freeze: {
    worktree: string
    productionFiles: Record<string, string>
    instrumentFiles: Record<string, string>
    sharedInstrumentFiles: Record<string, string>
  } = JSON.parse(readFileSync(freezePath, `utf8`))
  if (freeze.worktree !== selectedRoot)
    throw new Error(`selected source freeze has a different root`)
  const approvedInstruments = {
    ...freeze.instrumentFiles,
    ...freeze.sharedInstrumentFiles,
  }
  const expectedFiles = { ...freeze.productionFiles, ...approvedInstruments }
  const digest = (bytes: string | Buffer) =>
    createHash(`sha256`).update(bytes).digest(`hex`)
  const runtimeSources: Array<{
    url: string
    scriptId: string
    sourceSha256: string
  }> = []
  const pendingSources = new Set<Promise<void>>()
  const sourceErrors: Array<string> = []
  const sealedModules = new Set<string>()
  let sealed = false

  const capture = (cut: string) => {
    const state: unknown = Reflect.get(globalThis, `__vitest_worker__`)
    if (
      typeof state !== `object` ||
      state === null ||
      !(`evaluatedModules` in state)
    )
      throw new Error(`Vitest evaluated-module registry missing`)
    const modules = state.evaluatedModules as EvaluatedModules
    mkdirSync(resolve(directory, `evaluated-sources`), { recursive: true })
    const inventory = [...modules.idToModuleMap.values()].map((module) => {
      const meta = module.meta
      const code = meta && `code` in meta ? meta.code : undefined
      const sourceFile = resolve(module.file.replace(/\?.*$/, ``))
      const production =
        /\/packages\/(?:db|db-ivm|query-db-collection)\/src\//.test(sourceFile)
      const relative = sourceFile.startsWith(selectedRoot + `/`)
        ? sourceFile.slice(selectedRoot.length + 1)
        : undefined
      const approved =
        relative !== undefined && approvedInstruments[relative] !== undefined
      let sourceSha256: string | undefined
      if (production || approved) {
        if (relative === undefined || expectedFiles[relative] === undefined)
          throw new Error(
            `outside or unapproved receiving source: ${sourceFile}`,
          )
        sourceSha256 = digest(readFileSync(sourceFile))
        if (sourceSha256 !== expectedFiles[relative])
          throw new Error(`changed frozen receiving source: ${relative}`)
      }
      const codeSha256 = code === undefined ? undefined : digest(code)
      if (code !== undefined && codeSha256 !== undefined)
        writeFileSync(
          resolve(directory, `evaluated-sources`, `${codeSha256}.txt`),
          code,
        )
      if (
        sealed &&
        (production || approved) &&
        !sealedModules.has(`${sourceFile}:${codeSha256}`)
      )
        throw new Error(
          `later receiving module lacks sealed V8 binding: ${sourceFile}`,
        )
      return {
        id: module.id,
        url: module.url,
        file: module.file,
        evaluated: module.evaluated,
        imports: [...module.imports],
        sourceSha256,
        codeSha256,
        externalize:
          meta && `externalize` in meta ? meta.externalize : undefined,
      }
    })
    writeFileSync(
      resolve(directory, `evaluated-${cut}.json`),
      JSON.stringify({ cut, selectedRoot, inventory }, null, 2),
    )
    record({
      phase: `evaluated-registry-captured`,
      cut,
      modules: inventory.length,
    })
    return inventory
  }
  Object.defineProperty(globalThis, `__h02CaptureBindings`, {
    value: capture,
    configurable: true,
  })

  session.on(`Debugger.scriptParsed`, ({ params }) => {
    const pending = new Promise<void>((done) => {
      session.post(
        `Debugger.getScriptSource`,
        { scriptId: params.scriptId },
        (error, result) => {
          if (error) {
            sourceErrors.push(String(error))
            record({
              phase: `v8-source-error`,
              scriptId: params.scriptId,
              url: params.url,
              message: String(error),
            })
          } else {
            const source = result.scriptSource
            const sourceSha256 = digest(source)
            writeFileSync(
              resolve(directory, `v8-sources`, `${sourceSha256}.txt`),
              source,
            )
            runtimeSources.push({
              url: params.url,
              scriptId: params.scriptId,
              sourceSha256,
            })
            record({ phase: `v8-compiled-script`, ...params, sourceSha256 })
          }
          done()
        },
      )
    })
    pendingSources.add(pending)
    void pending.then(() => pendingSources.delete(pending))
  })
  const startup = await prepareStartupInspector(session, record)
  Object.defineProperty(globalThis, `__h02SealBindings`, {
    configurable: true,
    value: async () => {
      let bindings: Array<{
        file: string
        codeSha256: string
        scripts: Array<{ scriptId: string; sourceSha256: string }>
      }> = []
      await startup.seal(async () => {
        while (pendingSources.size) await Promise.all([...pendingSources])
        if (sourceErrors.length)
          throw new Error(
            `startup V8 source errors: ${sourceErrors.join(` | `)}`,
          )
        const inventory = capture(`pre-history`)
        bindings = inventory
          .filter(({ sourceSha256 }) => sourceSha256 !== undefined)
          .map((module) => {
            const file = resolve(module.file.replace(/\?.*$/, ``))
            if (!module.codeSha256)
              throw new Error(
                `startup receiving module lacks loader code: ${file}`,
              )
            const code = readFileSync(
              resolve(
                directory,
                `evaluated-sources`,
                `${module.codeSha256}.txt`,
              ),
              `utf8`,
            )
            const scripts = runtimeSources
              .filter((script) => {
                if (!(
                  script.url === file ||
                  script.url === `file://${file}` ||
                  script.url === module.url
                ))
                  return false
                const source = readFileSync(
                  resolve(
                    directory,
                    `v8-sources`,
                    `${script.sourceSha256}.txt`,
                  ),
                  `utf8`,
                )
                if (digest(source) !== script.sourceSha256)
                  throw new Error(
                    `changed startup V8 source: ${script.scriptId}`,
                  )
                return source.includes(code)
              })
              .map(({ scriptId, sourceSha256 }) => ({ scriptId, sourceSha256 }))
            if (!scripts.length)
              throw new Error(
                `startup receiving module lacks exact V8 binding: ${file}`,
              )
            sealedModules.add(`${file}:${module.codeSha256}`)
            return { file, codeSha256: module.codeSha256, scripts }
          })
      })
      sealed = true
      writeFileSync(
        resolve(directory, `binding-seal.json`),
        JSON.stringify(
          {
            selectedRoot,
            sealed: true,
            skipAllPausesAcknowledged: true,
            debuggerDisableAcknowledged: true,
            inspectorDisconnectedBeforeHistory: true,
            inventorySha256: digest(
              readFileSync(resolve(directory, `evaluated-pre-history.json`)),
            ),
            bindings,
          },
          null,
          2,
        ),
      )
    },
  })
  record({
    phase: `binding-started`,
    node: process.version,
    execPath: process.execPath,
    execArgv: process.execArgv,
    cwd: process.cwd(),
  })
  afterAll(() => {
    try {
      capture(`after-all`)
    } finally {
      if (!sealed) session.disconnect()
    }
  })
}
