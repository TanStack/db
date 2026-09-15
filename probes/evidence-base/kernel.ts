export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json }

export interface Claim {
  law: string
  subject: string
  scope: Json
}

export interface Finding {
  claim: Claim
  case: Json
  passed: boolean
  value: Json
}

export interface Observation extends Finding {
  id: number
  run: number
  producer: string
  epoch: number
  /** Last committed observation when the check callback was invoked. */
  startedAfterObservation: number
}

export interface Rule {
  /** Version is part of the identifier. Registered rules are trusted code. */
  id: string
  premises: (claim: Claim) => Claim[] | undefined
  inspect: (
    claim: Claim,
    observations: readonly Observation[],
  ) => string | undefined
}

export interface Argument {
  claim: Claim
  rule: string
  observations: number[]
}

export interface Challenge {
  id: number
  observation: number
  /** Append-only replay history; current applicability is computed on use. */
  resolutions: number[]
}

export interface ArgumentAssessment {
  rule: string
  observations: number[]
  status: 'supported' | 'unresolved' | 'rejected'
  reasons: string[]
  /** All premises are required; sibling routes in Assessment are alternatives. */
  premises: Assessment[]
}

export interface Assessment {
  claim: Claim
  status: 'supported' | 'unresolved' | 'contradicted'
  observations: number[]
  rules: string[]
  reasons: string[]
  gaps: Claim[]
  routes: ArgumentAssessment[]
  challenges: number[]
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

function distinctClaims(claims: Claim[]): Claim[] {
  return [...new Map(claims.map((claim) => [identity(claim), claim])).values()]
}

/**
 * Local, trusted-process prototype. It does not sandbox plugins or authenticate
 * records against an agent that controls the process/filesystem.
 */
export class EvidenceBase {
  #rules = new Map<string, Rule>()
  #arguments = new Map<string, Argument[]>()
  #observations = new Map<number, Observation>()
  #challenges: Challenge[] = []
  #epoch = 0
  #nextRun = 1
  #nextObservation = 1

  constructor(rules: readonly Rule[]) {
    for (const rule of rules) {
      if (this.#rules.has(rule.id))
        throw new Error(`Duplicate rule: ${rule.id}`)
      this.#rules.set(rule.id, Object.freeze({ ...rule }))
    }
  }

  /** Caller must signal relevant code/data/config/environment changes. */
  advanceContext(): void {
    this.#epoch++
  }

  propose(argument: Argument): void {
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
    check: () => Promise<Finding[]>,
  ): Promise<Observation[]> {
    const epoch = this.#epoch
    const run = this.#nextRun++
    const startedAfterObservation = this.#nextObservation - 1
    const findings = structuredClone(await check())
    // Validate the whole returned batch before committing any observations.
    for (const finding of findings) {
      identity(finding.claim)
      identity(finding.case)
      identity(finding.value)
      if (typeof finding.passed !== 'boolean')
        throw new Error('Invalid check outcome')
    }
    const observations = findings.map((finding) => ({
      ...finding,
      id: this.#nextObservation++,
      run,
      producer,
      epoch,
      startedAfterObservation,
    }))
    for (const observation of observations) {
      this.#observations.set(observation.id, observation)
      if (!observation.passed) {
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
      !replay.passed ||
      replay.epoch !== this.#epoch ||
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

  history(): { observations: Observation[]; challenges: Challenge[] } {
    return structuredClone({
      observations: [...this.#observations.values()],
      challenges: this.#challenges,
    })
  }

  assess(claim: Claim): Assessment {
    return this.#assess(structuredClone(claim), new Set())
  }

  #hasApplicableResolution(challenge: Challenge): boolean {
    return challenge.resolutions.some(
      (id) => this.#observations.get(id)?.epoch === this.#epoch,
    )
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
    const observations: Observation[] = []
    for (const id of argument.observations) {
      const observation = this.#observations.get(id)
      if (
        !observation ||
        observation.epoch !== this.#epoch ||
        !observation.passed
      ) {
        return {
          ...route,
          reasons: [`Missing, stale or failing observation: ${id}`],
        }
      }
      observations.push(observation)
    }
    let premises: Claim[] | undefined
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
