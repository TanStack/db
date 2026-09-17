import { existsSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type RuntimeResultRow = {
  status: `passed` | `failed`
  payload: {
    passed?: number
    failed?: number
    skipped?: number
    total?: number
    failures?: Array<{
      name?: string
      error?: string
    }>
    error?: string
    step?: string
    runId?: string
  }
}

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const appDirectory = resolve(packageDirectory, `app`)
const appId = `com.tanstack.db.capacitorsqlitee2e`
const runtimeRunId = Date.now().toString(36)
const resultsDatabaseName = `tanstack_db_capacitor_e2e_results_${runtimeRunId}`

function runCommand(
  command: string,
  args: Array<string>,
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? packageDirectory,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: `inherit`,
    })

    child.on(`exit`, (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(` `)} exited with code ${String(code)}`,
        ),
      )
    })
    child.on(`error`, rejectPromise)
  })
}

async function resolveSimulatorId(): Promise<string> {
  const requestedId = process.env.TANSTACK_DB_CAPACITOR_IOS_SIMULATOR_ID?.trim()
  if (requestedId) {
    return requestedId
  }

  const devices = await new Promise<string>((resolvePromise, rejectPromise) => {
    let output = ``
    const child = spawn(
      `xcrun`,
      [`simctl`, `list`, `devices`, `available`, `-j`],
      {
        cwd: packageDirectory,
        stdio: [`ignore`, `pipe`, `inherit`],
      },
    )

    child.stdout.on(`data`, (chunk) => {
      output += String(chunk)
    })
    child.on(`exit`, (code) => {
      if (code === 0) {
        resolvePromise(output)
        return
      }

      rejectPromise(new Error(`Unable to list iOS simulators`))
    })
    child.on(`error`, rejectPromise)
  })

  const parsed = JSON.parse(devices) as {
    devices: Record<
      string,
      Array<{
        udid: string
        name: string
        state: string
        isAvailable: boolean
      }>
    >
  }

  const availableIPhones = Object.entries(parsed.devices)
    .filter(([runtime]) => runtime.includes(`iOS`))
    .flatMap(([, runtimeDevices]) => runtimeDevices)
    .filter((device) => device.isAvailable && device.name.includes(`iPhone`))

  const bootedDevice = availableIPhones.find(
    (device) => device.state === `Booted`,
  )
  if (bootedDevice) {
    return bootedDevice.udid
  }

  const preferredDevice =
    availableIPhones.find((device) => device.name === `iPhone 16 Pro`) ??
    availableIPhones[0]

  if (!preferredDevice) {
    throw new Error(`No available iOS simulator found`)
  }

  return preferredDevice.udid
}

async function ensureNativeProject(): Promise<void> {
  const iosProjectDirectory = resolve(appDirectory, `ios`)
  const iosXcodeProjectPath = resolve(
    iosProjectDirectory,
    `App`,
    `App.xcodeproj`,
  )
  const iosPodfilePath = resolve(iosProjectDirectory, `App`, `Podfile`)

  if (existsSync(iosXcodeProjectPath) && !existsSync(iosPodfilePath)) {
    rmSync(iosProjectDirectory, {
      recursive: true,
      force: true,
    })
  }

  if (!existsSync(iosXcodeProjectPath)) {
    await runCommand(`pnpm`, [`run`, `native:add:ios`], {
      cwd: appDirectory,
    })
  }

  await runCommand(`pnpm`, [`build`], {
    cwd: appDirectory,
    env: {
      VITE_TANSTACK_DB_CAPACITOR_E2E_RUN_ID: runtimeRunId,
    },
  })
  await runCommand(`pnpm`, [`exec`, `cap`, `sync`, `ios`], {
    cwd: appDirectory,
  })
}

async function resolveAppDataContainer(): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = ``
    const child = spawn(
      `xcrun`,
      [`simctl`, `get_app_container`, `booted`, appId, `data`],
      {
        cwd: appDirectory,
        stdio: [`ignore`, `pipe`, `inherit`],
      },
    )

    child.stdout.on(`data`, (chunk) => {
      output += String(chunk)
    })
    child.on(`exit`, (code) => {
      if (code === 0) {
        resolvePromise(output.trim())
        return
      }

      rejectPromise(new Error(`Unable to resolve simulator app data container`))
    })
    child.on(`error`, rejectPromise)
  })
}

async function readSqlScalar(
  databasePath: string,
  sql: string,
): Promise<string | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    let output = ``
    const child = spawn(`sqlite3`, [databasePath, sql], {
      cwd: appDirectory,
      stdio: [`ignore`, `pipe`, `ignore`],
    })

    child.stdout.on(`data`, (chunk) => {
      output += String(chunk)
    })
    child.on(`exit`, (code) => {
      if (code === 0) {
        const trimmed = output.trim()
        resolvePromise(trimmed.length > 0 ? trimmed : null)
        return
      }

      rejectPromise(new Error(`sqlite3 query failed`))
    })
    child.on(`error`, rejectPromise)
  })
}

async function waitForResult(): Promise<RuntimeResultRow> {
  const simulatorId = await resolveSimulatorId()
  await ensureNativeProject()
  await runCommand(`open`, [
    `-a`,
    `Simulator`,
    `--args`,
    `-CurrentDeviceUDID`,
    simulatorId,
  ])
  await runCommand(`xcrun`, [`simctl`, `boot`, simulatorId]).catch(() =>
    Promise.resolve(),
  )
  await runCommand(`xcrun`, [`simctl`, `bootstatus`, simulatorId, `-b`])
  await runCommand(`xcrun`, [`simctl`, `terminate`, simulatorId, appId]).catch(
    () => Promise.resolve(),
  )
  await runCommand(
    `pnpm`,
    [`exec`, `cap`, `run`, `ios`, `--target`, simulatorId, `--no-sync`],
    {
      cwd: appDirectory,
    },
  )

  const appDataContainer = await resolveAppDataContainer()
  const databasePath = resolve(
    appDataContainer,
    `Documents`,
    `${resultsDatabaseName}SQLite.db`,
  )
  const deadline = Date.now() + 600_000

  while (Date.now() < deadline) {
    if (existsSync(databasePath)) {
      const status = await readSqlScalar(
        databasePath,
        `SELECT status FROM test_run_results ORDER BY id DESC LIMIT 1;`,
      )
      const payloadJson = await readSqlScalar(
        databasePath,
        `SELECT payload_json FROM test_run_results ORDER BY id DESC LIMIT 1;`,
      )

      if (status && payloadJson) {
        return {
          status: status as RuntimeResultRow[`status`],
          payload: JSON.parse(payloadJson) as RuntimeResultRow[`payload`],
        }
      }
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }

  throw new Error(`Timed out waiting for native iOS e2e result`)
}

const result = await waitForResult()

if (result.status !== `passed`) {
  const firstFailure = result.payload.failures?.[0]
  throw new Error(
    result.payload.error ??
      (firstFailure
        ? `${firstFailure.name ?? `Unnamed failure`}: ${firstFailure.error ?? `No error message`}`
        : `Native iOS e2e suite failed`),
  )
}

console.log(
  JSON.stringify(
    {
      runId: runtimeRunId,
      status: result.status,
      passed: result.payload.passed ?? 0,
      failed: result.payload.failed ?? 0,
      skipped: result.payload.skipped ?? 0,
      total: result.payload.total ?? 0,
    },
    null,
    2,
  ),
)
