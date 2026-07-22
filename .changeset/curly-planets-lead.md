---
'@tanstack/powersync-db-collection': patch
---

Add attachments support via `TanStackDBAttachmentQueue`. This extends the PowerSync SDK's `AttachmentQueue` and backs it with
a TanStack DB collection, so file uploads/deletes are managed atomically alongside the relational data.
