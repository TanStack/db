External semantic/loss audit. Verdict: not yet exact-equivalent. The Jev and range boundaries are mostly disciplined, but several frozen requirements are absent, internally contradictory, or only asserted by reconstruction/ablation.

## Actual defects

- **S-01 — High — `MODEL.md:36-38`, `MODEL.md:108-110`, `MODEL.md:147-149`**  
  **Claim:** Domain adequacy, applicability, and presentation are independently addressable/admissible semantic roots.  
  **Evidence/reasoning:** PC4-01 requires domain-owned adequacy/applicability/presentation. M11 admits their versions, but `TrustRule` lowers only to M04–M06 plus unspecified “presentation relations”; there is no definition/lowering target for the applicability function or adequacy rule. The example has no mapping from method decisions to premise support.  
  **Fix:** Add an explicit versioned semantic-function definition/ref covering adequacy, applicability, and presentation, or state exactly which existing primitive owns each and include all in lowering/admission.

- **S-02 — High — `MODEL.md:45-48`, `MODEL.md:114-119`, `MODEL.md:256-265`**  
  **Claim:** Configuration enablement and consumer policy remain separate.  
  **Evidence/reasoning:** M03 selects consumer profiles, while the example embeds `error`/`warn` in `rules`. M12 separately owns severity. No lowering explains which part is M03 and which is M12, so the public grammar collapses the authority distinction asserted by R02.  
  **Fix:** Separate obligation activation/configuration from severity/action policy in the syntax, or specify a typed lowering into distinct M03 and M12 records with distinct authorization.

- **S-03 — Medium — `MODEL.md:50-52`, `MODEL.md:160-166`, `MODEL.md:228`**  
  **Claim:** Disabling a rule cannot conceal/erase prior conditions.  
  **Evidence/reasoning:** X02 is derived current state; donor A-T3 says a condition may appear or disappear as assessment changes. M03/R13 do not distinguish deactivating a current condition from deleting its historical record. As written, turning a rule off both removes its active obligation and apparently leaves its condition active.  
  **Fix:** Distinguish `activeConditions` from immutable `conditionHistory`; disabling deactivates current obligation-derived conditions while retaining history and an auditable configuration transition.

- **S-04 — Medium — `MODEL.md:80-83`**  
  **Claim:** M07 preserves the full PC4-03 evidence record.  
  **Evidence/reasoning:** M07 omits an explicit producer/run, provenance, trust-root set, evaluator/schema version, and calibration reference. M01’s generic actor/admission reference is not equivalent to observation producer plus the trust roots in force. It also embeds “operational result,” blurring M07 evidence with M09 operation outcome. RFC lines 198-213 and prior run 57 P05 retain these explicitly.  
  **Fix:** Add explicit producer/run/provenance/trustRoots/schema/calibration/operationRef fields; keep operation outcome on M09.

- **S-05 — High — `MODEL.md:85-90`, `MODEL.md:162-165`**  
  **Claim:** Unresolved identity relations remain explicit.  
  **Evidence/reasoning:** The model has exact refs and a generic condition code, but no versioned relation representing semantic equivalence, scope subsumption, or cross-version case mapping, including proposer, status, reason, and authority. RFC lines 309-323 and 834-839 leave these relations explicit/unresolved. A condition saying “identity unresolved” does not preserve the relation itself.  
  **Fix:** Add an `IdentityRelation`/`RelationJudgment` object or explicitly place this structure in M08, with admission and challenge history.

- **S-06 — Medium — `MODEL.md:92-97`**  
  **Claim:** M09 preserves failure provenance.  
  **Evidence/reasoning:** The record names lifecycle phases but omits the prior grammar’s primary failure, separate cleanup diagnostics, resource-release state, returned batch, and relevant invocation/measurement/application/publication/settlement distinctions. Oracle Guide lines 261-276 and RFC lines 282-301 require these distinctions when the law depends on them.  
  **Fix:** Restore typed failure/cleanup/resource fields and conditional phase/event records, or explicitly record this as a v2 loss.

- **S-07 — High — `MODEL.md:99-104`, `MODEL.md:225`**  
  **Claim:** The repair rule preserves exact causal replay.  
  **Evidence/reasoning:** Same-law/same-case/happens-after still permits a cached result or a new run with changed checker/rule identity. RFC lines 364-387 additionally require fresh measurement, replay started after failure, and rejection of cached/same-batch/unrelated passes.  
  **Fix:** Add explicit `startedAfterObservation`, exact check/rule/case versions, fresh-measurement/non-cache witness, and same-violation relation to R10/M10.

- **S-08 — Medium — `MODEL.md:108-112`**  
  **Claim:** PC4-09’s complete proposal surface is preserved.  
  **Evidence/reasoning:** M11 says agents may propose “every semantic object,” but the model has no proposal lifecycle for observations/evidence, challenges, or protocol revisions; protocol revision is not an M11 admission target.  
  **Fix:** Enumerate proposal commands/records for every PC4-09 category, including protocol revision, or narrow the preservation property.

