import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
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
const androidDirectory = resolve(appDirectory, `android`)
const appId = `com.tanstack.db.capacitorsqlitee2e`
const runtimeRunId = Date.now().toString(36)
const resultsDatabaseName = `tanstack_db_capacitor_e2e_results_${runtimeRunId}`

function runCommand(
  command: string,
  args: Array<string>,
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdio?: `inherit` | `pipe`
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = ``
    const child = spawn(command, args, {
      cwd: options.cwd ?? packageDirectory,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio:
        options.stdio === `pipe` ? [`ignore`, `pipe`, `inherit`] : `inherit`,
    })

    if (options.stdio === `pipe`) {
      if (!child.stdout) {
        rejectPromise(new Error(`${command} did not expose stdout`))
        return
      }

      child.stdout.on(`data`, (chunk) => {
        stdout += String(chunk)
      })
    }

    child.on(`exit`, (code) => {
      if (code === 0) {
        resolvePromise(stdout)
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

function resolveAndroidSdkRoot(): string {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    resolve(homedir(), `Library/Android/sdk`),
  ].filter((value): value is string => Boolean(value))

  const sdkRoot = candidates.find((candidate) => existsSync(candidate))
  if (!sdkRoot) {
    throw new Error(`Unable to locate Android SDK root`)
  }

  return sdkRoot
}

function resolveSdkBinary(relativePath: string): string {
  const binaryPath = resolve(resolveAndroidSdkRoot(), relativePath)
  if (!existsSync(binaryPath)) {
    throw new Error(`Android SDK binary not found: ${binaryPath}`)
  }

  return binaryPath
}

function createAndroidCommandEnv(): NodeJS.ProcessEnv {
  const sdkRoot = resolveAndroidSdkRoot()
  return {
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
  }
}

async function ensureNativeProject(): Promise<void> {
  const androidProjectDirectory = resolve(appDirectory, `android`)
  const androidGradlePath = resolve(androidProjectDirectory, `gradlew`)
  const androidCommandEnv = createAndroidCommandEnv()

  if (!existsSync(androidGradlePath)) {
    await runCommand(`pnpm`, [`run`, `native:add:android`], {
      cwd: appDirectory,
      env: androidCommandEnv,
    })
  }

  await runCommand(`pnpm`, [`build`], {
    cwd: appDirectory,
    env: {
      VITE_TANSTACK_DB_CAPACITOR_E2E_RUN_ID: runtimeRunId,
    },
  })
  await runCommand(`pnpm`, [`exec`, `cap`, `sync`, `android`], {
    cwd: appDirectory,
    env: androidCommandEnv,
  })
}

async function resolveAndroidDeviceId(adbPath: string): Promise<string> {
  const requestedId =
    process.env.TANSTACK_DB_CAPACITOR_ANDROID_DEVICE_ID?.trim()
  if (requestedId) {
    return requestedId
  }

  const devicesOutput = await runCommand(adbPath, [`devices`], {
    stdio: `pipe`,
  })
  const connectedDevices = devicesOutput
    .split(`\n`)
    .map((line) => line.trim())
    .filter(
      (line) => line.endsWith(`device`) && !line.startsWith(`List of devices`),
    )
    .map((line) => line.split(/\s+/)[0])

  if (connectedDevices.length > 0) {
    return connectedDevices[0]!
  }

  const emulatorPath = resolveSdkBinary(`emulator/emulator`)
  const requestedAvd =
    process.env.TANSTACK_DB_CAPACITOR_ANDROID_AVD_NAME?.trim()
  const avdName =
    requestedAvd ||
    (await runCommand(emulatorPath, [`-list-avds`], { stdio: `pipe` }))
      .split(`\n`)
      .map((line) => line.trim())
      .find((line) => line.length > 0)

  if (!avdName) {
    throw new Error(`No Android emulator available`)
  }

  const emulator = spawn(emulatorPath, [`-avd`, avdName, `-no-snapshot-save`], {
    detached: true,
    stdio: `ignore`,
  })
  emulator.unref()

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const updatedDevicesOutput = await runCommand(adbPath, [`devices`], {
      stdio: `pipe`,
    })
    const emulatorDevice = updatedDevicesOutput
      .split(`\n`)
      .map((line) => line.trim())
      .find((line) => line.startsWith(`emulator-`) && line.endsWith(`device`))

    if (emulatorDevice) {
      return emulatorDevice.split(/\s+/)[0]!
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }

  throw new Error(`Timed out waiting for Android emulator to appear`)
}

async function waitForAndroidBoot(
  adbPath: string,
  deviceId: string,
): Promise<void> {
  await runCommand(adbPath, [`-s`, deviceId, `wait-for-device`])

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const bootCompleted = (
      await runCommand(
        adbPath,
        [`-s`, deviceId, `shell`, `getprop`, `sys.boot_completed`],
        { stdio: `pipe` },
      )
    ).trim()

    if (bootCompleted === `1`) {
      return
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }

  throw new Error(`Timed out waiting for Android emulator boot completion`)
}

async function buildDebugApk(): Promise<string> {
  const gradlewPath = resolve(androidDirectory, `gradlew`)
  const androidCommandEnv = createAndroidCommandEnv()
  await runCommand(gradlewPath, [`assembleDebug`], {
    cwd: androidDirectory,
    env: androidCommandEnv,
  })

  const apkPath = resolve(
    androidDirectory,
    `app/build/outputs/apk/debug/app-debug.apk`,
  )
  if (!existsSync(apkPath)) {
    throw new Error(`Debug APK not found at ${apkPath}`)
  }

  return apkPath
}

async function installAndLaunchApp(
  adbPath: string,
  deviceId: string,
  apkPath: string,
): Promise<void> {
  await runCommand(adbPath, [`-s`, deviceId, `install`, `-r`, apkPath])
  await runCommand(adbPath, [
    `-s`,
    deviceId,
    `shell`,
    `am`,
    `force-stop`,
    appId,
  ]).catch(() => Promise.resolve(``))
  await runCommand(adbPath, [
    `-s`,
    deviceId,
    `shell`,
    `monkey`,
    `-p`,
    appId,
    `-c`,
    `android.intent.category.LAUNCHER`,
    `1`,
  ])
}

async function pullResultDatabase(
  adbPath: string,
  deviceId: string,
  destinationPath: string,
): Promise<boolean> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      adbPath,
      [
        `-s`,
        deviceId,
        `exec-out`,
        `run-as`,
        appId,
        `cat`,
        `databases/${resultsDatabaseName}SQLite.db`,
      ],
      {
        cwd: packageDirectory,
        stdio: [`ignore`, `pipe`, `ignore`],
      },
    )

    const chunks: Array<Buffer> = []
    child.stdout.on(`data`, (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.on(`exit`, (code) => {
      if (code === 0 && chunks.length > 0) {
        writeFileSync(destinationPath, Buffer.concat(chunks))
        resolvePromise(true)
        return
      }

      if (code !== 0) {
        resolvePromise(false)
        return
      }

      rejectPromise(new Error(`Received empty Android result database payload`))
    })
    child.on(`error`, rejectPromise)
  })
}

async function readSqlScalar(
  databasePath: string,
  sql: string,
): Promise<string | null> {
  const output = await new Promise<string>((resolvePromise, rejectPromise) => {
    let stdout = ``
    const child = spawn(`sqlite3`, [databasePath, sql], {
      cwd: packageDirectory,
      stdio: [`ignore`, `pipe`, `ignore`],
    })

    child.stdout.on(`data`, (chunk) => {
      stdout += String(chunk)
    })
    child.on(`exit`, (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }

      rejectPromise(new Error(`sqlite3 query failed`))
    })
    child.on(`error`, rejectPromise)
  })
  const trimmed = output.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function waitForResult(
  adbPath: string,
  deviceId: string,
): Promise<RuntimeResultRow> {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-capacitor-android-e2e-result-`),
  )
  const extractedDatabasePath = resolve(
    tempDirectory,
    `${resultsDatabaseName}SQLite.db`,
  )
  const deadline = Date.now() + 600_000

  try {
    while (Date.now() < deadline) {
      const hasDatabase = await pullResultDatabase(
        adbPath,
        deviceId,
        extractedDatabasePath,
      )

      if (hasDatabase) {
        let status: string | null = null
        let payloadJson: string | null = null

        try {
          status = await readSqlScalar(
            extractedDatabasePath,
            `SELECT status FROM test_run_results ORDER BY id DESC LIMIT 1;`,
          )
          payloadJson = await readSqlScalar(
            extractedDatabasePath,
            `SELECT payload_json FROM test_run_results ORDER BY id DESC LIMIT 1;`,
          )
        } catch {
          // Android may expose the DB before SQLite has fully finalized writes,
          // so keep polling until the copied file can be queried cleanly.
        }

        if (status && payloadJson) {
          return {
            status: status as RuntimeResultRow[`status`],
            payload: JSON.parse(payloadJson) as RuntimeResultRow[`payload`],
          }
        }
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }

  throw new Error(`Timed out waiting for native Android e2e result`)
}

const adbPath = resolveSdkBinary(`platform-tools/adb`)
await ensureNativeProject()
const deviceId = await resolveAndroidDeviceId(adbPath)
await waitForAndroidBoot(adbPath, deviceId)
const apkPath = await buildDebugApk()
await installAndLaunchApp(adbPath, deviceId, apkPath)
const result = await waitForResult(adbPath, deviceId)

if (result.status !== `passed`) {
  const firstFailure = result.payload.failures?.[0]
  throw new Error(
    result.payload.error ??
      (firstFailure
        ? `${firstFailure.name ?? `Unnamed failure`}: ${firstFailure.error ?? `No error message`}`
        : `Native Android e2e suite failed`),
  )
}

console.log(
  JSON.stringify(
    {
      runId: runtimeRunId,
      deviceId,
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
