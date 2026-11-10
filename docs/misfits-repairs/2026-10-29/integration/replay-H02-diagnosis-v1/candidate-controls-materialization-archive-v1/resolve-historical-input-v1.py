#!/usr/bin/env python3
"""Read and verify the historical input packet through its exact archive map."""
from pathlib import Path
import hashlib
import json

archive = Path(__file__).resolve().parent
map_path = archive / "archive-map-v1.json"
mapping_record = json.loads(map_path.read_text())
base = Path(mapping_record["historicalBase"])
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
freeze_path = base / mapping_record["historicalFreezeRelativePath"]
packet_path = base / mapping_record["historicalPacketRelativePath"]
assert digest(freeze_path) == mapping_record["historicalFreezeSha256"]
assert digest(packet_path) == mapping_record["historicalPacketSha256"]
freeze = json.loads(freeze_path.read_text())
packet = json.loads(packet_path.read_text())
rows = mapping_record["mapping"]
by_key = {row["originalRelativePath"]: row for row in rows}
assert len(by_key) == len(rows) == 8
observations = []
for key, expected in packet.items():
    row = by_key.get(key)
    target = archive / row["archiveRelativePath"] if row else base / key
    if row:
        assert row["sha256"] == expected == freeze["files"][key]
        assert target.stat().st_size == row["bytes"]
    assert target.is_file() and digest(target) == expected, str(target)
    original = base / key
    original_exists = original.exists()
    if original_exists:
        assert digest(original) == expected
    observations.append({"historicalKey": key, "resolvedPath": str(target),
                         "sha256": expected, "viaArchive": row is not None,
                         "originalExists": original_exists})
assert set(by_key) <= set(packet)
for key, expected in freeze["files"].items():
    row = by_key.get(key)
    target = archive / row["archiveRelativePath"] if row else base / key
    assert digest(target) == expected
print(json.dumps({"archiveMapSha256": digest(map_path),
                  "historicalFreezeSha256": digest(freeze_path),
                  "historicalPacketSha256": digest(packet_path),
                  "freezeFilesResolved": len(freeze["files"]),
                  "packetEntriesResolved": len(packet),
                  "archiveKeysResolved": len(rows), "allMatched": True,
                  "observations": observations}, indent=2))
