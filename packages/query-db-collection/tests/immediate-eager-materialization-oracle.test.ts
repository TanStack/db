/** Node receiver of the established synchronous eager materialization cut. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-property'
import { immediateEagerMaterializationOptions } from './immediate-eager-materialization-oracle'
import { observeImmediateEagerMaterialization } from './immediate-eager-materialization-driver'

const options = immediateEagerMaterializationOptions(async (h, id, observe) => {
  await observeImmediateEagerMaterialization(h, id, observe)
}, 'node')
oracleProperty({
  ...options,
  check: (h, trace, expected) => options.check(h, trace, expected),
})

declareOracle({ owns: ['src/query.ts#queryCollectionOptions'] })
