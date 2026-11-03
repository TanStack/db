/**
 * # A data schedule releases tasks as its choices say
 *
 * `scheduleFrom(choices)` is the framework's schedule as plain data. Its
 * promise, from the header of `oracle-property.ts`: a task belongs to a queue;
 * each queue releases its tasks in the order they were scheduled; at each
 * step the schedule releases the oldest task of the queue that
 * `choices[step] % queues` names, counting the queues that have a pending task
 * in the order they first did, and the oldest task overall once the choices
 * run out. A released task's promise settles like the promise it wraps, and
 * the same choices give the same release order every time.
 *
 * History: two to five tasks, each in one of three queues, each resolving or
 * rejecting, and up to six choices. The model replays the rule above on the
 * task list. The driver schedules every task through `scheduleFrom`, waits
 * until idle, and records the release order and each task's outcome. The
 * check compares them.
 *
 * Limits: tasks are scheduled up front; tasks scheduled by released tasks'
 * continuations are not generated.
 */
import fc from 'fast-check'
import {
  oracleProperty,
  pass,
  scheduleFrom,
  violation,
} from './oracle-property'
import type { Observation } from './oracle-property'

type Task = { queue: `storage` | `provider` | `timer`; rejects: boolean }
type History = { tasks: Array<Task>; choices: Array<number> }

const history: fc.Arbitrary<History> = fc.record({
  tasks: fc.array(
    fc.record({
      queue: fc.constantFrom(
        `storage` as const,
        `provider` as const,
        `timer` as const,
      ),
      rejects: fc.boolean(),
    }),
    { minLength: 2, maxLength: 5 },
  ),
  choices: fc.array(fc.nat(5), { maxLength: 6 }),
})

// The rule, stated over task indexes.
function releaseOrder({ tasks, choices }: History): Array<number> {
  const pending = tasks.map((_, index) => index)
  const order: Array<number> = []
  for (let step = 0; pending.length > 0; step++) {
    const queues = [...new Set(pending.map((index) => tasks[index]!.queue))]
    const choice = choices[step]
    const at =
      choice === undefined
        ? 0
        : pending.findIndex(
            (index) => tasks[index]!.queue === queues[choice % queues.length],
          )
    order.push(...pending.splice(at, 1))
  }
  return order
}

async function driveSchedule(
  { tasks, choices }: History,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const schedule = scheduleFrom(choices)
  const outcomes: Array<string> = tasks.map(() => `pending`)
  const settled = tasks.map((task, index) =>
    schedule
      .schedule(
        task.rejects
          ? Promise.reject(new Error(`task ${index}`))
          : Promise.resolve(index),
        `${task.queue} ${index}`,
      )
      .then(
        (value) => (outcomes[index] = `resolved ${String(value)}`),
        (error: Error) => (outcomes[index] = `rejected ${error.message}`),
      ),
  )
  await schedule.waitIdle()
  await Promise.all(settled)
  observe(`schedule`, {
    released: schedule.released().map((label) => Number(label.split(` `)[1])),
    outcomes,
  })
}

function checkSchedule(
  { tasks }: History,
  trace: ReadonlyArray<Observation>,
  owed: Array<number>,
) {
  const seen = trace[0]?.value as
    { released: Array<number>; outcomes: Array<string> } | undefined
  if (!seen) return violation(`schedule`, `nothing recorded`, `trace`)
  if (JSON.stringify(seen.released) !== JSON.stringify(owed))
    return violation(
      `schedule`,
      `released ${seen.released}, owed ${owed}`,
      `release-order`,
      {
        actual: seen.released,
        expected: owed,
      },
    )
  const outcomes = tasks.map((task, index) =>
    task.rejects ? `rejected task ${index}` : `resolved ${index}`,
  )
  if (JSON.stringify(seen.outcomes) !== JSON.stringify(outcomes))
    return violation(`schedule`, `outcomes ${seen.outcomes}`, `settlement`, {
      actual: seen.outcomes,
      expected: outcomes,
    })
  return pass
}

oracleProperty({
  id: `self-oracle.scheduler`,
  law: {
    statement: `A data schedule releases the oldest task of the queue its next choice names, the oldest task overall once the choices run out, and settles each task like the promise it wraps.`,
    authority: `the scheduleFrom contract in the header of packages/db/tests/oracle-property.ts`,
    limits: `Tasks scheduled up front, in up to three queues; no tasks scheduled by continuations.`,
    owner: `oracleProperty framework`,
  },
  histories: {
    arbitrary: history,
    runs: 100,
    fixedSeeds: [20261103],
    pins: [
      {
        name: `a queue keeps its order while another advances`,
        history: {
          tasks: [
            { queue: `storage`, rejects: false },
            { queue: `storage`, rejects: false },
            { queue: `provider`, rejects: true },
          ],
          choices: [1, 0, 0],
        },
      },
    ],
  },
  model: releaseOrder,
  driver: driveSchedule,
  check: checkSchedule,
})
