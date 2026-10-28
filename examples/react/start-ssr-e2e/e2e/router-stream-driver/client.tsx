import { hydrateRoot } from 'react-dom/client'
import { RouterClient } from '@tanstack/react-router/ssr/client'
import { makeFixture } from './fixture'
import type { HostHistory, HostObservation } from './fixture'

const history = JSON.parse(
  new URL(location.href).searchParams.get(`history`)!,
) as HostHistory
const observations: Array<HostObservation> = [
  { type: `entry`, at: performance.now() },
]
window.streamViews = observations
const fixture = makeFixture(`browser`, history, (observation) =>
  observations.push(observation),
)
window.streamFixture = fixture
if (history.browserPreload) {
  const hydrate = fixture.router.options.hydrate!
  fixture.router.options.hydrate = async (state) => {
    await hydrate(state)
    await fixture.prepareBrowser()
  }
}
hydrateRoot(document, <RouterClient router={fixture.router} />, {
  onRecoverableError(error) {
    observations.push({
      type: `recoverable-error`,
      message: String(error),
      at: performance.now(),
    })
  },
})
