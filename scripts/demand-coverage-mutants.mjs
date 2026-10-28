// Hostile mutants for persisted demand coverage.
//
// Each mutant replaces one exact piece of production code with a plausible
// wrong design. The harness applies it in memory through
// `packages/db-sqlite-persistence-core/vitest.mutants.config.ts`, runs the
// owner oracles, and expects every mutant to fail a named test unless the
// mutant is marked `equivalent` with the reason no observation can tell it
// apart. A mutant whose target no longer matches, or that never reached a
// transformed module, is an error: the list has drifted from the code.
//
// Usage: node scripts/demand-coverage-mutants.mjs [--only=P01,P02] [--list]
// The review record `docs/contributing/oracle-reviews/
// 2026-10-21-persisted-demand-coverage-review.md` describes the sweep.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, `..`)
const PACKAGE = join(ROOT, `packages/db-sqlite-persistence-core`)
const ORACLES = [
  `tests/persisted-demand-coverage-oracle.test.ts`,
  `tests/persisted-demand-coverage-campaign-oracle.test.ts`,
  `tests/persisted-readiness-oracle.test.ts`,
]
const TIMEOUT_MS = 15 * 60_000

const MUTANTS = [
  {
    id: 'P38',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'const deadlineAt = startedAt + this.persistedReadiness.networkTimeoutMs',
    replace: 'const deadlineAt = startedAt',
    rationale: 'a covered load settles from SQLite without waiting',
  },
  {
    id: 'P01',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: ': JSON.stringify(rows.map(({ key }) => key).sort())',
    replace: ': JSON.stringify(rows.map(({ key }) => key))',
    rationale:
      'windowKeys order-sensitive: window reorder without membership change uncovers',
  },
  {
    id: 'P02',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: ': JSON.stringify(rows.map(({ key }) => key).sort())',
    replace: ': undefined',
    rationale: 'windowKeys ignored: ordered windows covered by row count only',
  },
  {
    id: 'P03',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '`${DEMAND_COVERAGE_PREFIX}${getLoadSubsetDemandKey(options)}`',
    replace: '`${getLoadSubsetDemandKey(options)}`',
    rationale:
      'coverage key not namespaced: truncate prefix sweep no longer finds it',
  },
  {
    id: 'P04',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'sourceTruncateGeneration === this.sourceTruncateGeneration',
    replace: 'true',
    rationale: 'captureResetEpoch ignores source truncate generation',
  },
  {
    id: 'P05',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'resetSequence === this.resetSequence &&',
    replace: 'true &&',
    rationale: 'captureResetEpoch ignores resetSequence',
  },
  {
    id: 'P06',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      lifecycleGeneration === this.lifecycleGeneration &&\n      resetSequence === this.resetSequence &&',
    replace: '      resetSequence === this.resetSequence &&',
    rationale: 'captureResetEpoch ignores lifecycle generation',
    equivalent:
      'a replaced lifecycle has no live sync callbacks, so a late coverage record is a no-op',
  },
  {
    id: 'P07',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'if (!record || !isCurrent()) return',
    replace: 'if (!record) return',
    rationale:
      'recordCoverage: no check after the coverage read that a reset may have begun',
  },
  {
    id: 'P08',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'if (!isCurrent()) return\n        const record = await runtime.nextCoverageRecord(demand)',
    replace: 'const record = await runtime.nextCoverageRecord(demand)',
    rationale:
      'recordCoverage: early isCurrent check removed (should be EQUIVALENT: second check still guards)',
    equivalent:
      'the isCurrent check after the coverage read still guards the record',
  },
  {
    id: 'P09',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'if (current?.rows === rows.length && current.keys === keys) return undefined',
    replace: 'if (false) return undefined',
    rationale:
      'nextCoverageRecord: always rewrites record even when unchanged (should be EQUIVALENT)',
    equivalent: 'rewriting an unchanged record changes no observation',
  },
  {
    id: 'P10',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'record?.generation === this.storageCollectionId &&',
    replace: 'record !== undefined &&',
    rationale:
      'currentCoverageRecord ignores storage generation: stale-generation record counts',
  },
  {
    id: 'P11',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'rows.length >= record.rows &&',
    replace: 'rows.length > record.rows &&',
    rationale: 'isDemandCovered off-by-one: exact-count rows no longer cover',
  },
  {
    id: 'P12',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'rows.length >= record.rows &&',
    replace: 'true &&',
    rationale: 'isDemandCovered ignores row count (only window keys remain)',
  },
  {
    id: 'P13',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'windowKeys(options, rows) === record.keys',
    replace: 'true',
    rationale:
      'isDemandCovered ignores window keys: replaced row with same count still covered',
  },
  {
    id: 'P15',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'return await this.applyMutex.run(() =>',
    replace: 'return await Promise.resolve().then(() =>',
    rationale:
      'readDemandRows not serialized behind committed source transactions',
  },
  {
    id: 'P16',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '        this.scheduleCacheClaimRecovery(this.lifecycleGeneration)\n      }\n      return undefined',
    replace: '        void 0\n      }\n      return undefined',
    rationale: 'readDemandRows: expired claim does not start claim recovery',
  },
  {
    id: 'P17',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'options.refetch === true ||\n      !(await this.isDemandCovered(options))',
    replace: '!(await this.isDemandCovered(options))',
    rationale:
      'settleCoveredDemand: refetch check removed (refetch settled from coverage)',
  },
  {
    id: 'P18',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '!this.persistedReadiness?.onDemand ||\n      options.refetch',
    replace: 'options.refetch',
    rationale:
      'settleCoveredDemand: onDemand check removed (EQUIVALENT if records only exist for onDemand)',
    equivalent:
      'persisted readiness exists only for an on-demand opt-in here, so the check is redundant',
  },
  {
    id: 'P19',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '    if (options.signal?.aborted) return\n    const deadlineAt',
    replace: '    const deadlineAt',
    rationale: 'settleCoveredDemand: released load still enters the wait',
  },
  {
    id: 'P20',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'const deadlineAt = startedAt + this.persistedReadiness.networkTimeoutMs',
    replace:
      'const deadlineAt = Date.now() + this.persistedReadiness.networkTimeoutMs',
    rationale: 'deadline anchored at coverage-check time instead of load start',
  },
  {
    id: 'P21',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'Math.max(0, deadlineAt - Date.now())',
    replace: 'deadlineAt - Date.now()',
    rationale:
      'timer delay without Math.max (EQUIVALENT: negative delay fires at once)',
    equivalent: 'setTimeout treats a negative delay as zero',
  },
  {
    id: 'P22',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      options.signal?.addEventListener(`abort`, settle, { once: true })\n',
    replace: '',
    rationale: 'settleCoveredDemand: release does not end the covered wait',
  },
  {
    id: 'P23',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      return upstream\n    }\n    // A released load',
    replace: '      return\n    }\n    // A released load',
    rationale: 'uncovered load resolves without waiting for its upstream load',
  },
  {
    id: 'P24',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '    const startedAt = Date.now()\n    this.throwIfTerminal()\n    await this.ensureCacheClaimActive()',
    replace:
      '    this.throwIfTerminal()\n    await this.ensureCacheClaimActive()\n    const startedAt = Date.now()',
    rationale:
      'load start clock read after cache claim wait (wait anchored late)',
  },
  {
    id: 'P25',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      await this.settleCoveredDemand(options, upstream, startedAt)',
    replace:
      '      void this.settleCoveredDemand(options, upstream, startedAt)',
    rationale: 'loadSubset resolves before its covered settlement',
  },
  {
    id: 'P26',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '          await upstreamLoadSubset(options)\n        } catch (error) {\n          this.noteUpstreamLoadFailure(options, error)',
    replace:
      '          await upstreamLoadSubset(options)\n        } catch (error) {',
    rationale: 'loadSubset: upstream failure not noted',
    equivalent:
      'observable only through the Query DB receiving witness, outside this harness',
  },
  {
    id: 'P27',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      truncateGeneration === this.sourceTruncateGeneration &&\n      this.activeSubsets.get(subsetKey) === options\n    ) {\n      this.hydratedDemands.add',
    replace:
      '      true &&\n      this.activeSubsets.get(subsetKey) === options\n    ) {\n      this.hydratedDemands.add',
    rationale:
      'loadSubset marks demand hydrated even when a truncate intervened',
    equivalent:
      'the hydrated mark after a truncate belongs to the hydration path; the truncate already ends coverage',
  },
  {
    id: 'P28',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      this.hasExpiredCacheClaim() ||\n      !this.startupSettled ||',
    replace: '      !this.startupSettled ||',
    rationale:
      'loadHydratedSubset: settles from coverage under an expired cache claim',
    equivalent: 'a coverage read under an expired claim already proves nothing',
  },
  {
    id: 'P29',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      this.isHydratingNow() ||\n      this.canRouteRemoteDemandThroughCoordinator() ||\n      options.refetch === true ||',
    replace:
      '      this.isHydratingNow() ||\n      this.canRouteRemoteDemandThroughCoordinator() ||',
    rationale: 'loadHydratedSubset: refetch check removed',
    equivalent: 'settleCoveredDemand repeats the refetch guard',
  },
  {
    id: 'P30',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '      options.refetch === true ||\n      !this.hydratedDemands.has(getLoadSubsetDemandKey(options))',
    replace: '      options.refetch === true',
    rationale:
      'loadHydratedSubset: no restore-published-this-run gate (law condition 1)',
  },
  {
    id: 'P31',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'void recordCoverage(options, isCurrent).catch(() => undefined)\n                return true',
    replace: 'return true',
    rationale: 'synchronous answer does not record coverage',
  },
  {
    id: 'P32',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'return loaded.then(() => recordCoverage(options, isCurrent))',
    replace: 'return loaded',
    rationale: 'asynchronous answer does not record coverage',
  },
  {
    id: 'P33',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'const isCurrent = runtime.captureResetEpoch()',
    replace: 'const isCurrent = () => true',
    rationale:
      'recordCoverage ignores reset epoch (stale load records coverage)',
  },
  {
    id: 'P34',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: 'acquisitions.get(options) !== acquisition\n            ) {\n              return true',
    replace: 'false\n            ) {\n              return true',
    rationale:
      'forwardUpstream: released acquisition still starts upstream lease',
    equivalent:
      'hydration checks the abort signal at each step before it forwards a load',
  },
  {
    id: 'P35',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '        for (const { key } of wrappedParams.metadata?.collection.list(\n            DEMAND_COVERAGE_PREFIX,\n          ) ?? []) {',
    replace: '        for (const { key } of [] as Array<{ key: string }>) {',
    rationale: 'source truncate does not delete demand coverage records',
  },
  {
    id: 'P36',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '    } catch {\n      if (this.hasExpiredCacheClaim()) {\n        this.scheduleCacheClaimRecovery(this.lifecycleGeneration)\n      }\n      return undefined\n    }',
    replace:
      '    } catch (error) {\n      if (!this.hasExpiredCacheClaim()) throw error\n      this.scheduleCacheClaimRecovery(this.lifecycleGeneration)\n      return undefined\n    }',
    rationale: 'a failed coverage read fails the load',
  },
  {
    id: 'P37',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '  options.limit === undefined\n    ? undefined\n    : JSON.stringify',
    replace: '  JSON.stringify',
    rationale: 'every demand records its row keys, not only a window',
  },
  {
    id: 'P39',
    file: 'packages/db-sqlite-persistence-core/src/persisted.ts',
    find: '          !persistedReadiness ||\n          persistedReadiness.onDemand ||\n',
    replace: '          !persistedReadiness ||\n',
    rationale:
      'an on-demand Collection opens from disk after the deadline, like an eager one',
  },
]

