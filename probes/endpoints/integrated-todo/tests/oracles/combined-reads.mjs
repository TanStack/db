import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const pg = new PGlite()
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ??
    new URL('../../evidence/combined-reads', import.meta.url).pathname,
)
const report = {
  ok: false,
  layer: 'PostgreSQL read/encoding experiment, not enabled in Endpoints',
  cases: [],
  limits: [
    'In-process PGlite; no real PostgreSQL network/pool latency.',
    'Read-only integer/text/boolean/NULL projections; no typed Date/numeric decoding claim.',
    'Separate requests use Promise.all, but PGlite has a single connection.',
    'Combining statements does not prove shared scans or fewer client bytes.',
    'No concurrent external writer or replica visibility claim.',
  ],
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
try {
  report.engine = (await pg.query('SELECT version() AS version')).rows[0]
  for (const count of [10, 1000]) {
    await pg.exec(
      'DROP TABLE IF EXISTS item,parent; CREATE TABLE parent(id integer PRIMARY KEY,label text);CREATE TABLE item(id integer PRIMARY KEY,parent_id integer,text text,completed boolean)',
    )
    await pg.query(
      "INSERT INTO parent SELECT i,'parent-'||i FROM generate_series(1,10) i",
    )
    await pg.query(
      'INSERT INTO item SELECT i,CASE WHEN i%5=0 THEN NULL ELSE i%12 END,repeat(md5(i::text),8),i%2=0 FROM generate_series(1,$1::integer) i',
      [count],
    )
    for (const variant of [
      'two-overlapping',
      'three-with-joins',
      'empty-and-disjoint',
    ]) {
      const queries =
        variant === 'two-overlapping'
          ? [
              'SELECT id,text,completed FROM item ORDER BY id',
              'SELECT id,text,completed FROM item WHERE completed ORDER BY id DESC',
            ]
          : variant === 'three-with-joins'
            ? [
                'SELECT i.id,i.text,p.label FROM item i INNER JOIN parent p ON i.parent_id=p.id ORDER BY i.id',
                'SELECT i.id,i.text,p.label FROM item i LEFT JOIN parent p ON i.parent_id=p.id ORDER BY i.id',
                'SELECT id,text,completed FROM item WHERE completed ORDER BY id',
              ]
            : [
                'SELECT id,text,completed FROM item WHERE id<0 ORDER BY id',
                'SELECT id,text,completed FROM item WHERE completed ORDER BY id',
                'SELECT id,text,completed FROM item WHERE NOT completed ORDER BY id',
              ]
      // Keep each query's ordinal explicitly; do not depend on outer aggregate
      // order, object-key order, or an untagged concatenation of result rows.
      const combined =
        'SELECT ' +
        queries
          .map(
            (sql, i) =>
              `(SELECT coalesce(jsonb_agg(to_jsonb(ordered)-'__ordinal' ORDER BY ordered.__ordinal),'[]'::jsonb) FROM (SELECT result.*,row_number() OVER (ORDER BY result.id ${variant === 'two-overlapping' && i === 1 ? 'DESC' : 'ASC'}) AS __ordinal FROM (${sql}) result) ordered) AS q${i}`,
          )
          .join(',')
      const samples = { separate: [], combined: [] },
        bytes = {}
      for (let iteration = 0; iteration < 32; iteration++) {
        const results = {}
        // Alternate strategy order so warm-cache/first-run bias is not fixed.
        for (const strategy of iteration % 2
          ? ['combined', 'separate']
          : ['separate', 'combined']) {
          const start = performance.now()
          if (strategy === 'separate')
            results[strategy] = await Promise.all(
              queries.map(async (sql) => (await pg.query(sql)).rows),
            )
          else {
            const response = (await pg.query(combined)).rows[0]
            results[strategy] = queries.map((_, i) => response['q' + i])
          }
          const encoded = JSON.stringify(results[strategy])
          if (iteration >= 2) samples[strategy].push(performance.now() - start)
          bytes[strategy] = Buffer.byteLength(encoded)
        }
        assert.deepEqual(
          results.combined,
          results.separate,
          `${count}/${variant}/${iteration}`,
        )
      }
      assert.equal(bytes.combined, bytes.separate)
      const separate = median(samples.separate),
        combinedMs = median(samples.combined)
      report.cases.push({
        rows: count,
        variant,
        queries: queries.length,
        samples: 30,
        medianMs: { separate, combined: combinedMs },
        responseBytes: bytes,
        sqlCalls: { separate: queries.length, combined: 1 },
        modeledSequentialConnectionBreakEvenRttMs: Math.max(
          0,
          (combinedMs - separate) / (queries.length - 1),
        ),
        combinedPlan: (await pg.query('EXPLAIN ' + combined)).rows,
      })
    }
  }
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  console.error(report.error)
  process.exitCode = 1
} finally {
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  await pg.close()
}