- **S-09 — Medium — `MODEL.md:116-119`**  
  **Claim:** Consumer policy owns “presentation choices.”  
  **Evidence/reasoning:** PC4-01 and RFC lines 147-153 assign domain presentation/meaning to domain packages. Unqualified presentation ownership lets policy rewrite semantic wording.  
  **Fix:** Restrict M12 to severity, visibility, channel, gating, and fallback; keep wording/meaning/source mapping domain-owned.

- **S-10 — High — `MODEL.md:153-165`**  
  **Claim:** The v4 condition/assessment taxonomy preserves prior state distinctions.  
  **Evidence/reasoning:** It omits the explicit difference between no observation and an inconclusive observation, and omits generic operation failure/cleanup conditions. RFC lines 282-301 and run 57’s `TRUST_OBSERVATION_INCONCLUSIVE`/`TRUST_OPERATION_FAILED` preserve both.  
  **Fix:** Add distinct assessment/condition variants for absent evidence, inconclusive observation, unreachable check, operation failure, and cleanup/resource failure.

- **S-11 — High — `MODEL.md:160-166`**  
  **Claim:** PC4-06 condition lifetime remains a distinct clock.  
  **Evidence/reasoning:** X02 is called stable but has no creation, activation, resolution, supersession, or expiry/lifetime semantics. Preservation explicitly names condition lifetime, and donor A-T3 does too.  
  **Fix:** Define condition identity and lifecycle independently of evidence freshness, work leases, config revisions, and override expiry.

- **S-12 — Low — `MODEL.md:208-210`**  
  **Claim:** The overlaps form a semilattice.  
  **Evidence/reasoning:** No order or associative/commutative/idempotent join is defined. The table establishes an overlap/dependency hypergraph, not a semilattice.  
  **Fix:** Define the order/join formally or use “overlapping dependency graph.”

- **S-13 — High — `MODEL.md:228`, `MODEL.md:279-282`**  
  **Claim:** A source-local temporary exception is necessarily M12 policy.  
  **Evidence/reasoning:** PROCESS C03 explicitly leaves source-local suppression classification unresolved. These lines select one answer after freeze.  
  **Fix:** Remove the categorical mapping; present policy override as one candidate pending C03 resolution.

- **S-14 — Low — `MODEL.md:237-244`**  
  **Claim:** The dependency matrix covers primitive dependencies.  
  **Evidence/reasoning:** M01 is omitted even though every projection relies on stable refs and X06 requires version identity.  
  **Fix:** Add M01 or state why envelope identity is intentionally implicit.

- **S-15 — Medium — `MODEL.md:256-265`**  
  **Claim:** The representative config does not choose unresolved Endpoints policy.  
  **Evidence/reasoning:** `level: 'standard'`, `strictCI`, and `developmentPolicy` invent named levels/profiles while PROCESS C09 says these remain unchosen.  
  **Fix:** Mark them explicitly hypothetical placeholders or use neutral metavariables.

- **S-16 — Medium — `EVIDENCE.md:24-37`**  
  **Claim:** Every preservation property has model support.  
  **Evidence/reasoning:** PC4-03’s trust roots/provenance, PC4-04’s identity relation, PC4-06’s condition lifetime, and PC4-09’s protocol-revision proposal are not actually reconstructed.  
  **Fix:** Mark these cells partial/failing until the model gains the missing structure.

- **S-17 — Medium — `EVIDENCE.md:48-50`**  
  **Claim:** E-O03 is “source-stated or user-required.”  
  **Evidence/reasoning:** Conditions/work as Trust’s trace substrate is an analogical transfer explicitly labeled introduced structure by the donor and field-log synthesis, not a source-stated Trust fact.  
  **Fix:** Move E-O03 to analyst-inferred/control-dependent and retain donor fit/limits.

- **S-18 — Low — `EVIDENCE.md:50-53`**  
  **Claim:** E-O04/E-O05 are source-stated Trust requirements.  
  **Evidence/reasoning:** US&R attachment/provenance and B-cell authority decomposition are donor transfers. The donor labels several parts plausible rather than direct.  
  **Fix:** Reclassify both as donor-transferred inferences and preserve their fit labels.

- **S-19 — High — `EVIDENCE.md:83-86`**  
  **Claim:** E-I05 resolves source-local suppression as policy while “exact syntax” alone remains open.  
  **Evidence/reasoning:** PROCESS C03 leaves classification—not just syntax—open.  
  **Fix:** State the two candidate classifications and defer selection.