function run(mutant) {
  const mark = join(mkdtempSync(join(tmpdir(), `db-mutant-`)), `applied`)
  return new Promise((done) => {
    execFile(
      `npx`,
      [
        `vitest`,
        `run`,
        `--config`,
        `vitest.mutants.config.ts`,
        `--bail`,
        `1`,
        ...ORACLES,
      ],
      {
        cwd: PACKAGE,
        timeout: TIMEOUT_MS,
        killSignal: `SIGKILL`,
        maxBuffer: 256 * 1024 * 1024,
        env: {
          ...process.env,
          CI: `1`,
          TANSTACK_DB_MUTANT: JSON.stringify(mutant),
          TANSTACK_DB_MUTANT_MARK: mark,
        },
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, ``)
        const failed = output.match(/^\s*×\s.*$/m)?.[0].trim()
        const applied =
          existsSync(mark) && readFileSync(mark, `utf8`).trim() !== ``
        if (!applied)
          done({ outcome: `not applied`, detail: output.slice(-2000) })
        else if (error?.killed) done({ outcome: `timeout` })
        else if (!error) done({ outcome: `survived` })
        else if (failed) done({ outcome: `killed`, detail: failed })
        else done({ outcome: `error`, detail: output.slice(-2000) })
      },
    )
  })
}

