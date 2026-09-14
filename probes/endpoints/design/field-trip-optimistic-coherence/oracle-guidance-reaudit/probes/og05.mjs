import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { Evidence } = await import(pathToFileURL(process.cwd() + '/probes/endpoints/integrated-todo/tests/oracles/evidence.mjs'))
const expected = [[{id:'right',text:'right'}]]
const first = new Evidence('OG-05')
await assert.rejects(first.run({operation:'insert'},()=>first.check('collection-rows',[[{id:'wrong',text:'right'}]],expected,{checkpoint:'same-turn'})))
const replay = new Evidence('OG-05')
await assert.rejects(replay.replay({original:first.original},input=>replay.run(input,()=>replay.check('collection-rows',[[{id:'right',text:'wrong'}]],expected,{checkpoint:'same-turn'}))))
assert.deepEqual(first.original.failure.difference,['0','0','id'])
assert.deepEqual(replay.original.failure.difference,['0','0','text'])
assert.equal(replay.replayVerdict,'same-violation')
console.log(JSON.stringify({id:'OG-05',originalDifference:first.original.failure.difference,replayDifference:replay.original.failure.difference,verdict:replay.replayVerdict,law:'Distinct contractual fields must not count as same distinguishing evidence'}))
