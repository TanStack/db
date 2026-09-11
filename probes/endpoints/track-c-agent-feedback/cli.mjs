import { check } from './fixture.mjs'
try {
  const result = check(process.argv[2], Number(process.argv[3] ?? 1), process.argv[4])
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 3
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message }))
  process.exitCode = 2
}
