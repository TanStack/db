import {resolve} from 'node:path'
const repo=resolve(import.meta.dirname,'../../..')
const local=resolve(import.meta.dirname,'node_modules')
export default {
 root:repo,
 resolve:{alias:[
  {find:'mitt',replacement:'/Users/kylemathews/programs/tanstack-db/packages/db/node_modules/mitt'},
  {find:'vitest',replacement:'/Users/kylemathews/programs/tanstack-db/node_modules/vitest/dist/index.js'},
  {find:'@tanstack/db-ivm',replacement:resolve(repo,'packages/db-ivm/src/index.ts')},
  ...['@tanstack/pacer-lite','fractional-indexing','sorted-btree'].map(name=>({find:name,replacement:resolve(local,name)})),
 ]},
 test:{include:['packages/db/tests/optimistic-ordering.test.ts','packages/db/tests/deterministic-ordering.test.ts','packages/db/tests/collection.test.ts'],environment:'node'},
}
