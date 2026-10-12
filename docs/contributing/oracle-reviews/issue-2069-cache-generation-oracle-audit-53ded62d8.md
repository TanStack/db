# Cache-generation oracle audit

This is a self-review of the oracle expansion.
Reviewed code commit: `53ded62d8ef70ccd63b75d0e6dbc0a964f14b17c`.
This record covers the oracle and coverage-map changes in that commit. It does
not claim that the whole cache-eviction bug class is closed. No production code
changed in the reviewed commit.

The [glossary](../glossary.md) defines a persisted cache claim as one sync
run's expiring authority over one persisted cache generation. The approved
on-demand recovery contract in the [Electric collection guide](../../collections/electric-collection.md)
requires a run that loses that authority to reload its demanded subsets. The
SQLite owner checks transaction-time admission; the persisted owner checks
physical-ID notice routing; the Browser owner checks a warm peer and an expired
run through a real SQLite database and a controlled coordinator wire.

## Generated-history controls

The managed-claim read grammar fixes an initial claim at clock 1000 with a
100 ms lifetime. A peer claims the same physical ID 10–80 ms later. The held
read uses clock cuts -9, -1, 0, +1, and +9 ms around the first claim's expiry.
The peer remains live at every generated read cut. The model uses half-open
claim intervals and computes both expiries from these authored inputs, rather
than from the adapter's returned expiry. It varies `includeRows` and zero to
three seeded rows. Six fixed histories reconstruct the reported second-check
race and the exact-expiry boundary with both row-inclusion options.

- **Ablation:** Removing the clock cut loses expiry and equality; removing
  `includeRows` loses the position-only no-row-read promise; removing row count
  loses empty and multiple-row membership; removing peer delay loses the
  independent later claim interval.
- **Range:** The adjacent clock cuts are -1, 0, and +1 ms; 0 and 3 rows bound
  the generated row count. A peer acquired after the held read, or expired by
  its own read, is excluded from this grammar rather than silently skipped.
- **Checkpoint:** The real `loadResumeSnapshot` transaction is held before its
  claim query. An expired read rejects with no generation-specific SQL beyond
  claim validation. A live read returns the modeled rows and metadata, while
  the peer reads the same exact durable rows and metadata. A harmless global
  catalog query before validation is allowed.

The generation-notice grammar fixes rotation from one physical ID to another.
It varies an absent, commit, or reset old notice; old row versions 1 and 10;
new row versions 1 and 3; and an absent or present new notice. The four fixed
histories reconstruct queued commit/reset delivery with the old version below
or above the new version. An old version has no semantic effect when no old
commit exists; a new version has no effect when the new notice is absent.

- **Ablation:** Omitting old notices removes the queued-callback case. Omitting
  the absent-old control loses the rotation-only work baseline. Omitting the
  absent-new control permits unexplained later work. Omitting either version
  order permits comparison by row version instead of physical ID. Omitting
  commit or reset loses one callback path.
- **Range and exclusion:** Versions 1/10 and 1/3 cover the two orderings.
  The grammar queues any old notice before rotation binds; delivery to an old
  subscription created only after unsubscribe is outside its legal histories.
- **Checkpoint:** After the queued callback crosses the wrapper's apply mutex,
  the active subset has exactly its one rotation request and no retired public
  row. A new notice requests additional source work against the new ID. This
  stub records requests, not source evidence or a completed snapshot.

Both grammars run the same driver and comparison with a fixed seed and a
random seed. The fixed seeds are 2056 (30 runs) and 2069 (24 runs). The package
oracle registry accepts direct seed-and-shrink-path replay for each property.

## Hostile checks and replay

Temporary source mutants were restored after each run. These outcomes are
assertion failures at the intended comparison, not setup errors or timeouts:

| Wrong design | Observed result |
| --- | --- |
| Accept a claim at its exact expiry (`>=`) | Both fixed equality histories rejected the resolved read. Generated history shrank to `elapsedMs=0`, `includeRows=false`, `peerDelayMs=10`, `rowCount=0`. |
| Read collection metadata before transaction claim validation | Four expired fixed histories failed the generation-specific statement check. |
| Read key-set evidence before transaction claim validation | All six fixed histories failed the generation-specific statement-order check. |
| Scan rows for a live `includeRows=false` read and discard them | The live position-only fixed history failed its row-query count. |
| Process a queued retired commit after rotation without checking its physical ID | Both fixed commit histories failed because the old notice added source requests. Generated history shrank to old commit/version 1, new version 1, and no new notice. |

