/**
 * A consumer app that installs the built package, shared by the Chromium
 * tests. The app exposes `openDatabase(options)` on the page. The worker probe
 * runs in every frame before its scripts and records each constructor call,
 * each worker that starts, its requested type, and each termination.
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
import * as vite8 from 'vite'
import * as vite7 from 'vite-7'
import type { InlineConfig } from 'vite'
import type {
  BrowserWASQLiteDatabase,
  OpenBrowserWASQLiteOPFSDatabaseOptions,
} from '../src'

export const packageDirectory = fileURLToPath(new URL(`../`, import.meta.url))

/** The consumer's Vite major, named by the decision on TanStack/db#2371. */
export type ConsumerVite = 7 | 8

/**
 * The Vite module a consumer on the given major runs. Every e2e file selects
 * its Vite through this one helper. Vite 7 and Vite 8 expose the same
 * `createServer`, `preview`, and `build` calls that the harness uses; the
 * TypeScript declarations differ only in the internal resolved-config types,
 * so the module is typed as Vite 8 here, once, rather than at each call site.
 */
export function consumerVite(major: ConsumerVite): typeof vite8 {
  return (major === 7 ? vite7 : vite8) as unknown as typeof vite8
}

/**
 * Runs `vite build` as an app's build script does. That runs with NODE_ENV
 * unset, which Vite treats as production; Vitest sets it to `test`, which
 * would keep development-only code in the bundle.
 */
export async function buildForProduction(
  config: InlineConfig,
  viteBuild: typeof vite8.build = vite8.build,
): Promise<void> {
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = `production`
  try {
    await viteBuild(config)
  } finally {
    process.env.NODE_ENV = nodeEnv
  }
}

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
  attemptedWorkers: number
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
  probe.attemptedWorkers = 0
  probe.startedWorkers = 0
  probe.terminatedWorkers = 0
  probe.workerTypes = []
  probe.Worker = class extends NativeWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      probe.attemptedWorkers++
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
