Check that all 5 locale files in frontend/messages/ have identical key structures.

Steps:
1. Read frontend/messages/en.json as the reference locale
2. For each other locale (fr, ar, pt, sw), compare key structures recursively
3. Report for each locale:
   - Missing keys (present in en.json but not in the locale)
   - Extra keys (present in the locale but not in en.json)
   - Keys with empty string values (translations not yet done)
4. Summarize: total missing, extra, and empty across all locales

Do NOT modify any files — only report differences.
Format output as a clear table per locale.
