import type {
  CapturedDependency,
  CheckContract,
  CheckExecution,
  EvidenceDependency,
  EvidenceOutcome,
} from './protocol.ts'

export type Json =
  | null
  | boolean
  | number
  | string
  | Array<Json>
  | { [key: string]: Json }

export interface Claim {
  law: string
  subject: string
  scope: Json
}

export interface Finding {
  claim: Claim
  case: Json
  /** `passed` remains accepted for v1 callers; v2 callers should use outcome. */
  passed?: boolean
  outcome?: EvidenceOutcome
  value: Json
}

export interface Observation extends Finding {
  id: number
  run: number
  producer: string
  epoch: number
  outcome: EvidenceOutcome
  passed: boolean
  dependencies: Array<CapturedDependency>
  check?: CheckContract
  /** Last committed observation when the check callback was invoked. */
  startedAfterObservation: number
}

export interface Rule {
  /** Version is part of the identifier. Registered rules are trusted code. */
  id: string
  premises: (claim: Claim) => Array<Claim> | undefined
  inspect: (
    claim: Claim,
    observations: ReadonlyArray<Observation>,
  ) => string | undefined
}

export interface Argument {
  claim: Claim
  rule: string
  observations: Array<number>
}

export interface Challenge {
  id: number
  observation: number
  /** Append-only replay history; current applicability is computed on use. */
  resolutions: Array<number>
}

export interface ArgumentAssessment {
  rule: string
  observations: Array<number>
  status: 'supported' | 'unresolved' | 'rejected'
  reasons: Array<string>
  /** All premises are required; sibling routes in Assessment are alternatives. */
  premises: Array<Assessment>
}

export interface Assessment {
  claim: Claim
  status: 'supported' | 'unresolved' | 'contradicted'
  observations: Array<number>
  rules: Array<string>
  reasons: Array<string>
  gaps: Array<Claim>
  routes: Array<ArgumentAssessment>
  challenges: Array<number>
}

export interface EvidenceState {
  format: 'evidence-base/v2'
  epoch: number
  dependencies: Array<CapturedDependency>
  nextRun: number
  nextObservation: number
  arguments: Array<Argument>
  observations: Array<Observation>
  challenges: Array<Challenge>
}

export class CheckDidNotReachProductionPathError extends Error {
  constructor(check: CheckContract) {
    super(`Check did not reach production path: ${check.productionPath}`)
    this.name = 'CheckDidNotReachProductionPathError'
  }
}

/** Exact JSON identity, not domain-specific equivalence or subsumption. */
export function identity(value: Json | Claim): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Context must contain finite JSON numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(identity).join(',')}]`
  if (typeof value !== 'object') throw new Error('Expected JSON data')
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const field = (value as { [key: string]: Json })[key]
      return `${JSON.stringify(key)}:${identity(field)}`
    })
    .join(',')}}`
}

function distinctClaims(claims: Array<Claim>): Array<Claim> {
  return [...new Map(claims.map((claim) => [identity(claim), claim])).values()]
}

function dependencyKey(dependency: Pick<EvidenceDependency, 'kind' | 'name'>) {
  return `${dependency.kind}\0${dependency.name}`
}

function normalizeOutcome(finding: Finding): EvidenceOutcome {
  if (finding.outcome) {
    if (
      finding.passed !== undefined &&
      finding.passed !== (finding.outcome === 'pass')
    )
      throw new Error('Finding outcome and passed flag disagree')
    return finding.outcome
  }
  if (typeof finding.passed !== 'boolean')
    throw new Error('Finding requires outcome or passed')
  return finding.passed ? 'pass' : 'fail'
}

function validateDependency(dependency: EvidenceDependency): void {
  if (
    !['code', 'data', 'config', 'environment', 'method', 'external'].includes(
      dependency.kind,
    ) ||
    !dependency.name ||
    !dependency.fingerprint
  )
    throw new Error('Invalid evidence dependency')
}

