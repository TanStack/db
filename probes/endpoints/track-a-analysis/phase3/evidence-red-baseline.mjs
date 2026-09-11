// Red baseline: reusing a new disposable fixture loses actual app provenance.
import {fixtureContext} from '../phase2/context.mjs'
export async function verifyEvidence(){return {status:'checked',context:await fixtureContext()}}
