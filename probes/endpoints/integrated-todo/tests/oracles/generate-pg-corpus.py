"""External input generation; this module never imports the Endpoints analyzer."""

import argparse
import hashlib
import json
from pathlib import Path

import waxsql

parser = argparse.ArgumentParser()
parser.add_argument("--schemas", type=int, default=12)
parser.add_argument("--queries", type=int, default=12)
parser.add_argument("--seed", type=int, default=20260914)
parser.add_argument("--output", required=True)
args = parser.parse_args()
assert waxsql.__version__ == "1.0.0", "Install the pinned waxsql==1.0.0"
assert args.schemas > 0 and args.queries > 0
root = Path(waxsql.__file__).parent
packet = {
    "format": 1,
    "generator": "waxsql",
    "version": waxsql.__version__,
    "seed": args.seed,
    "sources": {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*.py"))
    },
    "schemas": [],
}
for index in range(args.schemas):
    seed = args.seed + index
    complexity = [1, 3, 5, 8, 12, 20][index % 6]
    case = {"seed": seed, "complexity": complexity, "queries": []}
    packet["schemas"].append(case)
    try:
        schema = waxsql.generate_schema(seed=seed, complexity=complexity)
        case["ddl"] = schema.emit_ddl()
        case["tables"] = [
            {"name": t.name, "types": [c.type.sql() for c in t.columns]}
            for t in schema.tables
        ]
        try:
            case["data"] = waxsql.generate_data(schema, seed=seed, rows=3, fanout=1)
        except Exception as error:
            case["dataError"] = str(error)
        for offset in range(args.queries):
            query_seed = seed * 1000 + offset
            query = {"seed": query_seed}
            case["queries"].append(query)
            try:
                query["sql"] = waxsql.print_query(
                    waxsql.generate_query(seed=query_seed, schema=schema, complexity=complexity)
                )
            except Exception as error:
                query["generationError"] = str(error)
    except Exception as error:
        case["generationError"] = str(error)
Path(args.output).write_text(json.dumps(packet, indent=2) + "\n")
