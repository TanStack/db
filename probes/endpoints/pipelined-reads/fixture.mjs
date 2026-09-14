export const ddl = `
CREATE TABLE parent(id integer PRIMARY KEY, label text NOT NULL);
CREATE TABLE item(
  id text PRIMARY KEY, parent_id integer, body text NOT NULL,
  completed boolean NOT NULL, score integer, amount numeric(30,8),
  created_at timestamptz NOT NULL, info jsonb NOT NULL
);
CREATE TABLE audit(id text PRIMARY KEY);
`

export function insert(row) {
  return {
    text: `INSERT INTO item VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::timestamptz,$8::jsonb)
      ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,
      body=excluded.body,completed=excluded.completed,score=excluded.score,
      amount=excluded.amount,created_at=excluded.created_at,info=excluded.info`,
    params: [
      row.id,
      row.parent,
      row.body,
      row.completed,
      row.score,
      '9007199254740993.12345678',
      '2026-01-02T03:04:05.678Z',
      { body: row.body, tags: [null, '雪', 3] },
    ],
  }
}

export function mutation(operation) {
  if (operation.kind === 'put') return insert(operation.row)
  if (operation.kind === 'delete')
    return { text: 'DELETE FROM item WHERE id=$1', params: [operation.row.id] }
  if (operation.kind === 'parent')
    return {
      text: 'UPDATE parent SET label=$1 WHERE id=$2',
      params: [operation.row.body, operation.row.parent],
    }
  return {
    text: 'UPDATE item SET completed=$1,score=$2,body=$3 WHERE id=$4',
    params: [
      operation.row.completed,
      operation.row.score,
      operation.row.body,
      operation.row.id,
    ],
  }
}

const columns = 'id,parent_id,body,completed,score,amount,created_at,info'
export function queriesFor(config) {
  const candidates = [
    {
      id: 'all',
      text: `SELECT ${columns} FROM item ORDER BY score DESC NULLS LAST,id`,
    },
    {
      id: 'filtered',
      text: `SELECT ${columns} FROM item WHERE completed=$1 AND (score >= $2 OR score IS NULL) ORDER BY id DESC`,
      params: [config.completed, config.threshold],
    },
    {
      id: 'top',
      text: `SELECT ${columns} FROM item ORDER BY score DESC NULLS LAST,id LIMIT $1 OFFSET $2`,
      params: [config.limit, config.offset],
    },
    {
      id: 'join',
      text: 'SELECT i.id,i.body,p.label FROM item i LEFT JOIN parent p ON i.parent_id=p.id WHERE i.completed=$1 ORDER BY i.id',
      params: [config.completed],
    },
    {
      id: 'group',
      text: 'SELECT completed::text AS id,count(*)::integer AS count,sum(score)::text AS total FROM item GROUP BY completed ORDER BY completed',
    },
    {
      id: 'empty',
      text: `SELECT ${columns} FROM item WHERE id=$1`,
      params: ['absent'],
    },
    {
      id: 'bound-text',
      text: `SELECT ${columns} FROM item WHERE body=$1 ORDER BY id`,
      params: [config.body],
    },
  ]
  return config.kinds.map((index) => candidates[index])
}
