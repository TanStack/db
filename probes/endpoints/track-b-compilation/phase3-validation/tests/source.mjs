import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const hash=source=>createHash('sha256').update(source).digest('hex')
const frozen=hash(await readFile('transform.mjs')),current=hash(await readFile('../../integrated-todo/transform.mjs'))
const result={frozen,current,matches:frozen===current}
await writeFile('evidence/source-final.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert.equal(frozen,current,'App compiler changed: refresh snapshot and rerun validation')