- **S-20 — Medium — `EVIDENCE.md:94-109`**  
  **Claim:** This is the complete deliberate non-transfer ledger.  
  **Evidence/reasoning:** It does not dispose of major S03 strands—enactment versus declaration, protocol death/succession, differentiated visibility, agency costs, pseudo-hardness—or donor A-T4’s hold/objection-window question.  
  **Fix:** Add explicit “not transferred/out of target” dispositions so omission cannot masquerade as source agreement.

- **S-21 — Low — `PROCESS.md:55-64`**  
  **Claim:** A changed “configuration revision” creates expired evidence.  
  **Evidence/reasoning:** Configuration also includes unrelated rule settings and policy selection. Blanket config revision invalidation violates selective applicability and distinct policy clocks.  
  **Fix:** Say “changed captured, evidence-relevant configuration dependency.”

- **S-22 — High — `PROCESS.md:92-98`**  
  **Claim:** UC06 reconstructs previewing proposed M03/M12 changes.  
  **Evidence/reasoning:** X05 evaluates a current snapshot under a named profile/active overrides; it does not evaluate a hypothetical M03 obligation set or derive hypothetical non-persistent work. A proposed config can also introduce definitions absent from the snapshot.  
  **Fix:** Add a counterfactual evaluation input/snapshot overlay with explicit definition closure and distinguish proposed work from durable X03 work.

- **S-23 — Medium — `PROCESS.md:100-109`**  
  **Claim:** UC07 reconstructs capability/schema discovery.  
  **Evidence/reasoning:** Capability negotiation is only an F03 option; no common primitive or invariant defines it. M02 discoverability alone does not yield adapter capability negotiation.  
  **Fix:** Add capability/schema discovery to M02/R12 or remove step 4 from the reconstruction.

- **S-24 — Medium — `PROCESS.md:111-121`**  
  **Claim:** UC08 reconstructs low-confidence/out-of-range handling.  
  **Evidence/reasoning:** No modeled adequacy rule maps a typed distribution to premise support or an out-of-range condition. “Low-confidence” also reintroduces the generic language R07 rejects.  
  **Fix:** Define a versioned domain adequacy judgment over the full distribution and say “outside the admitted/calibrated range.”

- **S-25 — High — `PROCESS.md:154-159`**  
  **Claim:** “It removes no v2 semantic distinction.”  
  **Evidence/reasoning:** V4 drops explicit absent-vs-inconclusive state, expected-error versus thrown-exception boundary, capability negotiation, operation failure/cleanup/resource details, and concrete proposal/query/command families from run 57.  
  **Fix:** Restore them or enumerate and justify each deliberate loss.

- **S-26 — Medium — `PROCESS.md:215-236`**  
  **Claim:** The unresolved register is complete.  
  **Evidence/reasoning:** It omits semantic-equivalence/scope-subsumption/cross-version identity, speculative objection versus observed challenge, alternate-strategy repair, selective repair expiry/distributed clocks, prior rule-exception classification, and donor hold/objection-time.  
  **Fix:** Restore these as explicit conflicts or document their resolution with support.

- **S-27 — Low — `PROCESS.md:264-274`**  
  **Claim:** The final support-map row describes UC01–UC06.  
  **Evidence/reasoning:** Its label names editor, renewal, CI, and downgrade but omits UC04 Devtools and UC06 stricter preview.  
  **Fix:** Name all six cases.

- **S-28 — Low — `BRIEF.md:31-35`**  
  **Claim:** Project configuration is “evidence-relevant history” and registration preserves “admission identities underneath.”  
  **Evidence/reasoning:** Configuration is applicability/context input, not evidence; admission is a separate authority record, not an identity contained by the authored rule.  
  **Fix:** Use “applicability-relevant configuration history” and “independently addressable admission records.”

- **S-29 — Medium — `BRIEF.md:45-47`**  
  **Claim:** The compressed repair statement preserves the causal rule.  
  **Evidence/reasoning:** It omits affected uses, exact context/observation/check versions, and fresh post-failure replay.  
  **Fix:** Include those qualifiers or link the compact statement explicitly to R10.

- **S-30 — High — `BRIEF.md:48-50`**  
  **Claim:** The brief retains PC4-06’s distinct clocks.  
  **Evidence/reasoning:** Condition lifetime is omitted.  
  **Fix:** Add it and distinguish current condition activation from historical retention.

- **S-31 — High — `BRIEF.md:51-54`**  
  **Claim:** A project-wide `off` does not delete “the condition.”  
  **Evidence/reasoning:** This conflates active derived state with immutable history. If `off` removes the active obligation, its active missing-evidence condition should normally cease; only its history must remain.  
  **Fix:** Say neither deletes evidence or condition history; clarify current-condition behavior.

