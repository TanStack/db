import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { resolve } from 'node:path'
import { afterAll } from 'vitest'
import type { EvaluatedModules } from 'vite/module-runner'

/**
 * V8 reports each compiled/loaded script and supplies its exact runtime source.
 * The inventory includes compiled scripts that may not execute. Precise
 * coverage, where reached, and positive driver stacks provide execution
 * evidence separately. A watchdog-aborted worker gets no final coverage credit.
 * Source capture is observational but can affect setup timing; no scheduling
 * mechanism or production source byte is changed.
 */
const directory = process.env.H02_PROGRESS_BINDING_DIR
if (directory) {
  mkdirSync(resolve(directory, `v8-sources`), { recursive: true })
  const record = (value: unknown) =>
    appendFileSync(
      resolve(directory, `v8-binding.jsonl`),
      JSON.stringify(value) + `\n`,
    )
  const session = new Session()
  session.connect()
  Error.stackTraceLimit = 80
  const selectedRoot = process.env.H02_PROGRESS_SELECTED_ROOT
  if (!selectedRoot) throw new Error(`selected source root is required`)
  const capture = (cut: string) => {
    // The runtime version and this private registry shape are frozen inputs.
    // This reads actual loader metadata; it does not wrap fetch promises or
    // add a second module evaluator. evaluated=false is retained explicitly.
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
      const sourceFile = module.file.replace(/\?.*$/, ``)
      const production =
        /\/packages\/(?:db|db-ivm|query-db-collection)\/src\//.test(sourceFile)
      let sourceSha256: string | undefined
      if (production) {
        if (!sourceFile.startsWith(selectedRoot + `/`))
          throw new Error(`outside selected production root: ${sourceFile}`)
        sourceSha256 = createHash(`sha256`)
          .update(readFileSync(sourceFile))
          .digest(`hex`)
      }
      const codeSha256 =
        code === undefined
          ? undefined
          : createHash(`sha256`).update(code).digest(`hex`)
      if (code !== undefined && codeSha256 !== undefined)
        writeFileSync(
          resolve(directory, `evaluated-sources`, `${codeSha256}.txt`),
          code,
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
  }
  Object.defineProperty(globalThis, `__h02CaptureBindings`, {
    value: capture,
    configurable: true,
  })
  session.on(`Debugger.scriptParsed`, ({ params }) => {
    session.post(
      `Debugger.getScriptSource`,
      { scriptId: params.scriptId },
      (error, result) => {
        if (error) {
          record({
            phase: `v8-source-error`,
            scriptId: params.scriptId,
            url: params.url,
            message: String(error),
          })
          return
        }
        const source = result.scriptSource
        const sourceSha256 = createHash(`sha256`).update(source).digest(`hex`)
        writeFileSync(
          resolve(directory, `v8-sources`, `${sourceSha256}.txt`),
          source,
        )
        record({ phase: `v8-compiled-script`, ...params, sourceSha256 })
      },
    )
  })
  session.post(`Debugger.enable`, (error) =>
    record({
      phase: `debugger-enabled`,
      error: error ? String(error) : undefined,
    }),
  )
  session.post(`Profiler.enable`)
  session.post(
    `Profiler.startPreciseCoverage`,
    { callCount: true, detailed: true },
    (error) =>
      record({
        phase: `coverage-started`,
        error: error ? String(error) : undefined,
      }),
  )
  record({
    phase: `binding-started`,
    node: process.version,
    execPath: process.execPath,
    execArgv: process.execArgv,
    cwd: process.cwd(),
  })
  afterAll(() => {
    capture(`after-all`)
    session.post(`Profiler.takePreciseCoverage`, (error, result) => {
      record({
        phase: `final-coverage`,
        error: error ? String(error) : undefined,
        result,
      })
      session.disconnect()
    })
  })
}
