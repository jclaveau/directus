---
name: reference_directus_vitest4_tothrow_error_class
description: vitest 4 toThrow(new Error(msg)) also compares the error class, so a RouteNotFoundError never matches a plain Error; assert new RouteNotFoundError({path}) for full-message equality
metadata:
  author: Jean Claveau
  type: reference
---

`expect(fn).toThrow(new Error("Route /x doesn't exist."))` fails against a
`RouteNotFoundError` in vitest 4: the class is compared too. Build the real error
(`new RouteNotFoundError({ path })`) for a full-message pin; a bare string is only a
substring match (rejected by the full-message rule).

**Why:** hit on #670's middleware test; the red run failed for the wrong reason.

**How to apply:** when writing a red-first test, read the failure text and confirm it
fails on the behaviour, not on the matcher.
