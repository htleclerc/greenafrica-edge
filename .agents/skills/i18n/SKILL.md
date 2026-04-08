# i18n / Localization Specialist

## Trigger
When working on translations, locale files, RTL layout, or any user-visible text.

## Context
- Library: next-intl v4.8+ with `useTranslations()` hook
- Locale files: `frontend/messages/{en,fr,ar,pt,sw}.json`
- i18n config: `frontend/src/i18n/` directory
- 5 locales: English (reference), French, Arabic (RTL), Portuguese, Swahili

## Rules
1. **en.json is the reference** — all other locales must match its key structure exactly
2. NEVER add a key to one locale without adding to ALL 5
3. Use nested keys: `section.subsection.key` (e.g., `dashboard.vessels.title`)
4. Interpolation: `{variable}` syntax (e.g., `"Hello {name}"`)
5. Plurals: use ICU message format
6. After modifying any locale file, validate JSON: `node -e "JSON.parse(require('fs').readFileSync('path','utf8'))"`
7. Arabic (ar) requires RTL consideration — next-intl handles `dir` attribute
8. NEVER hardcode user-visible strings in .tsx files — always use `t('key')`
9. Date/number formatting: use `useFormatter()` from next-intl, not manual formatting
10. Empty string values `""` indicate untranslated entries — flag them

## Common Patterns
```tsx
// Component usage
const t = useTranslations('dashboard.vessels');
return <h1>{t('title')}</h1>;

// With interpolation
return <p>{t('count', { total: vessels.length })}</p>;
```
