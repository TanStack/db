# Collection publication: bounded design grammar control

This directory records an exploratory Design grammar run. It changes no adapter API or production behavior.

- `analytical-state.json`: frozen Model, Evidence and Process layers, including source authority, provisional preservation list, reconstruction, ablation, active overlaps, generated forms, losses, source hashes and primary-brief support map.
- `PublicationGrammar.tla`: final finite state model. `PublicationGrammar.before-fifo.tla.txt` preserves the earlier encoding before review corrected FIFO and clarified abstraction limits.
- `*.cfg` and `*.log`: exact TLC configurations and raw results. `tlc-results.json` binds the results to the final model hash and pinned image.

Twelve configurations pass their stated safety properties and deadlock checks. Eight configurations produce their expected deadlock or invariant counterexample. The source-policy configurations intentionally do not assert whole-source completeness; buffer configurations do. Strict source withholding until load-promise success is a separate tested claim, not a synonym for coherent publication.

The model has one or two fixed, pre-enrolled demands and one abstract row per demand. Buffer policy combines a known complete authoritative cohort into ONE existing sync transaction. Dynamic demand discovery, independent peer enrollment, cancellation, user-projection validity, optimistic queues, persistence durability/mutex behavior and receiving hosts are outside the executable abstraction. No fairness or eventual-completion guarantee is claimed. Query and persisted witnesses helped extraction and are not held-out range evidence.

A repeatable command (replace the config name for the other cases):

```sh
docker run --rm --network none --read-only --memory 256m --cpus 1 \
  --tmpfs /tmp:rw,nodev,nosuid,size=32m \
  --volume "$PWD/review-evidence/collection-publication/design-grammar-v1:/work:ro" \
  sha256:985e5be2bfcb9a07189650114cd8839dd11f0e94d32407e91b9c77d69e7825e3 \
  -metadir /tmp/tlc -workers 1 -config source-success-2.cfg PublicationGrammar
```

The model is a design control. Passing it does not establish that a production repair exists, that it enforces these abstractions, or that a new adapter API is necessary. No Field Log was created.

