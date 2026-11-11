---
'@tanstack/db': patch
---

Start the replacement of an ordered repair before an obsolete step runs. When the source ordering changed while a repair's next page or refill was waiting, for example behind joined work, the obsolete repair issued one more request before it was replaced.
