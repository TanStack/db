# Workflow 2 — scheduled expired-evidence renewal

A daily maintenance agent starts with no specific endpoint selected. Some
Endpoints observations may have expired because captured dependencies changed.
The agent must find all ready renewal work, claim one safely, gather and submit
replacement evidence, learn whether the underlying condition cleared, and
prepare a PR if gathering evidence changed tracked repository artifacts.

Simulate the job, including pagination/batching assumptions, fenced lease
behavior, partial operational failure, idempotent retry, and the boundary
between Trust state and the external PR workflow.
