#!/usr/bin/env bash
# agent-guard.sh — subagentStart Hook: 校验子Agent类型
ALLOWED_AGENTS="specline-spec-creator|specline-spec-reviewer|specline-frontend-dev|specline-backend-dev|specline-code-reviewer|specline-test-writer|specline-test-runner"
input=$(cat)
subagent_type=$(echo "$input" | jq -r '.subagent_type // empty')
if [ -z "$subagent_type" ]; then
  echo '{"permission": "allow"}'
  exit 0
fi
if echo "$subagent_type" | grep -qE "^($ALLOWED_AGENTS)$"; then
  echo '{"permission": "allow"}'
  exit 0
fi
echo "{\"permission\": \"deny\", \"user_message\": \"子Agent类型 '$subagent_type' 不在允许列表中。\"}"
exit 0
