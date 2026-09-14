import assert from 'node:assert/strict'
import fc from 'fast-check'
import { controls, schemaScenario } from './schema-cases.mjs'
import { renderSchemaDatabase } from './schema-program.mjs'

export const effectModes = [
  'rewrite',
  'suppress',
  'reject',
  'fanout',
  'transition',
  'deferred',
]

// Only the SUT receives trigger code. The reference models their small, stated
// consequences with independent SQL operations, never by importing this DDL.
export function renderEffectDatabase(program) {
  let source = renderSchemaDatabase(program)
  const mode = program.effect
  assert.ok(effectModes.includes(mode))
  const origin = program.tables[0].name,
    recipient = program.tables[1].name
  const body = {
    rewrite:
      "NEW.text := 'rewritten:' || NEW.text; NEW.completed := NOT NEW.completed; RETURN NEW;",
    suppress: 'RETURN NULL;',
    reject:
      "RAISE EXCEPTION 'oracle constraint rejection' USING ERRCODE='23514';",
    fanout: `UPDATE "${recipient}" SET text='trigger:' || NEW.text, completed=NOT completed WHERE user_id=NEW.user_id; RETURN NEW;`,
    deferred: `UPDATE "${recipient}" SET text='trigger:' || NEW.text, completed=NOT completed WHERE user_id=NEW.user_id; RETURN NEW;`,
    transition: `UPDATE "${recipient}" SET text='transition:' || (SELECT count(*) FROM changed)::text, completed=true WHERE user_id IN (SELECT user_id FROM changed); RETURN NULL;`,
  }[mode]
  const trigger =
    mode === 'deferred'
      ? `CREATE CONSTRAINT TRIGGER effect AFTER UPDATE ON "${origin}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION oracle_effect()`
      : mode === 'transition'
        ? `CREATE TRIGGER effect AFTER UPDATE ON "${origin}" REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION oracle_effect()`
        : `CREATE TRIGGER effect ${mode === 'fanout' ? 'AFTER' : 'BEFORE'} UPDATE ON "${origin}" FOR EACH ROW EXECUTE FUNCTION oracle_effect()`
  const ddl = `CREATE FUNCTION oracle_effect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} END; $$; ${trigger};`
  // Await schema creation before installing triggers; initial seeds use INSERT.
  source = source.replace(
    'export async function control(input){',
    () =>
      `const effectsReady=ready.then(()=>pg.exec(${JSON.stringify(ddl)}))\nexport async function control(input){\n await effectsReady`,
  )
  const external = `if(input.command==='external')await pg.query('UPDATE "${recipient}" SET text=$1,completed=true WHERE user_id=$2',[input.text,input.scope]);`
  return source.replace(
    'return {events:[...events],rows:[]',
    external + '\n return {events:[...events],rows:[]',
  )
}

export const effectControls = effectModes.map((effect) => ({
  program: { ...controls.program, effect, externalWrite: effect === 'fanout' },
  sequences: [
    [
      {
        kind: 'edit',
        target: 0,
        slot: 0,
        text: 'changed',
        rank: 4,
        outcome: 'success',
      },
      {
        kind: 'complete',
        target: 0,
        slot: 1,
        text: '',
        rank: 1,
        outcome: 'success',
      },
      {
        kind: 'edit',
        target: 1,
        slot: 0,
        text: 'peer',
        rank: 2,
        outcome: 'success',
      },
    ],
  ],
}))
export const effectScenario = (sequences, steps) =>
  fc
    .tuple(schemaScenario(sequences, steps), fc.constantFrom(...effectModes))
    .map(([scenario, effect]) => ({
      ...scenario,
      program: { ...scenario.program, effect },
      sequences: scenario.sequences.map((sequence) =>
        sequence.map((step) => ({ ...step, cross: false })),
      ),
    }))
