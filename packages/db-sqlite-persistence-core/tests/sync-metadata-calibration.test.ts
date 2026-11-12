// @vitest-environment node
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import {
  missingRowMetadataHistoriesArbitrary,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  queuedMetadataRepairHistoriesArbitrary,
  runSessionHistory,
  seedReinsertReloadReplay,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  recoveryPhases,
  recoverySchedulesArbitrary,
  runRecoverySchedule,
} from '../../db/tests/sync-metadata-recovery-oracle'
import { createPersistedDriver } from './sync-metadata-session-persisted-driver'
import { createSQLiteDriver } from './sync-metadata-session-sqlite-driver'
import type { SessionDriver } from '../../db/tests/sync-metadata-session-oracle'
import type { RecoveryPhase } from '../../db/tests/sync-metadata-recovery-oracle'

it(`retains missing-row metadata boundaries in every generated batch`, () => {
  const required = new Set([
    `immediate: kept`,
    `immediate: explicit`,
    `core held: kept`,
    `core held: explicit`,
    `after source truncate: immediate`,
    `after source truncate: core held`,
    `peer row replaces metadata`,
    `peer metadata replaces metadata`,
    `unknown writes replace metadata`,
    `peer delete clears metadata`,
    `source delete clears metadata`,
    `source truncate clears metadata`,
  ])
  for (const batch of fc.sample(missingRowMetadataHistoriesArbitrary, {
    seed: 2220037,
    numRuns: 8,
  })) {
    expect(batch).toHaveLength(required.size)
    expect(new Set(batch.map(({ name }) => name))).toEqual(required)
  }
})

it(`rejects a recovery schedule whose boundary the driver cannot hold`, async () => {
  await expect(
    runRecoverySchedule(
      {
        phase: `after-application` as RecoveryPhase,
        interruption: `seed`,
        bare: false,
        value: 0,
      },
      () => createSQLiteDriver(persistedPeerOnDemandGrammar),
    ),
  ).rejects.toThrow(`commit completed without reaching after-application`)
})

it(`retains every recovery boundary and interruption in each generated batch`, () => {
  const required = new Set(
    [`response`, `read`, `application`].flatMap((phase) =>
      [`seed`, `peer`, `cleanup`].flatMap((interruption) =>
        [false, true].map((bare) => `${phase}/${interruption}/${bare}`),
      ),
    ),
  )
  for (const batch of fc.sample(recoverySchedulesArbitrary, {
    seed: 2220035,
    numRuns: 8,
  })) {
    expect(batch).toHaveLength(18)
    expect(
      new Set(
        batch.map(
          ({ phase, interruption, bare }) => `${phase}/${interruption}/${bare}`,
        ),
      ),
    ).toEqual(required)
  }
})

// Deliberately wrong observations calibrate the real shared comparison. These
// are sensitivity tests, not additional product models or production mutants.
it(`rejects a wrong durable write even when a later queued write repairs it`, async () => {
  const cases = fc.sample(queuedMetadataRepairHistoriesArbitrary, {
    seed: 2220031,
    numRuns: 1,
  })[0]!
  for (const { history, bare, held } of cases) {
    const baseline = await runSessionHistory(
      persistedPeerGrammar,
      history,
      () => createPersistedDriver(true, true, false, true),
    )
    expect(baseline.mismatch).toBeUndefined()
    let injected = false
    const mutant = await runSessionHistory(
      persistedPeerGrammar,
      history,
      async () => {
        const driver = await createPersistedDriver(true, true, false, true)
        const trace = driver.storedMetadataTrace!
        const commit = driver.commit
        let commits = 0
        driver.commit = async () => {
          await commit()
          commits++
        }
        driver.storedMetadataTrace = () => {
          const snapshots = trace()
          if (commits < 2 || snapshots.length < 2) return snapshots
          injected = true
          // The final snapshot remains correct. Preserve a wrong intermediate
          // value at the durable transaction cut where a later repair hid it.
          return [
            snapshots[0]!,
            { ...snapshots[0], 1: { corrupt: `kept seed became durable` } },
            ...snapshots.slice(1),
          ]
        }
        return driver
      },
    )
    expect(injected, `${bare}/${held}`).toBe(true)
    expect(mutant.mismatch?.law).toContain(`keeping metadata does not write`)
    expect(mutant.mismatch?.action).not.toBe(`settle`)
  }
}, 30_000)

