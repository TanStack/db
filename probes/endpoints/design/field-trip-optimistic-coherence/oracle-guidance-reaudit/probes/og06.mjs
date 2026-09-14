import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const app = process.cwd() + '/probes/endpoints/integrated-todo'
const { Evidence } = await import(pathToFileURL(app + '/tests/oracles/evidence.mjs'))
const source = await readFile(app + '/tests/oracles/dependencies.mjs', 'utf8')
const callback = source.match(/async \(program, histories\) => \{\s*for \(const history of histories\) await run\(program, history\)\s*\}/)?.[0]
assert.ok(callback, 'Extract the actual fast-check callback, not a copied loop')
for (const wrapped of [false, true]) {
 const e = new Evidence('OG-06'), visited = []
 const run = (program, steps) => e.run({program,steps}, () => {
   visited.push(steps)
   e.check(steps === 'build' ? 'other-law' : 'rows', 9, 1, {checkpoint:'settled'})
 })
 const generated = new Function('run', `return (${callback})`)(run)
 await assert.rejects(run({}, 'original'))
 const candidate = () => generated({}, ['build','later-rows'])
 if (wrapped) await e.run({histories:['build','later-rows']}, candidate)
 else await assert.rejects(candidate())
 assert.equal(visited.includes('later-rows'), !wrapped)
 assert.equal(e.reduced.input.steps, wrapped ? 'original' : 'later-rows')
 console.log(JSON.stringify({id:'OG-06',control:wrapped?'outer-case guard':'current runner callback',visited,reduced:e.reduced.input,rejected:e.rejectedShrinks.length,originalPreserved:wrapped}))
}
