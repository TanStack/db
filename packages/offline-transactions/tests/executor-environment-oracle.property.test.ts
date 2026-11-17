import { registerExecutorEnvironment } from './executor-environment-oracle'

// Keep bounded initialization observations in a separate receiving unit.
// A different lifecycle owner's missing-init wait can time out without erasing
// this owner's named initialization-completion or unhandled-rejection verdict.
registerExecutorEnvironment({ owns: [`src/OfflineExecutor.ts`] })
