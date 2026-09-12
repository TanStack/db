import type { ScenarioLifetime } from './scenario-lifetime'

type Source = { cleanup: () => Promise<void> }

/** Sources created by a scenario, not external consumer-owned collections. */
export class ScenarioSources {
  private readonly sources = new Set<Source>()

  track<H extends { collection: Source }>(handle: H): H {
    this.sources.add(handle.collection)
    return handle
  }

  /** Register after the body so mounted handles and held gates release first. */
  defer(lifetime: ScenarioLifetime): void {
    for (const source of this.sources) lifetime.defer(() => source.cleanup())
  }
}
