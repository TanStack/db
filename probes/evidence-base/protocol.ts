export type EvidenceOutcome = 'pass' | 'fail' | 'unresolved'

export type DependencyKind =
  | 'code'
  | 'data'
  | 'config'
  | 'environment'
  | 'method'
  | 'external'

export interface EvidenceDependency {
  kind: DependencyKind
  name: string
  fingerprint: string
}

export interface CapturedDependency extends EvidenceDependency {
  revision: number
}

export interface CheckContract {
  id: string
  version: number
  law: string
  source: string
  domain: string
  reference: {
    kind:
      | 'model'
      | 'differential'
      | 'metamorphic'
      | 'invariant'
      | 'certificate'
      | 'recorded'
    description: string
    trusted: Array<string>
  }
  productionPath: string
  checkpoint: string
  observes: Array<string>
  omissions: Array<string>
  reachWitness: string
  faultControls: Array<string>
  replay: string
}

export interface CheckExecution<TFinding> {
  reached: boolean
  findings: Array<TFinding>
  diagnostics?: unknown
}
