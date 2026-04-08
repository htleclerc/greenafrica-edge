#!/usr/bin/env bash
# PreToolUse hook — blocks commands containing secrets/credentials
# Returns JSON with decision: "allow" or "block"

INPUT=$(cat)
TOOL=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_name||'')}catch(e){console.log('')}")
CMD=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.tool_input?.command||'')}catch(e){console.log('')}")

if [ "$TOOL" = "Bash" ]; then
  if echo "$CMD" | grep -qiE "(service_role|PGPASSWORD|supabase\.co.*apikey|supabase\.co.*Authorization)"; then
    echo '{"decision":"block","reason":"BLOCKED: Command contains secret material (service_role key, DB password, or Supabase API key). Use .env.local and application code instead of raw API calls."}'
    exit 0
  fi
fi

echo '{"decision":"allow"}'
