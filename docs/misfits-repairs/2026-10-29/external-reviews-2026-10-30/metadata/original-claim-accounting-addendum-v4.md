# Original metadata claim accounting correction

This addendum supersedes current interpretations of seven original claim IDs.
It changes no production code, test, oracle, branch, PR, or canonical ledger.
It uses completed evidence from the v3 audit; no runtime was executed and no
heavy-command slot was used. The optional campaign runner remains pending.

The cutoff input is preserved in
`original-claim-supersession-inputs-v4.json`, SHA-256
`cf02a71f5fdf952ff01d09299b113e75dbe8df34de28d4e4dbe830bbd2a8db9e`.
It contains exact effective metadata rows and the same-ID persistence copies
of C05/C06. Original claims, M-series logs, former interpretations and prior
false-RED conclusions remain history; none was rewritten or erased.

## Superseding assessments

| Original ID | Current disposition | Corrected meaning |
| --- | --- | --- |
| **2281/C05** | **refuted** as the claimed product obligation | D9/D18 prohibit implicitly storing a later DbClient seed's metadata. D14 fixes insert kind without authorizing durability. D15 permits differing stored metadata at an unknown-authorship read. The earlier claim that materialization fixed a durable-preservation bug is withdrawn. The materialization introduced by PR #2303 was itself the confirmed D18 defect; current integration removes it and matches main. |
| **METADATA/REACH** | **fixed-now**, with corrected enforcement scope | Completed bare/non-bare branch reach is a history premise, not a promise to preserve a seed durably through every full reload. Original fixed/random 40-run machinery and guards remain. I03/I04 fixed seed 527962096 reaches both completed regimes twice per lane/host. New constructive durability campaigns reach all 36 case/lane states eight times each per campaign, independently of seed; native actual recovery reach is 96. |
| **METADATA/RECEIVER** | **fixed-now**, using calibrated evidence | Earlier native plumbing did not establish correct SQL admission or completed-input premises. Old root calls could enter another adapter's transaction; quiet-time polling could miss work. E03 rejects that fixture. The corrected SQL admission, correlated notice/response/apply barriers, shared independent D15 input and current I-series comparisons supply bounded native evidence. Earlier M-series/native GREEN receipts do not supply that corrected proof. |
| **2281/C06** | **accepted-design**, scope distinction preserved | Metadata authority and source-progress convergence remain separate boundaries. Withdraw the assertion that a separate kept-metadata durability production cause was repaired. Final metadata scope is oracle/fixture enforcement and removal of PR materialization; main's source-progress work is unchanged. Apply this correction to both metadata and persistence copies. |
| **CR2303/M02** | **stale** current product narrative | Preserve the historical skipped linked-issue check and its publication facts. The accompanying statement that the PR fixes the original metadata product bug is superseded. No new body or closing relation has been published. |
| **CR2303/M03** | **stale** current scope narrative | Preserve the historical skipped out-of-scope check. The final candidate has no production-source delta against main; its old “one durable metadata repair” description cannot assess the present diff. |
| **CR2303/M05** | **stale** current closure credit | Preserve the historical body/render verification. Making a claimed closure boundary explicit did not establish that its law was sound. The prior durable-law/native-closure narrative was corrected by D9/D18 and the newly calibrated instrument. Final body and pushed-head readiness remain parent-owned gates. |

Authority is the existing sync-metadata review's decisions 9, 11, 14, 15 and
18. No law was added or narrowed. The original C05 product diagnosis is
separate from the model/input gap (**META-SIB-2303-002**), durable-observation
gap (**META-EXT-2303-001/003**), reach gap (**004**) and native fixture gap
(**005**). Those repairs do not turn C05's old proposed law into a valid one.

The historical assertion failures remain actual executions. They are withdrawn
as proof of the old durable-preservation obligation because the expectation
conflated keeping with writing, and the native fixture/environment inputs
were not calibrated. This addendum does not claim every historical trace had
one identical cause or that the old runtime was rerun today.

Current decisive evidence remains I01/I02 composed-original RED at the durable
cut, I03/I04 repaired GREEN (12 native/helper/work and 74 controlled tests),
I07 original materialization rejected on both hosts, I08 omitted model input
rejected at commit, I09 explicit-write loss rejected, and I10/I11 restored
direct replay GREEN. E12 records the actual successful response crossing row
version 0 to 2 without replay deltas. The expected result comes from independent
model storage, not a production reload classifier.

## Other original records checked

The cutoff contained 15 original effective metadata IDs. Eight need no new
semantic disposition:

- **METADATA/SETUP** retains a historical managed-storage/startup-demand setup
  correction. It supplies no correctness credit for the formerly wrong law
  or the subsequently corrected root SQL admission premise.
- **METADATA/TYPECHECK** retains historical declaration/readonly-input checks.
  Type success does not establish the metadata law. I05 supplies current
  combined-tree scoped TypeScript evidence.
- **CR2303/M01, M06 and M07** remain judgments about an unsupported function
  docstring metric and generic offers. They do not mean no later prose defect
  existed; META-PREP-CR-001 was subsequently found and fixed.
- **CR2303/M04** retains the verified historical checklist/body edit. It does
  not imply the body now describes the corrected final candidate.
- **CR2303/M08** remains a refutation of a generic test-generation offer as a
  concrete finding. It is not credit that the older oracle covered the gaps
  discovered by this external review.
- **CR2303/M09** remains historical workflow/capability context; it supplies no
  current CI or merge-readiness verdict.

Cross-owner old runtime receipts retain their literal executed outcomes at
their recorded trees. They must not be reused as evidence for the withdrawn
durable-preservation law or the repaired receiving premises. No unrelated
claim was reopened or assigned a new product verdict here.

The finite receiver limits remain one process, two coordinators, native
SQLite, partial/full/on-demand lanes and the bounded commit/notice/recovery
schedule. Arbitrary interleavings, transport/leadership loss, recovery during
cleanup/expiry/cancellation, Chromium OPFS, Electron IPC, restart semantics
and necessity of gap detection remain outside the claim. Broader #2272 closure
and whole-PR readiness are not established.

## Exact incremental import

Seven JSONL rows were appended to the external-review `claims.jsonl`, lines
**25–31**. The first 24 rows are byte-identical to the previous cutoff.
These are superseding assessments of existing IDs, not seven new raw findings.
The external review's raw six-item accounting remains unchanged.

- Exact increment: `original-claims-superseding-assessments-v4.jsonl`
- Increment SHA-256: `cd35922752da9a6fe7191bce23d290fbb5f7a204c395b340d2ae65baa32be852`
- New full ledger SHA-256: `9f393069fa04bf889ffec024a18efd870a795aad2973ee5a54fe148fd6c77a77`
- Receipt: `original-claim-supersession-receipt-v4.json`

The v3 handoff receipt remains valid for its historical 24-row prefix. Root
owns incremental canonical import and the two cross-owner C05/C06 projections.
No canonical current-view files were edited by this task.