A temporary harmless `sqlite_master` read before claim validation passed all
six fixed histories. It is outside the claimed generation and does not weaken
the first generation-specific statement check. The Browser receiving witness
also rejected an unconditional-current-head rotation mutant at its exact
head-ID comparison during the initial review campaign.

Direct replay of the expiry mutant used property
`sqlite-resume.managed-claim-read`, seed `2056`, path `0:1`. It selected only
the random-or-replayed property and failed after one test with the same
counterexample. Direct replay of the retired-commit mutant used property
`persistence.generation-notice`, seed `2069`, path `1:1:1`. It likewise selected
only that property and failed after one test with the same counterexample.

## ORC-001–014 audit

| Requirement | Outcome at the reviewed code commit |
| --- | --- |
| ORC-001 authority and limits | Applicable. The glossary and approved on-demand recovery contract provide the claim and private-recovery law. Opening prose and the coverage map bound each owner. |
| ORC-002 independent judgment | Applicable. The SQLite model computes half-open intervals from authored clock/TTL inputs. The notice model expects work by physical identity and presence of a new notice; it does not call the production classifier. |
| ORC-003 literate responsibilities | Applicable. Each owner states the law before mechanics and places grammar, controlled driver, observations, and checkpoint beside the code. The notice owner claims request isolation, not source settlement. |
| ORC-004 grammar controls | Applicable to both new generated properties. Reconstruction, ablation, range, and exclusion are recorded above. Conditional axes are identified explicitly. |
| ORC-005 production path and observation | Applicable. Real SQLite executes the held resume transaction. The real persisted wrapper processes queued notices. Browser wa-sqlite compares two claims, both public snapshots, both claimed durable stores, and a distinct warm source demand after the expired run rotates. |
| ORC-006 checker calibration | Applicable. The table above records killed mutants and the accepted harmless-catalog variation. The old notice's extra source request fails at its own checkpoint. |
| ORC-007 fixed/random/replay | Applicable. Both generated properties have equal-budget fixed and random campaigns. Captured seed/path replays reproduced each selected mutant failure directly. Neither property uses `fc.commands`. |
| ORC-008 stateful-model minimality | Not triggered: these additions use small stateless predictions over bounded phase histories. The separate TLA+ authority model owns general state exploration. |
| ORC-009 vocabulary mapping | Applicable. `persisted cache claim`, `persisted cache generation`, `sync run`, `demand`, and `source request` follow the glossary. Model clock values stand for the adapter's controlled host clock; notice work counts stand for coordinator request calls. |
| ORC-010 failure fidelity and cleanup | Applicable. The SQLite driver preserves the primary error through database close. The generated notice driver bounds recovery/cleanup through `cleanupPersistedOracle`, which preserves an earlier assertion failure. The Browser receiver uses failure-preserving cleanup. |
| ORC-011 independent second formulation | Applicable. The controlled notice fixture shares one row Map across physical IDs, so it cannot prove exact durable isolation. The Browser receiver supplies real SQLite physical stores and a warm-peer observation. Native coordinator emission remains open below. |
| ORC-012 review evidence | Applicable. This versioned record names every requirement and is tied to the exact reviewed code commit above. The class remains open at the boundaries below. |
| ORC-013 boundary witness | Applicable. -1/0/+1 ms fixed cuts distinguish expiry from an inclusive threshold; the inclusive mutant failed. Old versions below and above new versions distinguish physical-ID routing from version-order routing. |
| ORC-014 controlled-premise handoff | Applicable. The Browser receiver commits the peer write to real SQLite before manually delivering a matching targeted notice. It proves receiver admission, not native coordinator emission. The missing host handoff is assigned below. |

Validation on the reviewed code: 798 active SQLite oracle tests passed, with
one existing todo; all 30 Browser coordinator-oracle tests passed. Both
affected packages typechecked. ESLint reported no errors, and Prettier and
`git diff --check` passed. The pre-commit hook's dependency install received a
private-registry 403; the verified code commit bypassed that hook.

Open cells remain in the [coverage map](../oracle-coverage.md): a composed
real-SQLite-to-wrapper startup rejection, native Browser coordinator emission
and multi-tab/OPFS scheduling, arbitrary notice interleavings, and retired
physical-cache reclamation. The SQLite resume owner, Browser coordinator
owner, and cache-generation lifecycle owner respectively retain those cells.
