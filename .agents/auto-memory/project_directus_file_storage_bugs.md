---
name: project_directus_file_storage_bugs
description: File upload/storage bugs collected in issue #635; jean wants every new storage/upload point added there (to be fixed soon), never folded into an unrelated PR
metadata:
  type: project
---

Issue jclaveau/directus#635 collects the file upload / storage bugs (filed 2026-10-24 out of the #614 review). jean: "Memorize to save all the new points you find regarding this as we'll use it soon."

Open points in #635:
1. thumbnails keyed by basename at storage root → `a/photo.jpg` and `b/photo.jpg` share thumbnails (wrong image served); proposal: `__thumbnails/<file id>/<sha1>.<ext>`
2. replacement (`files.ts:218`) deletes the old bytes before `disk.move` → failed move leaves row with no file
3. `deleteMany` (`files.ts:495`) deletes bytes before a caller's trx commits → rollback restores a row without bytes (fix: `queueAfterCommit`)
4. TUS on: `readMany` filtered by `tus_id _null` → deleting an in-flight upload leaves its chunk file
5. tus replacement (`tus/data-store.ts:264`) never deletes its temp row
6. `filename_disk` unique index (migration `20261017A`, added by #614) ignores `storage` → two storages holding `a.jpg` fail the migration (health 503); fix = unique `(storage, filename_disk)`. Moved here from #614 pt 5 by jean 2026-10-30.

Related: thumbnail-shaped disk names (#614 pt 6) disappear with point 1's folder layout.

**Why:** many storage bugs, they polluted #614; jean plans a dedicated pass soon.
**How to apply:** any new file/upload/storage finding in any review → add it as a comment (or body edit) on #635, numbered after the last point, spec-by-example; keep it out of the PR under review. See [[feedback_directus_oos_features_to_their_issue]].
