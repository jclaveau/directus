---
'@directus/memory': patch
---

Keep the local tier of the multi cache from refilling with a value a clear crossed: a redis read still decompressing when the flush landed was written back locally and outlived it. The read still answers; only keeping it is left to the next lookup.
