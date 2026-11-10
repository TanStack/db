# H02 custom Query key OOM: bounded diagnostic

## Raw claim

Historical R23/R24 ran `receiver-partitioned-cache-oom.ts` under baseline and
repair. Both processes exhausted about 4 GiB during initial preload, before a
completed test or retention comparison. The archived driver hash is
`56e2f2854d978826ad89747f209d4e00db50879f8e065e21ab6d5607359919c8`.
Cause remains unverified. Historical records, canonical claims and statuses
remain untouched. A default semantic-cache control cannot close this claim.

## Authority and competing explanations

Query Collection docs, "Using Query Key Builders" and "Query Key Prefix
Convention", allow caller-built keys, require all data-changing options in
their identity, and require each derived key to extend `queryKey({})`.
The architecture's Query-db ownership section retains function-built cache
identity. The original function preserves a base prefix and assigns stable
numeric subscription identities. Its provider evaluates only its fixed five
keys and returns complete matching rows. Whether actual request options add
an omitted data dimension must be observed, not assumed.

Potential causes: legal acquisition feedback creating new keys/fetches;
unstable or insufficient fixture identity; retained request/spy histories;
recursive formatting of a subscription graph after an earlier error; or a
different setup/runtime failure. Record primitive projections, never entire
subscription objects, while keeping the original raw file unchanged.

## Pre-experiment gate

Read full live architecture, Query key/public ownership contract, primary
replay and Query ownership limits, oracle-review/authoring, rubric and glossary.
Use a new private archive at historical baseline 3937 with separate cloned
dependencies. The archive is a reconstruction: historical early build bytes
are unavailable, so it is not an exact reproduction of the original process.
Preserve the raw driver before diagnostic instrumentation. Pin source and
dependency identities. No product or oracle repairs are authorized.

## Experiments

1. Replay the raw archived driver against reconstructed source under a cap.
2. Add bounded primitive-only events around custom key, acquisition, fetch,
   public observation, and preload; preserve key semantics and provider data.
3. Vary only the observation/spy path or one legal custom-key dimension to
   discriminate operational growth from recorder/error-formatting growth.
4. Credit a product finding only with the original legal witness, its actual
   violated accepted law, and a recorded distinguishing observation. Otherwise
   retain an unverified diagnosis with the next needed evidence.

Slot 3; one heavy subprocess at a time. Node heap at most 384 MiB per process,
total diagnostic process-group RSS at most 1 GiB, wall time at most 20 seconds.
Instrumented event limits stop before unbounded acquisition history. Preserve
cap termination as outside-comparison evidence. No runs in private P, replay
author or old integration trees. All artifacts stay in this directory; the
scratch archive remains separate under `/private/tmp`.
