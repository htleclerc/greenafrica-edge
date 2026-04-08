#!/usr/bin/env bash
# PostToolUse hook — warns about hardcoded strings in .tsx files
# Checks for possible hardcoded English text that should use useTranslations()

INPUT=$(cat)
TOOL=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_name||'')}catch(e){console.log('')}")
FILE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||j.tool_input?.path||'')}catch(e){console.log('')}")

if [ "$TOOL" = "Write" ] || [ "$TOOL" = "Edit" ]; then
  if echo "$FILE" | grep -qE "\.tsx$"; then
    # Skip test files and mock files
    if echo "$FILE" | grep -qE "(\.test\.|\.spec\.|__tests__|mock)"; then
      exit 0
    fi
    # Look for hardcoded strings: >Text with multiple words< pattern
    MATCHES=$(grep -Pn '>\s*[A-Z][a-z]+(\s+[a-z]+){2,}' "$FILE" 2>/dev/null | head -5)
    if [ -n "$MATCHES" ]; then
      echo "WARNING: Possible hardcoded string(s) detected in $FILE. Use useTranslations() from next-intl instead:"
      echo "$MATCHES"
    fi
  fi
fi
