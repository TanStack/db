# R02 authority refinement: late keyed failure after a full-source retry

This immutable review note records the narrowing made during the v2 review. It preserves the earlier overstatement rather than silently replacing it. It authorizes no production work and changes no accepted final quiet result law.

## Exact question

The existing R02 trace identifies the initial broad root acquisition as root0, the marker-first keyed root acquisition as root2, and the later full-source root retry as root3. Root3 succeeds while root2 is still pending. A distinct proposed neighbor then rejects root2 after root0 has retired and root3 has succeeded. Does root2 necessarily remain required solely because no abort or unload has retired it?

The reviewed authority is the frozen C1 architecture, SHA256 `5b5aa10c6672e7e60e38c1d2f5f28fa1f956d60741fb75965808050a256130b1`, in the source epoch snapshots. Atomic window publication (1366–1382) requires a completed chosen result, retention on required refinement failure, coherent successful retry, and older joined work when it still gates publication. Initial readiness (1558–1563) requires each currently reachable demand to be covered by a settled request. Applied settlement, publication, and initial-demand laws (1833–1855) constrain exact request extent and coherent output. Law16 (1880–1956) distinguishes initial failure from request failures after initial-query readiness and makes abort retire a load's readiness/error effects.

## Correction and its reason

I initially treated nonretired root2 as necessarily required after root3 success and cited applied settlement as barring a different request from discharging it. That claim was stronger than the available authority. Root3's actual request is full source; its successful establishing transaction supplies the same finite row facts required by root2. The exact-request restriction prevents claiming broader extent than a request supplies; it does not by itself prohibit a full-source request from supplying narrower facts.

An unaborted, not-unloaded receipt establishes observed acquisition ownership and liveness. It does not alone decide whether redundant demand remains contractually required after overlapping coverage is established elsewhere. The quoted readiness rule says “covered by a settled request”; this frozen architecture does not explicitly decide substitution across these subscriptions without a receipt or retirement. Accordingly, no mandatory retained-empty result, current move rejection, or same-run explicit window retry follows solely from root2 staying active. A move already observed to fulfill cannot retrospectively acquire a required rejection.

The original R02 violation remains decisive: after successful surviving work and final quiet initial readiness, the coherent ordered inner join must contain root1/rank10, but production exposes empty output. This finding does not require the stronger coverage policy.

## Bounded successor witness

Root approved a test-only successor that records exact root2 identity/scope/liveness and the successful root3 prefix, then rejects root2. It reuses the same finite relational model and shared comparison. Its static callback snapshots allow the initial empty value and require every nonempty value to equal the complete chosen result. Once quiet and preload has settled, ready output must equal the full shared model. If initial failure terminates the live-query Collection, the preceding coherent publication remains the appropriate retained observation and recovery uses a fresh/restarted query. The witness must not assume that an identical `setWindow` recovers a terminal initial failure in place, require early move2 rejection, or claim all physical transports gate publication.

A shared conditional judgment therefore preserves the contract-permitted distinction while rejecting ready-empty output. A separate truly uncovered participant could establish an unambiguous required-failure case if a proposed repair needs one, but no such broader model is necessary for this bounded R02 gate.

## Remaining limit

The policy for a nonretired keyed demand whose facts are covered by another subscription's successful full-source request remains unspecified by this review. It is a recorded limit, not a blocking maintainer question unless the eventual production design depends on choosing a stronger policy. No law, model answer, or prior epoch has been rewritten to match production.
