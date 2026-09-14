// Companion to Kitchen's real browser smoke test. Compile its actual endpoints,
// use disposable PostgreSQL, and stub only auth/OpenAI/Trello to exercise every
// moved SQL path without sending paid or external writes.
import assert from 'node:assert/strict'
import {
  readFile,
  realpath,
  mkdtemp,
  symlink,
  rm,
  writeFile,
  mkdir,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parse } from '@babel/parser'
import { transformBoundEndpoints } from '../bound-transform.mjs'
import { loadSchema } from '../compiled-dependencies.mjs'
const base = resolve(import.meta.dirname, '..')
const kitchen = resolve(process.argv[2])
const require = createRequire(
  await realpath(join(base, 'node_modules/vite/package.json')),
)
const { build } = require('esbuild')
const source = join(kitchen, 'src/endpoints/kitchen.endpoint.ts')
const code = await readFile(source, 'utf8')
const compiled = transformBoundEndpoints(
  code,
  source,
  parse(code, { sourceType: 'module', plugins: ['typescript'] }),
  { root: kitchen, snapshot: loadSchema(kitchen) },
)
assert.equal(compiled.dependencyDiagnostics.length, 18)
assert.ok(
  compiled.dependencyDiagnostics.every((entry) =>
    Array.isArray(entry.dependencies),
  ),
  'every moved SQL endpoint has build-time dependencies',
)
const dir = await mkdtemp(join(tmpdir(), 'kitchen-port-'))
await symlink(join(kitchen, 'node_modules'), join(dir, 'node_modules'))
let loaded, client
const observations = []
try {
  await build({
    stdin: {
      contents:
        compiled.code +
        '\nexport {DbClient} from "@tanstack/db"; export {pool,trace,setActor,responses} from "./database.server";',
      resolveDir: join(kitchen, 'src/endpoints'),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    tsconfig: join(base, 'tsconfig.json'),
    outfile: join(dir, 'bundle.mjs'),
    logLevel: 'silent',
    alias: { '@': join(kitchen, 'src') },
    plugins: [
      {
        name: 'kitchen-external-fixtures',
        setup(build) {
          build.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
            path: 'transport',
            namespace: 'fixture',
          }))
          build.onResolve(
            { filter: /^virtual:endpoints-registry.server.ts$/ },
            () => ({ path: 'registry', namespace: 'fixture' }),
          )
          build.onResolve(
            { filter: /(?:^|\/)database\.server(?:\.ts)?$/ },
            () => ({ path: 'database', namespace: 'fixture' }),
          )
          build.onResolve(
            { filter: /\/services\/(ingredients|ai|shopping-list)\.server$/ },
            ({ path }) => ({
              path: path.split('/').at(-1),
              namespace: 'fixture',
            }),
          )
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            loader: 'ts',
            resolveDir: join(kitchen, 'src/endpoints'),
            contents:
              path === 'registry'
                ? compiled.registryCode + '\nexport const registry=definitions;'
                : path === 'transport'
                  ? `import {responses} from './database.server';export function createServerFn(){return {inputValidator(schema){return {handler(fn){return async({data})=>{const result=await fn({data:schema.parse(data)});responses.push(result);return result}}}}}}`
                  : path === 'database'
                    ? `import pg from 'pg';import {drizzle} from 'drizzle-orm/node-postgres';export * from '${kitchen}/src/db/schema';export const pool=new pg.Pool({connectionString:'postgresql://postgres@127.0.0.1:55480/kitchen_endpoints'});export const trace=[],responses=[];export const db=drizzle(pool,{casing:'snake_case',logger:{logQuery(sql){trace.push(sql)}}});let actor;export const setActor=(id)=>actor=id;export async function requireUser(req){if(!actor||req.scope!==actor)throw Error('Unauthorized');return {id:actor}}`
                    : path === 'ingredients.server'
                      ? `export async function describeIngredient(){return {parsed:{description:'Fixture ingredient',grocery_section:'Pantry'},embedding:[0,1]}}`
                      : path === 'ai.server'
                        ? `export async function extractRecipe(){return {name:'Fixture recipe',description:'Fixture extraction',ingredients:[{listing:'1 cup flour',extracted_name:'flour',embedding:'[0,1]',grocery_section:'Pantry'}]}}`
                        : `export async function addShoppingCard(){return {id:'fixture-card',name:'Fixture shopping'}}`,
          }))
        },
      },
    ],
  })
  loaded = await import(pathToFileURL(join(dir, 'bundle.mjs')).href)
  const user = randomUUID(),
    other = randomUUID(),
    now = new Date()
  await loaded.pool.query(
    'INSERT INTO users(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$1,false,now(),now()),($2,$2,$2,false,now(),now())',
    [user, other],
  )
  loaded.setActor(user)
  client = new loaded.DbClient({ endpointScope: user })
  const app = loaded.createKitchenEndpoints(client)
  const tables = {
    usersCollection: 'users',
    ingredientsCollection: 'ingredients',
    recipesCollection: 'recipes',
    recipeIngredientsCollection: 'recipe_ingredients',
    recipeCommentsCollection: 'recipe_comments',
    tagsCollection: 'tags',
    recipeTagsCollection: 'recipe_tags',
    ingredientTagsCollection: 'ingredient_tags',
  }
  await Promise.all(Object.keys(tables).map((name) => app[name].preload()))
  const plain = (rows) =>
    JSON.parse(
      JSON.stringify(
        rows
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(([key]) => !key.startsWith('$')),
            ),
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
  async function check() {
    for (const [name, table] of Object.entries(tables))
      assert.deepEqual(
        plain([...app[name].values()]),
        plain(
          (
            await loaded.pool.query(
              table === 'users'
                ? `SELECT id, name, email, email_verified AS "emailVerified", image,
                    created_at AS "createdAt", updated_at AS "updatedAt" FROM users`
                : `SELECT * FROM ${table}`,
            )
          ).rows,
        ),
        name,
      )
  }
  async function action(name, input, expectedFailure = false) {
    const start = loaded.trace.length,
      responseStart = loaded.responses.length
    const tx = app[name](input)
    if (expectedFailure) await assert.rejects(tx.isPersisted.promise)
    else await tx.isPersisted.promise
    await check()
    const response = loaded.responses
      .slice(responseStart)
      .findLast((r) => r.handler)
    const snapshots = response.snapshots?.length ?? response.collections?.length
    const unaffected = response.unaffected?.length ?? 0
    assert.ok(
      loaded.trace.slice(start).every((sql) => !/pg_catalog/i.test(sql)),
    )
    observations.push({
      name,
      rejected: expectedFailure,
      unaffected,
      snapshots,
      sqlStatements: loaded.trace.length - start,
    })
    if (!expectedFailure) {
      // SQL paths and FK effects in Kitchen, independent of compiler diagnostics.
      const retainedAffected = {
        saveIngredient: 1,
        addToShoppingList: 1,
        saveComment: 1,
        deleteComment: 1,
        insertComment: 1,
        createIngredientAction: 3,
        createRecipeAction: 4,
        changeTagAssignmentsAction: 3,
        deleteRecipe: 4,
        deleteIngredient: 2,
      }
      assert.equal(snapshots, retainedAffected[name], name)
      assert.equal(unaffected, 8 - retainedAffected[name], name)
    }
  }
  const ingredient = randomUUID(),
    recipe = randomUUID(),
    tag = randomUUID(),
    link = randomUUID(),
    comment = randomUUID()
  await action('createIngredientAction', {
    ingredient: {
      id: ingredient,
      name: 'Oracle ingredient',
      description: 'Optimistic',
      is_reviewed: true,
      embedding: '[]',
      tracking_type: 'count',
      fill_level: 0,
      grocery_section: 'Pantry',
      count: 1,
      trello_add_count: 0,
      expiration_date: now,
      user_id: user,
      created_at: now,
      updated_at: now,
    },
    new_tags: [],
    links: [],
  })
  await action('saveIngredient', { id: ingredient, data: { count: 4 } })
  await action('addToShoppingList', {
    recipeName: 'Fixture',
    checklists: { Pantry: ['Flour'] },
    ingredientIds: [ingredient],
  })
  assert.equal(app.ingredientsCollection.get(ingredient).trello_add_count, 1)
  await action('createRecipeAction', {
    id: recipe,
    url: '',
    pastedText: 'Fixture text',
    created_at: now,
    new_tags: [],
    links: [],
  })
  assert.equal(app.recipesCollection.get(recipe).name, 'Fixture recipe')
  assert.ok(
    [...app.recipeIngredientsCollection.values()].some(
      (row) => row.recipe_id === recipe,
    ),
  )
  await action('insertComment', {
    id: comment,
    recipe_id: recipe,
    user_id: user,
    made_it: true,
    rating: 4,
    comment: 'first',
    created_at: now,
    updated_at: now,
  })
  await action('saveComment', { id: comment, data: { comment: 'edited' } })
  await action('changeTagAssignmentsAction', {
    target: { entity: 'recipe', entity_id: recipe },
    new_tags: [{ id: tag, name: tag, user_id: user, created_at: now }],
    links: [{ id: link, tag_id: tag, created_at: now }],
    removed_link_ids: [],
  })
  loaded.setActor(other)
  await action('saveIngredient', { id: ingredient, data: { count: 99 } }, true)
  loaded.setActor(user)
  await action('deleteComment', comment)
  await action('deleteRecipe', recipe)
  await action('deleteIngredient', ingredient)
  await client.cleanup()
  client = null
  // Auth stub checks scope, while the separate browser test checks real sessions.
  await loaded.pool.query('DELETE FROM users WHERE id=ANY($1)', [[user, other]])
  const output = resolve(
    process.env.ENDPOINT_ORACLE_OUTPUT ??
      join(base, 'evidence/kitchen-inline-sql'),
  )
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(
      {
        ok: true,
        comparisons: observations.length * 8,
        observations,
        dependencies: compiled.dependencyDiagnostics,
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify(
      { ok: true, comparisons: observations.length * 8, observations },
      null,
      2,
    ),
  )
} finally {
  await client?.cleanup()
  await loaded?.pool.end()
  await rm(dir, { recursive: true, force: true })
}
