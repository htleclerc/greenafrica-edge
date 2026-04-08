Scan the entire repository for potential secret leaks. Do NOT modify any files.

Steps:
1. Search for API key patterns:
   - JWT tokens (eyJ...)
   - Supabase service_role or anon keys
   - Generic API keys (apikey=, api_key=, Authorization: Bearer)
2. Search for password patterns:
   - PGPASSWORD, password=, passwd=
   - Hardcoded credentials in code or config
3. Check .claude/settings.json for any hardcoded credentials or URLs with embedded keys
4. Verify .gitignore covers:
   - .env, .env.local, .env.*.local
   - Any other sensitive files
5. Check last 20 git commits for files that might contain secrets:
   - Run: git log --oneline -20 --name-only
   - Flag any .env files, credential files, or settings with secrets
6. Check for secrets in frontend/src/ code (hardcoded URLs with keys)

Report findings with severity levels:
- CRITICAL: Exposed service_role keys, DB passwords, or production credentials
- HIGH: Hardcoded API keys or tokens in source code
- MEDIUM: Missing .gitignore entries or potential credential patterns
- LOW: Informational findings
