import {
  runSQLiteBindingCapacityOracleSuite,
  runSQLiteCoreAdapterContractSuite,
} from './sqlite-core-adapter-oracle.test'

runSQLiteCoreAdapterContractSuite(`SQLiteCorePersistenceAdapter (sqlite3 CLI)`)
runSQLiteBindingCapacityOracleSuite()
