---
"@tanstack/db": patch
---

Improve mutation merging from crude replacement to sophisticated merge logic

Previously, mutations were simply replaced when operating on the same item. Now mutations are intelligently merged based on their operation types (insert vs update vs delete), reducing network overhead and better preserving user intent.
