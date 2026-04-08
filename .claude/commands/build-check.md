Run a full pre-push validation pipeline in frontend/.

Steps (run sequentially, stop on first failure):
1. TypeScript check: cd frontend && npx tsc --noEmit
   - Report all type errors with file paths and line numbers
2. ESLint: cd frontend && npm run lint
   - Report all lint errors
3. Validate all 5 JSON locale files parse correctly:
   - For each file in frontend/messages/*.json, verify valid JSON
   - Check that all 5 locales have the same key count
4. Production build: cd frontend && npm run build
   - Report any build errors

For each step, report:
- PASS or FAIL status
- Error details if failed
- Summary at the end with total pass/fail count
