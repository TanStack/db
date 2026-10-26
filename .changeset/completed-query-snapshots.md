---
'@tanstack/db': minor
---

Add opt-in completed live-query snapshot publication for persisted materialized
results. Restore a previously completed view while its sources revalidate, then
publish one complete replacement, including an empty result. Keep cold caches
and mismatched windows ineligible for fallback without changing network preload. Later changes that need new subset demand
retain the completed result until their demand settles.
