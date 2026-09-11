// Red baseline: phase 2's source grammar has no full-module support.
import { adapt } from '../phase2/adapters.mjs'
export function adaptModule(source,contract) {return adapt('drizzle',source)}
