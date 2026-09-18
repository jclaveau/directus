---
'@directus/api': patch
---

Tag the near collection bare when a filter crosses its foreign key to the far primary key with an operator naming no row (`_neq`, `_gt`, `_nnull`, `_nin`, an empty `_in`). It was keyed on an empty slice set, so a write moving that column into the filtered set never reached the cached response. `_eq`/`_in` keep pinning the slice.

Trust an eviction's read-back only once the store proves it drops what it is asked to, since a swallowed store error answers `undefined` to the read-back as well as to the delete.
