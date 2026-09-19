# Workflow 3 — CI gate

A clean-checkout CI job must decide whether the current repository can merge
under the `ci` policy. It must not mutate Trust state or run evidence methods.
The job needs useful human output, a machine-readable report artifact,
and a deterministic exit result for green, policy-blocked, and unable-to-
evaluate cases.

Write the CI configuration or shell/TypeScript wrapper you would use. Simulate
one policy-blocking condition and one configuration/operation failure. Explain
how snapshot consistency, overrides, decision-token expiry, and report upload
should behave.
