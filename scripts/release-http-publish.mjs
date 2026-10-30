/** Default production entry point, isolated so a stalled tool has a hard bound. */
import { publishDuringRc } from './publish-packages.mjs'

await publishDuringRc(process.argv[2])