function validateCheck(check: CheckContract): void {
  if (
    !check.id ||
    !Number.isSafeInteger(check.version) ||
    check.version < 1 ||
    !check.law ||
    !check.source ||
    !check.domain ||
    !check.productionPath ||
    !check.checkpoint ||
    !check.reachWitness ||
    !check.replay ||
    !Array.isArray(check.observes) ||
    !Array.isArray(check.omissions) ||
    !Array.isArray(check.faultControls) ||
    ![
      'model',
      'differential',
      'metamorphic',
      'invariant',
      'certificate',
      'recorded',
    ].includes(check.reference.kind) ||
    !check.reference.description ||
    !Array.isArray(check.reference.trusted)
  )
    throw new Error('Invalid check contract')
}

/**
 * Local, trusted-process prototype. It does not sandbox plugins or authenticate
 * records against an agent that controls the process/filesystem.
 */
export class EvidenceBase {
  #rules = new Map<string, Rule>()
  #arguments = new Map<string, Array<Argument>>()
  #observations = new Map<number, Observation>()
  #challenges: Array<Challenge> = []
  #dependencies = new Map<string, CapturedDependency>()
  #epoch = 0
  #nextRun = 1
  #nextObservation = 1

  constructor(rules: ReadonlyArray<Rule>) {
    for (const rule of rules) {
      if (this.#rules.has(rule.id))
        throw new Error(`Duplicate rule: ${rule.id}`)
      this.#rules.set(rule.id, Object.freeze({ ...rule }))
    }
  }

  static #validateState(input: unknown): EvidenceState {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid evidence state')
    const rawState = structuredClone(input) as { format?: unknown }
    if (rawState.format !== 'evidence-base/v2')
      throw new Error('Invalid evidence state')
    const state = rawState as EvidenceState
    if (
      !Number.isSafeInteger(state.epoch) ||
      state.epoch < 0 ||
      !Number.isSafeInteger(state.nextRun) ||
      !Number.isSafeInteger(state.nextObservation) ||
      !Array.isArray(state.dependencies) ||
      !Array.isArray(state.arguments) ||
      !Array.isArray(state.observations) ||
      !Array.isArray(state.challenges)
    )
      throw new Error('Invalid evidence state')

    const dependencyKeys = new Set<string>()
    for (const dependency of state.dependencies) {
      validateDependency(dependency)
      if (!Number.isSafeInteger(dependency.revision) || dependency.revision < 1)
        throw new Error('Invalid dependency revision')
      const key = dependencyKey(dependency)
      if (dependencyKeys.has(key)) throw new Error('Duplicate dependency state')
      dependencyKeys.add(key)
    }

    const observationIds = new Set<number>()
    let maximumRun = 0
    let maximumObservation = 0
    for (const observation of state.observations) {
      identity(observation.claim)
      identity(observation.case)
      identity(observation.value)
      if (
        !Number.isSafeInteger(observation.id) ||
        observation.id < 1 ||
        observationIds.has(observation.id) ||
        !Number.isSafeInteger(observation.run) ||
        observation.run < 1 ||
        !Number.isSafeInteger(observation.epoch) ||
        observation.epoch < 0 ||
        !Number.isSafeInteger(observation.startedAfterObservation) ||
        observation.startedAfterObservation < 0 ||
        !['pass', 'fail', 'unresolved'].includes(observation.outcome) ||
        observation.passed !== (observation.outcome === 'pass') ||
        !observation.producer ||
        !Array.isArray(observation.dependencies)
      )
        throw new Error('Invalid observation')
      observationIds.add(observation.id)
      maximumRun = Math.max(maximumRun, observation.run)
      maximumObservation = Math.max(maximumObservation, observation.id)
      for (const dependency of observation.dependencies) {
        validateDependency(dependency)
        if (
          !Number.isSafeInteger(dependency.revision) ||
          dependency.revision < 1
        )
          throw new Error('Invalid captured dependency')
      }
      if (observation.check) {
        validateCheck(observation.check)
        if (observation.check.law !== observation.claim.law)
          throw new Error('Check law does not match observation')
      }
    }
    if (
      state.nextRun <= maximumRun ||
      state.nextObservation <= maximumObservation
    )
      throw new Error('Evidence counters do not follow imported history')

    for (const argument of state.arguments) {
      identity(argument.claim)
      if (!argument.rule || !Array.isArray(argument.observations))
        throw new Error('Invalid argument')
      if (argument.observations.some((id) => !observationIds.has(id)))
        throw new Error('Argument references an unknown observation')
    }

    const challenges = new Set<number>()
    for (const challenge of state.challenges) {
      const failed = state.observations.find(
        (observation) => observation.id === challenge.observation,
      )
      if (
        !Number.isSafeInteger(challenge.id) ||
        challenge.id < 1 ||
        challenges.has(challenge.id) ||
        failed?.outcome !== 'fail' ||
        !Array.isArray(challenge.resolutions)
      )
        throw new Error('Invalid challenge')
      challenges.add(challenge.id)
      for (const resolution of challenge.resolutions) {
        const replay = state.observations.find(
          (observation) => observation.id === resolution,
        )
        if (
          replay?.outcome !== 'pass' ||
          replay.startedAfterObservation < failed.id ||
          identity(replay.claim) !== identity(failed.claim) ||
          identity(replay.case) !== identity(failed.case)
        )
          throw new Error('Invalid challenge resolution')
      }
    }
    return state
  }

