#!/usr/bin/env bash
# auto-format.sh — afterFileEdit Hook: 自动格式化
input=$(cat)
filepath=$(echo "$input" | jq -r '.file // empty')
if [ -z "$filepath" ]; then exit 0; fi
if echo "$filepath" | grep -qE "\.py$"; then
  command -v ruff &>/dev/null && ruff format "$filepath" 2>/dev/null || true
fi
if echo "$filepath" | grep -qE "\.(ts|tsx|js)$"; then
  command -v npx &>/dev/null && npx prettier --write "$filepath" 2>/dev/null || true
fi
exit 0
