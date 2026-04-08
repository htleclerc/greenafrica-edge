#!/usr/bin/env bash
# PostToolUse hook — enforces Os* naming for UI primitive components
# Warns when a new file in components/ui/ doesn't follow the Os* prefix

INPUT=$(cat)
TOOL=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_name||'')}catch(e){console.log('')}")
FILE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||j.tool_input?.path||'')}catch(e){console.log('')}")

if [ "$TOOL" = "Write" ]; then
  if echo "$FILE" | grep -qE "components/ui/[^/]+\.tsx$"; then
    BASENAME=$(basename "$FILE" .tsx)
    if ! echo "$BASENAME" | grep -qE "^Os"; then
      echo "WARNING: UI primitive '$BASENAME.tsx' in components/ui/ does not follow the Os* naming convention. Expected: Os${BASENAME}.tsx"
    fi
  fi
fi