const only = process.argv
  .find((arg) => arg.startsWith(`--only=`))
  ?.slice(`--only=`.length)
  .split(`,`)
const selected = MUTANTS.filter((mutant) => !only || only.includes(mutant.id))
if (process.argv.includes(`--list`)) {
  for (const m of selected)
    console.log(`${m.id} ${m.equivalent ? `(equivalent) ` : ``}${m.rationale}`)
  process.exit(0)
}

// Validate every target before running anything.
const drifted = selected.filter(
  (m) => readFileSync(join(ROOT, m.file), `utf8`).split(m.find).length !== 2,
)
if (drifted.length > 0) {
  console.error(
    `mutant targets no longer match: ${drifted.map((m) => m.id).join(`, `)}`,
  )
  process.exit(1)
}

const failures = []
for (const mutant of selected) {
  const started = Date.now()
  const { outcome, detail } = await run(mutant)
  const expected = mutant.equivalent ? `survived` : `killed`
  const ok = outcome === expected || (mutant.equivalent && outcome === `killed`)
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(
    `${ok ? `ok ` : `BAD`} ${mutant.id} ${outcome} (${seconds}s) ${mutant.rationale}${detail && outcome === `killed` ? ` | ${detail}` : ``}`,
  )
  if (!ok) failures.push({ mutant, outcome, detail })
}
for (const { mutant, outcome, detail } of failures) {
  console.error(
    `\n${mutant.id} ${outcome}: ${mutant.rationale}\n${detail ?? ``}`,
  )
}
if (failures.length > 0) process.exit(1)
