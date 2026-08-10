# Test fixtures

Throwaway content used to exercise the build tooling. **Nothing in here is
site content.** It is never loaded by `astro build`, never rendered, and never
appears in the catalogue — the content collections read `src/content/` only.

## `broken-content/`

A deliberately wrong content set. Every file in it violates something on
purpose, and the integrity checks are expected to catch all of it:

```bash
npm run check:self
```

That command passes when the checks *find* problems and fails when they do
not, which is the only way to know the checks still work. Without it, a check
that silently stopped matching would look exactly like a clean content set.

When adding a new integrity check, add a matching violation here.
