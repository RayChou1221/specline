#!/usr/bin/env bash
# shell-guard.sh — beforeShellExecution Hook: 拦截危险命令
input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')
if echo "$command" | grep -qE "rm -rf|rm -r "; then
  echo '{"permission": "deny", "user_message": "危险命令被拦截: rm -rf"}'
  exit 0
fi
if echo "$command" | grep -qE "curl.*\|.*bash|wget.*\|.*sh"; then
  echo '{"permission": "deny", "user_message": "危险命令被拦截: 管道执行远程脚本"}'
  exit 0
fi
if echo "$command" | grep -qE "^sudo "; then
  echo '{"permission": "deny", "user_message": "sudo 需要人工审批"}'
  exit 0
fi
echo '{"permission": "allow"}'
exit 0
