import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { CoverageRegistry } from '../../src/query/coverage-registry.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import type { AppliedLoadSubsetOutcome } from '../../src/types.js'
import type { Command } from 'fast-check'

type LifecycleState =
  | `initial`
  | `provisional`
  | `active`
  | `applied`
  | `release-pending`
  | `failed`
  | `released`
  | `disposed`

type ReleaseMode = `lease` | `dispose`
type PrefixCoverage = Readonly<{ prefix: number }>

type LifecycleModel = {
  state: LifecycleState
  applied: boolean
  releaseAccepted: boolean
  releaseCalls: number
  releaseMode?: ReleaseMode
}

type ReleaseProbe = {
  accepted: boolean
  calls: number
  release: () => void
}

type PrefixRegistry = CoverageRegistry<number, PrefixCoverage, string>

type LifecycleReal = {
  registry: PrefixRegistry
  lease?: ReturnType<PrefixRegistry[`addLease`]>
  acquisition?: ReturnType<PrefixRegistry[`addAcquisition`]>
  release: ReleaseProbe
}

function createRegistry(): PrefixRegistry {
  return new CoverageRegistry({
    coversDemand: (coverage, demand) => coverage.prefix >= demand,
    coversCoverage: (coverage, candidate) =>
      coverage.prefix >= candidate.prefix,
    snapshotCoverage: (coverage) => Object.freeze({ ...coverage }),
    projectAppliedCoverage: ({ outcome, rows }) =>
      outcome.extent === `exhausted` && rows.size >= 1
        ? { prefix: 1 }
        : undefined,
  })
}

function createReleaseProbe(): ReleaseProbe {
  const probe: ReleaseProbe = {
    accepted: false,
    calls: 0,
    release: () => {
      probe.calls++
      if (!probe.accepted) throw new Error(`release not durably accepted`)
    },
  }
  return probe
}

function appliedOutcome(generation = 1): AppliedLoadSubsetOutcome {
  return {
    collectionId: `scheduled-lifecycle`,
    sourceId: `items`,
    demand: { limit: 1 },
    generation,
    extent: `exhausted`,
    appliedRowKeys: [`row`],
  }
}

function expectReleasePending(operation: () => unknown): void {
  expect(operation).toThrow(`release not durably accepted`)
}

function assertLifecycle(model: LifecycleModel, real: LifecycleReal): void {
  const ownsAppliedRow =
    model.applied &&
    model.state !== `released` &&
    model.state !== `disposed` &&
    model.state !== `failed`
  const publishesCoverage =
    ownsAppliedRow &&
    (model.state === `applied` || model.state === `release-pending`)

  expect(real.registry.rowOwnerCount(`row`)).toBe(ownsAppliedRow ? 1 : 0)
  expect(real.registry.coverageAntichain()).toEqual(
    publishesCoverage ? [{ prefix: 1 }] : [],
  )
  expect(real.release.calls).toBe(model.releaseCalls)
}

abstract class LifecycleCommand implements Command<
  LifecycleModel,
  LifecycleReal
> {
  abstract check(model: Readonly<LifecycleModel>): boolean
  abstract run(model: LifecycleModel, real: LifecycleReal): void
  abstract toString(): string

  protected assert(model: LifecycleModel, real: LifecycleReal): void {
    assertLifecycle(model, real)
  }
}

class StartDemandCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) => model.state === `initial`

  run(model: LifecycleModel, real: LifecycleReal): void {
    real.lease = real.registry.addLease(1)
    model.state = `provisional`
    this.assert(model, real)
  }

  toString = () => `startDemand`
}

class ActivateDemandCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) => model.state === `provisional`

  run(model: LifecycleModel, real: LifecycleReal): void {
    real.acquisition = real.registry.addAcquisition({
      generation: 1,
      scope: {
        collectionId: `scheduled-lifecycle`,
        sourceId: `items`,
        demand: { limit: 1 },
      },
      leases: [real.lease!],
      release: real.release.release,
    })
    model.state = `active`
    this.assert(model, real)
  }

  toString = () => `activateDemand`
}

class ApplyOutcomeCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) => model.state === `active`

  run(model: LifecycleModel, real: LifecycleReal): void {
    real.registry.replaceRows(real.acquisition!, new Set([`row`]))
    expect(
      real.registry.publishOutcome(real.acquisition!, appliedOutcome()),
    ).toMatchObject({ accepted: true, published: true })
    model.state = `applied`
    model.applied = true
    this.assert(model, real)
  }

  toString = () => `applyOutcome`
}

class FailProvisionalCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) => model.state === `provisional`

  run(model: LifecycleModel, real: LifecycleReal): void {
    expect(real.registry.releaseLease(real.lease!)).toEqual({
      rowsToRemove: [],
    })
    model.state = `failed`
    this.assert(model, real)
  }

  toString = () => `failProvisional`
}

class PublishStaleGenerationCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) => model.state === `active`

  run(model: LifecycleModel, real: LifecycleReal): void {
    expect(
      real.registry.publishOutcome(real.acquisition!, appliedOutcome(0)),
    ).toMatchObject({ accepted: false, published: false })
    this.assert(model, real)
  }

  toString = () => `publishStaleGeneration`
}

class RequestReleaseCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) =>
    model.state === `active` || model.state === `applied`

  run(model: LifecycleModel, real: LifecycleReal): void {
    expectReleasePending(() => real.registry.releaseLease(real.lease!))
    model.state = `release-pending`
    model.releaseMode = `lease`
    model.releaseCalls++
    this.assert(model, real)
  }

  toString = () => `requestRelease`
}

class RetryPendingReleaseCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) =>
    model.state === `release-pending` && !model.releaseAccepted

  run(model: LifecycleModel, real: LifecycleReal): void {
    expectReleasePending(() =>
      model.releaseMode === `dispose`
        ? real.registry.dispose()
        : real.registry.releaseLease(real.lease!),
    )
    model.releaseCalls++
    this.assert(model, real)
  }

  toString = () => `retryPendingRelease`
}

class AcceptPendingReleaseCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) =>
    model.state === `release-pending` && !model.releaseAccepted

  run(model: LifecycleModel, real: LifecycleReal): void {
    real.release.accepted = true
    const result =
      model.releaseMode === `dispose`
        ? real.registry.dispose()
        : real.registry.releaseLease(real.lease!)
    expect(result.rowsToRemove).toEqual(model.applied ? [`row`] : [])
    model.releaseAccepted = true
    model.releaseCalls++
    model.state = model.releaseMode === `dispose` ? `disposed` : `released`
    this.assert(model, real)
  }

  toString = () => `acceptPendingRelease`
}

class DisposeCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) =>
    model.state === `initial` ||
    model.state === `provisional` ||
    model.state === `active` ||
    model.state === `applied`

  run(model: LifecycleModel, real: LifecycleReal): void {
    if (model.state === `active` || model.state === `applied`) {
      expectReleasePending(() => real.registry.dispose())
      model.state = `release-pending`
      model.releaseMode = `dispose`
      model.releaseCalls++
    } else {
      expect(real.registry.dispose()).toEqual({ rowsToRemove: [] })
      model.state = `disposed`
    }
    this.assert(model, real)
  }

  toString = () => `dispose`
}

class PublishLateOutcomeCommand extends LifecycleCommand {
  check = (model: Readonly<LifecycleModel>) =>
    model.state === `released` || model.state === `disposed`

  run(model: LifecycleModel, real: LifecycleReal): void {
    if (real.acquisition) {
      expect(
        real.registry.publishOutcome(real.acquisition, appliedOutcome(2)),
      ).toMatchObject({ accepted: false, published: false })
    }
    this.assert(model, real)
  }

  toString = () => `publishLateOutcome`
}

const commandArbitraries = [
  fc.constant(new StartDemandCommand()),
  fc.constant(new ActivateDemandCommand()),
  fc.constant(new ApplyOutcomeCommand()),
  fc.constant(new FailProvisionalCommand()),
  fc.constant(new PublishStaleGenerationCommand()),
  fc.constant(new RequestReleaseCommand()),
  fc.constant(new RetryPendingReleaseCommand()),
  fc.constant(new AcceptPendingReleaseCommand()),
  fc.constant(new DisposeCommand()),
  fc.constant(new PublishLateOutcomeCommand()),
]

function createLifecyclePair(): {
  model: LifecycleModel
  real: LifecycleReal
} {
  return {
    model: {
      state: `initial`,
      applied: false,
      releaseAccepted: false,
      releaseCalls: 0,
    },
    real: {
      registry: createRegistry(),
      release: createReleaseProbe(),
    },
  }
}

function runHistory(commands: ReadonlyArray<LifecycleCommand>): void {
  const { model, real } = createLifecyclePair()
  for (const command of commands) {
    expect(command.check(model)).toBe(true)
    command.run(model, real)
  }
}

it(`keeps applied ownership until release is durably accepted`, () => {
  runHistory([
    new StartDemandCommand(),
    new ActivateDemandCommand(),
    new ApplyOutcomeCommand(),
    new RequestReleaseCommand(),
    new RetryPendingReleaseCommand(),
    new AcceptPendingReleaseCommand(),
    new PublishLateOutcomeCommand(),
  ])
})

it(`keeps teardown retryable while physical release is not accepted`, () => {
  runHistory([
    new StartDemandCommand(),
    new ActivateDemandCommand(),
    new ApplyOutcomeCommand(),
    new DisposeCommand(),
    new AcceptPendingReleaseCommand(),
    new PublishLateOutcomeCommand(),
  ])
})

it(`publishes neither provisional nor stale-generation coverage`, () => {
  runHistory([new StartDemandCommand(), new FailProvisionalCommand()])
  runHistory([
    new StartDemandCommand(),
    new ActivateDemandCommand(),
    new PublishStaleGenerationCommand(),
  ])
})

fcTest.prop(
  [
    fc.commands<LifecycleModel, LifecycleReal>(commandArbitraries, {
      maxCommands: 20,
    }),
  ],
  oraclePropertyOptions(100),
)(
  `matches the scheduled acquisition, coverage, release, teardown, and stale-settlement lifecycle`,
  (commands) => {
    fc.modelRun(
      () => ({
        ...createLifecyclePair(),
      }),
      commands,
    )
  },
)
