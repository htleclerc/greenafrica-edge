Generate a sprint status report for the AfricGreen project.

Steps:
1. Git activity (last 2 weeks):
   - Run: git log --oneline --since="2 weeks ago" --format="%h %s (%an, %ar)"
   - Categorize commits by type (feat/fix/refactor/docs/chore/test)
   - Count commits per type
2. Features & pages:
   - List all dashboard pages in frontend/src/app/(dashboard)/
   - List all hooks in frontend/src/hooks/
   - List all UI components in frontend/src/components/ui/
3. Code health:
   - Search for TODO, FIXME, HACK comments in frontend/src/
   - Count by category and list locations
4. i18n coverage:
   - Count keys in en.json vs other locales
   - Report any sync gaps
5. Sprint progress vs plan:
   - Reference the sprint plan from memory (Sprint 0-3)
   - Map completed features to sprint milestones

Format as a clean markdown report with sections and counts.
