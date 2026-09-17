---
'@tanstack/powersync-db-collection': minor
---

Add attachments support via `TanStackDBAttachmentQueue`. This extends the PowerSync SDK's `AttachmentQueue` and backs it with
a TanStack DB collection, so attachment metadata and related rows commit atomically. Local files and remote uploads/deletes are managed separately.
