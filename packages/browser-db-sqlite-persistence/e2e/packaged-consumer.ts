/**
 * A consumer app that installs the built package, shared by the Chromium
 * tests. The app exposes `openDatabase(options)` on the page. The worker probe
 * runs in every frame before its scripts and records each worker that starts,
 * its requested type, and each termination.
 */
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BrowserWASQLiteDatabase,
  OpenBrowserWASQLiteOPFSDatabaseOptions,
} from '../src'

export const packageDirectory = fileURLToPath(new URL(`../`, import.meta.url))

export function createPackagedConsumer(consumerDirectory: string): void {
  mkdirSync(consumerDirectory)
  writeFileSync(
    join(consumerDirectory, `package.json`),
    JSON.stringify({ name: `sqlite-wasm-consumer`, type: `module` }),
  )
  const packageInstallDirectory = join(
    consumerDirectory,
    `node_modules/@tanstack/browser-db-sqlite-persistence`,
  )
  mkdirSync(packageInstallDirectory, { recursive: true })
  cpSync(
    join(packageDirectory, `dist`),
    join(packageInstallDirectory, `dist`),
    {
      recursive: true,
    },
  )
  copyFileSync(
    join(packageDirectory, `package.json`),
    join(packageInstallDirectory, `package.json`),
  )
  for (const packageName of [`db`, `db-sqlite-persistence-core`]) {
    symlinkSync(
      join(packageDirectory, `../${packageName}`),
      join(consumerDirectory, `node_modules/@tanstack/${packageName}`),
      `dir`,
    )
  }
  writeFileSync(
    join(consumerDirectory, `index.html`),
    `<script type="module" src="./main.js"></script>`,
  )
  writeFileSync(
    join(consumerDirectory, `main.js`),
    `import { openBrowserWASQLiteOPFSDatabase } from '@tanstack/browser-db-sqlite-persistence';
globalThis.openDatabase = (options) => openBrowserWASQLiteOPFSDatabase({ databaseName: 'consumer.sqlite', ...options });`,
  )
}

export type ProbeGlobal = typeof globalThis & {
  openDatabase: (
    options?: Partial<OpenBrowserWASQLiteOPFSDatabaseOptions>,
  ) => Promise<BrowserWASQLiteDatabase>
  startedWorkers: number
  terminatedWorkers: number
  workerTypes: Array<WorkerType>
}

/**
 * Page init script. With `refuseWorkers`, the Worker constructor throws a
 * SecurityError, as a browser does for a worker it will not start.
 */
export function probeWorkers(options: { refuseWorkers: boolean }): void {
  const probe = globalThis as ProbeGlobal
  const NativeWorker = probe.Worker
  probe.startedWorkers = 0
  probe.terminatedWorkers = 0
  probe.workerTypes = []
  probe.Worker = class extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      if (options.refuseWorkers) {
        throw new DOMException(`The worker was refused`, `SecurityError`)
      }
      super(...args)
      probe.startedWorkers++
      probe.workerTypes.push(args[1]?.type ?? `classic`)
    }

    override terminate(): void {
      probe.terminatedWorkers++
      super.terminate()
    }
  }
}