- **S-32 — Medium — `BRIEF.md:56-66`**  
  **Claim:** The primary brief retains takeaway-changing limits.  
  **Evidence/reasoning:** It omits applicability ownership, operational-failure durable home, and that no real agent/editor/CI/Devtools usability or effectiveness evaluation occurred. EVIDENCE lines 132-142 calls these unsettled/unmeasured.  
  **Fix:** Add one concise sentence covering these limits.

- **S-33 — High — `BRIEF.md:70-78`**  
  **Claim:** The concrete config demonstrates separation.  
  **Evidence/reasoning:** It repeats the M03/M12 collapse and invents `standard`, `error`, and `warn` despite C09.  
  **Fix:** Split activation/config from policy or annotate the example as unresolved illustrative sugar with explicit lowering.

- **S-34 — Low — `BRIEF.md:81-83`**  
  **Claim:** An agent “submit[s] a complete observation.”  
  **Evidence/reasoning:** R06 requires capture and atomic submission of the complete returned batch; singular wording permits favorable selection.  
  **Fix:** Say “submit the method’s complete validated observation batch.”

- **S-35 — High — `frozen-analysis.json:15-29`**  
  **Claim:** Reconstruction and ablation are model-pass.  
  **Evidence/reasoning:** UC06/UC07/UC08 and multiple preservation cells above do not reconstruct.  
  **Fix:** Mark controls partial/failing until repaired and rerun them.

- **S-36 — Low — `sources.json:40-43`**  
  **Claim:** S06 describes the user basis used elsewhere.  
  **Evidence/reasoning:** The description records packages/enablement/local authoring but omits the broader event-1038 linter analogy later used to support diagnostics, severity, suppression, fixes, machine output, and CI.  
  **Fix:** Expand the source description or narrow E-O07/PC4-11’s claimed user basis.

## Unverified claims

- **S-37 — Medium — `PRESERVATION.md:38-46`**  
  The exact list of stable codes, suppression, fixes, machine output, and CI behavior is treated as user-required, but events 1038/1041 explicitly require only a linter analogy plus packaged/local per-project extension. Obtain confirmation or mark the added idioms analyst-inferred.

- **S-38 — Medium — `EVIDENCE.md:57-59`**  
  E-O07 calls the entire linter feature list source-stated/user-required. The recorded comments do not enumerate most of it. Reclassify the expanded list as an interpretation of “linting for agents.”

- **S-39 — High — `PROCESS.md:123-150`**  
  Removal-only ablation does not establish minimal decomposition: deleting M01 or M09 while deleting their jobs is not a countermodel that inlines those jobs elsewhere. It also never ablates O01–O09. Supply merge/redistribution countermodels or soften “minimal”/“every retained item.”

- **S-40 — Medium — `PROCESS.md:147-150`**  
  `TrustRule` is called the sole ergonomically necessary retained unit, but M02/M03 and X04 are also retained because of extension/interface ergonomics. Clarify the semantic criterion.

- **S-41 — Medium — `PROCESS.md:161-167`**  
  “Shorter than” alternative accounts is unsupported by a metric or reconstructed alternatives. Provide a unit/relation count and equal-coverage countermodels, or call this a qualitative compression judgment.

- **S-42 — Medium — `PROCESS.md:211-213`**  
  “No additional form survived” has no candidate-generation ledger. Record rejected forms and the distinction test, or soften to “no additional form was retained.”

- **S-43 — Medium — `sources.json:33-37`**  
  S05 is a mutable remote URL with no captured text/hash. The field log contains examination metadata, not quote-level evidence, so the Jev source boundary is sensible but independently unreproducible. Archive/hash the examined page or mark all article-specific claims unverified.

## Optional suggestions

- **S-44 — Low — `MODEL.md:56-58`**  
  Exact design question: may one claim be reused under multiple lint rule codes? If yes, move `ruleCode` off `ClaimDefinition` and onto rule/use/presentation identity.

- **S-45 — Low — `MODEL.md:267-276`**  
  Label `orders-preserve-ledger` explicitly hypothetical so it cannot be mistaken for second-domain range evidence.

- **S-46 — Low — `frozen-analysis.json:1-41`**  
  Add hashes for the frozen five Markdown artifacts and the base commit. The current files are uncommitted, so “frozen” is procedural rather than content-addressed.

- **S-47 — Low — `sources.json:14-18`, `sources.json:33-49`**  
  Add the `field_log.jsonl` path plus event-payload hashes for S02/S05/S06/S07 to make event-backed sources independently resolvable.

Reviewer self-assessment: I read all seven frozen artifacts; the full Trust RFC; Protocols survey; donor perturbation; run 57/event 872; preservation/user/Jev field-log events; Oracle Guide; and the cited prototype surfaces. Path-backed hashes matched the source map. I did not re-open the live Jev article, execute an API implementation, or test external donor primary sources, so article-specific and analogical claims remain bounded by the recorded examination metadata. No files were edited.
