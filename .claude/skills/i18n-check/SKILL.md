---
name: i18n-check
description: Check the English/Arabic string tables — keys missing in one language, t() calls with no entry, placeholder mismatches, and hard-coded UI text that bypasses t(). Run after adding or changing any user-facing text.
---

# i18n-check

Every athlete-facing word on the site goes through `t("key")` in
`js/i18n.js`, with both `en` and `ar`. This script finds where that has
slipped.

## Run

```
node .claude/skills/i18n-check/scripts/check.js
```

Exit code 1 means a hard failure (a key missing in one language, or a `t()`
call with no entry at all). Warnings are heuristics — read them, don't
mechanically "fix" them.

## What it reports

| Section | Meaning | Do |
|---|---|---|
| **Missing in ar / en** | key exists in one table only | add the twin |
| **Unknown key** | `t("x")` but no `en.x` | add both entries, or fix the typo |
| **Placeholder mismatch** | `{name}` vars differ between en and ar | align them |
| **Possible hard-coded text** | `textContent = "…"`, `title = "…"`, `alert("…")` etc. with real words | move to `t()` unless it is genuinely not for a person (a CSS value, a debug label) |

## Writing the Arabic

Arabic here is the club's own running vocabulary, not a dictionary
translation: إحماء (warm up), جري (run), استشفاء (recovery), تهدئة (cool
down), راحة (rest). Match the register of the neighbouring entries in the
`ar` table. Numbers and units stay as the `en` side has them. When the right
wording is uncertain, add your best draft and say so in the reply so the coach
can check it — a missing key is worse than a draft, because the site falls
back to English silently.