const hosts: Array<{ name: string; create: () => Promise<SessionDriver> }> = [
  {
    name: `controlled`,
    create: () => createPersistedDriver(true, true, false, true),
  },
  {
    name: `SQLite`,
    create: () => createSQLiteDriver(persistedPeerOnDemandGrammar),
  },
]
it.each(hosts)(
  `rejects wrong source metadata that appears only after reload ($name)`,
  async ({ create, name }) => {
    const productionPath =
      name === `SQLite` ? persistedPeerOnDemandGrammar : persistedPeerGrammar
    expect(
      (
        await runSessionHistory(
          productionPath,
          seedReinsertReloadReplay,
          create,
        )
      ).mismatch,
    ).toBeUndefined()
    let reached = false
    const result = await runSessionHistory(
      productionPath,
      seedReinsertReloadReplay,
      async () => {
        const driver = await create()
        const peer = driver.peer!
        const observe = driver.observe
        driver.peer = async (...args) => {
          await peer(...args)
          if (args[1] === `reload`) reached = true
        }
        driver.observe = () => {
          const actual = observe()
          return reached
            ? {
                ...actual,
                rowMetadata: {
                  ...actual.rowMetadata,
                  1: { corrupt: `reload` },
                },
              }
            : actual
        }
        return driver
      },
    )
    expect(reached).toBe(true)
    expect(result.mismatch?.law).toBe(
      `source reads its row metadata (metadata.row.get)`,
    )
    expect(result.mismatch?.action).toMatchObject({
      type: `peer`,
      notice: `reload`,
    })
  },
)

it.each(recoveryPhases)(
  `compares source metadata while recovery is held at %s`,
  async (phase) => {
    let injected = false
    await expect(
      runRecoverySchedule(
        { phase, interruption: `seed`, bare: false, value: 7 },
        async () => {
          const driver = await createSQLiteDriver(persistedPeerOnDemandGrammar)
          const hold = driver.holdRecovery
          let holding = false
          driver.holdRecovery = (selected) => {
            const gate = hold(selected)
            return {
              reached: gate.reached.then(() => {
                holding = true
              }),
              release: () => {
                holding = false
                gate.release()
              },
            }
          }
          const observe = driver.observe
          driver.observe = () => {
            const actual = observe()
            if (!holding) return actual
            injected = true
            return {
              ...actual,
              rowMetadata: {
                ...actual.rowMetadata,
                1: { corrupt: `before application` },
              },
            }
          }
          return driver
        },
      ),
    ).rejects.toThrow(`held ${phase}`)
    expect(injected).toBe(true)
  },
)

it.each(recoveryPhases)(
  `compares stale source reads when cleanup interrupts %s`,
  async (phase) => {
    let injected = false
    await expect(
      runRecoverySchedule(
        { phase, interruption: `cleanup`, bare: true, value: 7 },
        async () => {
          const driver = await createSQLiteDriver(persistedPeerOnDemandGrammar)
          const stop = driver.stopSource
          const observe = driver.observe
          let ended = false
          driver.stopSource = () => {
            const pending = stop()
            ended = true
            return pending
          }
          driver.observe = () => {
            const actual = observe()
            if (!ended) return actual
            injected = true
            return {
              ...actual,
              rowMetadata: {
                ...actual.rowMetadata,
                1: { corrupt: `stale recovery` },
              },
            }
          }
          return driver
        },
      ),
    ).rejects.toThrow(`cleanup started`)
    expect(injected).toBe(true)
  },
)
