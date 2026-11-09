---
name: project_directus_file_storage_bugs
description: File upload/storage bugs collected in OOS issue #709 (was #635 + #621, closed 2026-11-09); every new storage/upload point goes there, never into an unrelated PR
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
7. upload failing after its row is written (stat / extractMetadata / sudo update) leaves row + bytes → FIXED by PR #705 (merged 57f7b63493): new file only, sudo row delete + bytes in their own try (ruling B+C, 13=C).
8. IPTC Headline/Caption/Keywords never reach the file: `parseIptc` emits lowercase keys, `get-metadata.ts:110-120` reads capitalised ones (filed 2026-11-09). A fix also needs the 255 cut for `title` (varchar 255); title is set from the filename on every upload path anyway, so only description/tags would change.
9. new upload's disk name `<id><ext>` checked at `files.ts:105`, claimed only after the bytes write via plain ItemsService (`files.ts:285`) → a racing JSON create with that `filename_disk` gets it first → RecordNotUnique instead of 400, and since #705 the cleanup deletes the bytes row Y points at (filed 2026-11-09, issuecomment-6738199909; read, not reproduced).

No HTTP path makes an upload fail after its bytes are written (probed 2026-11-09 for #705: title never reaches the DB from IPTC, width/height fit int4, getMetadata resolves `{}` on any sharp error, local `stat` can't fail) → that failure is unit-test-only unless a test adds its own constraint.

Related: thumbnail-shaped disk names (#614 pt 6) disappear with point 1's folder layout.

**Why:** many storage bugs, they polluted #614; jean plans a dedicated pass soon.
**2026-11-09:** jean made uploads/storage OOS: new issue #709 "oos feature: file uploads and storage: gathered points" lists #635 pts 1-6, 8, 9 as 1-8 and #621 pts 1-3 as 9-11 (links back); #635 and #621 closed not_planned. The numbering below is #635's.

**How to apply:** any new file/upload/storage finding in any review → add it to #709's body (no comment, per the oos rule), numbered after the last point, spec-by-example; keep it out of the PR under review. See [[feedback_directus_oos_features_to_their_issue]].