  static fromState(rules: ReadonlyArray<Rule>, input: unknown): EvidenceBase {
    const state = EvidenceBase.#validateState(input)
    const base = new EvidenceBase(rules)
    base.#epoch = state.epoch
    base.#nextRun = state.nextRun
    base.#nextObservation = state.nextObservation
    base.#dependencies = new Map(
      state.dependencies.map((dependency) => [
        dependencyKey(dependency),
        structuredClone(dependency),
      ]),
    )
    for (const argument of state.arguments) {
      const key = identity(argument.claim)
      const existing = base.#arguments.get(key) ?? []
      existing.push(structuredClone(argument))
      base.#arguments.set(key, existing)
    }
    base.#observations = new Map(
      state.observations.map((observation) => [
        observation.id,
        structuredClone(observation),
      ]),
    )
    base.#challenges = structuredClone(state.challenges)
    return base
  }

  exportState(): EvidenceState {
    return structuredClone({
      format: 'evidence-base/v2',
      epoch: this.#epoch,
      dependencies: [...this.#dependencies.values()],
      nextRun: this.#nextRun,
      nextObservation: this.#nextObservation,
      arguments: [...this.#arguments.values()].flat(),
      observations: [...this.#observations.values()],
      challenges: this.#challenges,
    })
  }

  /**
   * Register the currently observed dependency versions. A changed fingerprint
   * advances a monotonic revision, so returning to old bytes cannot revive old
   * evidence. Dependencies not named here retain their current versions.
   */
  updateDependencies(
    dependencies: ReadonlyArray<EvidenceDependency>,
  ): Array<CapturedDependency> {
    const seen = new Set<string>()
    return dependencies.map((dependency) => {
      validateDependency(dependency)
      const key = dependencyKey(dependency)
      if (seen.has(key)) throw new Error(`Duplicate dependency: ${key}`)
      seen.add(key)
      const previous = this.#dependencies.get(key)
      const current: CapturedDependency = {
        ...structuredClone(dependency),
        revision:
          previous === undefined
            ? 1
            : previous.fingerprint === dependency.fingerprint
              ? previous.revision
              : previous.revision + 1,
      }
      this.#dependencies.set(key, current)
      return structuredClone(current)
    })
  }

  currentDependencies(): Array<CapturedDependency> {
    return structuredClone([...this.#dependencies.values()])
  }

  /** Caller must signal relevant code/data/config/environment changes. */
  advanceContext(): void {
    this.#epoch++
  }

  propose(argument: Argument): void {
    if (!argument.rule || !Array.isArray(argument.observations))
      throw new Error('Invalid argument')
    if (argument.observations.some((id) => !this.#observations.has(id)))
      throw new Error('Argument references an unknown observation')
    const key = identity(argument.claim)
    const existing = this.#arguments.get(key) ?? []
    existing.push(structuredClone(argument))
    this.#arguments.set(key, existing)
  }

  /**
   * The runner records failures itself; callers cannot selectively submit the
   * green subset. Throwing before a result is an operational error, not evidence.
   * The supplied checker and producer label are trusted local inputs.
   * The callback must execute the check, not return a cached earlier measurement.
   */
  async run(
    producer: string,
    check: () => Promise<Array<Finding>>,
  ): Promise<Array<Observation>> {
    const epoch = this.#epoch
    const run = this.#nextRun++
    const startedAfterObservation = this.#nextObservation - 1
    const findings = structuredClone(await check())
    return this.#commitRun({
      producer,
      epoch,
      run,
      startedAfterObservation,
      dependencies: [],
      findings,
    })
  }

  /**
   * Run a source-described check. Failure and unresolved outcomes are evidence;
   * inability to reach the named production path is an operational error and
   * commits nothing.
   */
  async runCheck(
    contract: CheckContract,
    producer: string,
    dependencies: ReadonlyArray<EvidenceDependency>,
    check: () => Promise<CheckExecution<Finding>>,
  ): Promise<Array<Observation>> {
    validateCheck(contract)
    const captured = this.updateDependencies(dependencies)
    const epoch = this.#epoch
    const run = this.#nextRun++
    const startedAfterObservation = this.#nextObservation - 1
    const execution = structuredClone(await check())
    if (!execution.reached)
      throw new CheckDidNotReachProductionPathError(contract)
    if (!Array.isArray(execution.findings))
      throw new Error('Invalid check execution')
    for (const finding of execution.findings)
      if (finding.claim.law !== contract.law)
        throw new Error('Check returned a finding for another law')
    return this.#commitRun({
      producer,
      epoch,
      run,
      startedAfterObservation,
      dependencies: captured,
      check: contract,
      findings: execution.findings,
    })
  }

  #commitRun(input: {
    producer: string
    epoch: number
    run: number
    startedAfterObservation: number
    dependencies: Array<CapturedDependency>
    check?: CheckContract
    findings: Array<Finding>
  }): Array<Observation> {
    if (!input.producer || !Array.isArray(input.findings))
      throw new Error('Invalid check result')
    const normalized = input.findings.map((finding) => {
      identity(finding.claim)
      identity(finding.case)
      identity(finding.value)
      const outcome = normalizeOutcome(finding)
      return {
        ...structuredClone(finding),
        outcome,
        passed: outcome === 'pass',
      }
    })
    const observations: Array<Observation> = normalized.map((finding) => ({
      ...finding,
      id: this.#nextObservation++,
      run: input.run,
      producer: input.producer,
      epoch: input.epoch,
      dependencies: structuredClone(input.dependencies),
      ...(input.check ? { check: structuredClone(input.check) } : {}),
      startedAfterObservation: input.startedAfterObservation,
    }))
    for (const observation of observations) {
      this.#observations.set(observation.id, observation)
      if (observation.outcome === 'fail') {
        this.#challenges.push({
          id: this.#challenges.length + 1,
          observation: observation.id,
          resolutions: [],
        })
      }
    }
    return structuredClone(observations)
  }

  /**
   * Explicit same-law, same-case replay resolution. A new green run alone does
   * not resolve anything. Semantic equality of checker implementations is a
   * package obligation; opaque case IDs cannot establish that equality.
   * A replay must start after the failure is recorded, and must remain current.
   */
  resolve(challengeId: number, replayId: number): void {
    const challenge = this.#challenges.find((entry) => entry.id === challengeId)
    const failed = challenge && this.#observations.get(challenge.observation)
    const replay = this.#observations.get(replayId)
    if (
      !challenge ||
      !failed ||
      !replay ||
      this.#hasApplicableResolution(challenge) ||
      replay.outcome !== 'pass' ||
      !this.#isApplicable(replay) ||
      replay.startedAfterObservation < failed.id ||
      identity(replay.claim) !== identity(failed.claim) ||
      identity(replay.case) !== identity(failed.case)
    ) {
      throw new Error(
        'Resolution requires a fresh replay of the original law and case',
      )
    }
    challenge.resolutions.push(replayId)
  }

  history(): { observations: Array<Observation>; challenges: Array<Challenge> } {
    return structuredClone({
      observations: [...this.#observations.values()],
      challenges: this.#challenges,
    })
  }

  assess(claim: Claim): Assessment {
    return this.#assess(structuredClone(claim), new Set())
  }

  #hasApplicableResolution(challenge: Challenge): boolean {
    return challenge.resolutions.some((id) => {
      const observation = this.#observations.get(id)
      return observation !== undefined && this.#isApplicable(observation)
    })
  }

  #isApplicable(observation: Observation): boolean {
    if (observation.epoch !== this.#epoch) return false
    return observation.dependencies.every((captured) => {
      const current = this.#dependencies.get(dependencyKey(captured))
      return (
        current?.revision === captured.revision &&
        current.fingerprint === captured.fingerprint
      )
    })
  }

  #assess(claim: Claim, ancestors: Set<string>): Assessment {
    const key = identity(claim)
    const result: Assessment = {
      claim,
      status: 'unresolved',
      observations: [],
      rules: [],
      reasons: [],
      gaps: [],
      routes: [],
      challenges: [],
    }
    const failures = this.#challenges.filter((challenge) => {
      const observation = this.#observations.get(challenge.observation)!
      // Same logical failures remain relevant; resolutions also need current evidence.
      return (
        !this.#hasApplicableResolution(challenge) &&
        identity(observation.claim) === key
      )
    })
    if (failures.length) {
      return {
        ...result,
        status: 'contradicted',
        challenges: failures.map((failure) => failure.id),
        reasons: failures.map(
          (failure) => `Unresolved counterexample ${failure.id}`,
        ),
      }
    }
    if (ancestors.has(key))
      return { ...result, reasons: ['Circular support'], gaps: [claim] }
    const path = new Set([...ancestors, key])
    const candidates = this.#arguments.get(key) ?? []
    result.routes = candidates.map((argument) =>
      this.#assessArgument(argument, claim, path),
    )
    const selected = result.routes.find((route) => route.status === 'supported')
    if (selected) {
      return {
        ...result,
        status: 'supported',
        observations: [
          ...new Set([
            ...selected.observations,
            ...selected.premises.flatMap((child) => child.observations),
          ]),
        ],
        rules: [
          ...new Set([
            selected.rule,
            ...selected.premises.flatMap((child) => child.rules),
          ]),
        ],
      }
    }
    result.reasons = result.routes.flatMap((route) => [
      ...route.reasons,
      ...route.premises.flatMap((child) => child.reasons),
    ])
    const gaps = result.routes.flatMap((route) =>
      route.premises
        .filter((child) => child.status !== 'supported')
        .flatMap((child) => (child.gaps.length ? child.gaps : [child.claim])),
    )
    if (!candidates.length) result.reasons.push('No proposed argument')
    result.gaps = distinctClaims(gaps.length ? gaps : [claim])
    return result
  }

  #assessArgument(
    argument: Argument,
    claim: Claim,
    path: Set<string>,
  ): ArgumentAssessment {
    const route: ArgumentAssessment = {
      rule: argument.rule,
      observations: [...argument.observations],
      status: 'rejected',
      reasons: [],
      premises: [],
    }
    const rule = this.#rules.get(argument.rule)
    if (!rule)
      return { ...route, reasons: [`Unregistered rule: ${argument.rule}`] }
    const observations: Array<Observation> = []
    for (const id of argument.observations) {
      const observation = this.#observations.get(id)
      if (!observation || !this.#isApplicable(observation)) {
        return {
          ...route,
          reasons: [`Missing or stale observation: ${id}`],
        }
      }
      if (observation.outcome !== 'pass')
        return {
          ...route,
          reasons: [
            observation.outcome === 'unresolved'
              ? `Unresolved observation: ${id}`
              : `Failing observation: ${id}`,
          ],
        }
      observations.push(observation)
    }
    let premises: Array<Claim> | undefined
    let rejection: string | undefined
    try {
      premises = rule.premises(structuredClone(claim))
      if (premises)
        rejection = rule.inspect(
          structuredClone(claim),
          structuredClone(observations),
        )
    } catch {
      rejection = `Rule error: ${rule.id}`
    }
    if (!premises || rejection) {
      return {
        ...route,
        reasons: [
          rejection ?? `Rule does not establish this claim: ${rule.id}`,
        ],
      }
    }
    const children = premises.map((premise) => this.#assess(premise, path))
    return {
      ...route,
      status: children.every((child) => child.status === 'supported')
        ? 'supported'
        : 'unresolved',
      premises: children,
    }
  }
}
