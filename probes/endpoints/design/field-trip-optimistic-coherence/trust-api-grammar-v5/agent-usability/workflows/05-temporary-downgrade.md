# Workflow 5 — temporary endpoint downgrade

`orders.update` is blocked from deployment because its
`endpoints/safe-skip-refetch` condition lacks fresh complete-effects evidence.
An incident commander wants to deploy this endpoint for 45 minutes without
lowering the global policy or changing any other endpoint. The unresolved
condition must remain visible and the exception must expire automatically.

Simulate how an authorized agent inspects the required authority, previews the
effect, creates the narrow override, obtains a deployable decision, and later
observes expiry or revokes it early. Include overlapping/conflicting override,
stale snapshot, and deploy-after-expiry behavior where the design requires it.
