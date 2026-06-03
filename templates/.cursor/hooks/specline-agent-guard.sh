#!/usr/bin/env bash
# specline-agent-guard.sh — subagentStart Hook（增强版）
# 白名单校验 + 流水线阶段匹配校验
#
# Input (stdin JSON):
#   { "subagent_type": "...", "subagent_id": "...", "task": "...", ... }
#
# Output (stdout JSON):
#   { "permission": "allow" } 或 { "permission": "deny", "user_message": "..." }

set -euo pipefail

input=$(cat)
subagent_type=$(echo "$input" | jq -r '.subagent_type // empty')
SESSION_ID=$(echo "$input" | jq -r '.session_id // empty')

# 非 specline agent → 放行（不受 Specline 管控）
if ! echo "$subagent_type" | grep -qE "^specline-"; then
  echo '{"permission": "allow"}'
  exit 0
fi

# ===== 1. 白名单校验 =====
ALLOWED_AGENTS="specline-spec-creator|specline-spec-reviewer|specline-frontend-dev|specline-backend-dev|specline-config-dev|specline-code-reviewer|specline-config-reviewer|specline-test-writer|specline-test-runner"

if ! echo "$subagent_type" | grep -qE "^($ALLOWED_AGENTS)$"; then
  echo "{\"permission\": \"deny\", \"user_message\": \"子Agent类型 '$subagent_type' 不在 Specline 允许列表中。允许的类型: spec-creator, spec-reviewer, frontend-dev, backend-dev, config-dev, code-reviewer, config-reviewer, test-writer, test-runner\"}"
  exit 0
fi

# ===== 2. 流水线阶段匹配校验 =====
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHANGES_DIR="$PROJECT_ROOT/specline/changes"

# 通过 session_id 解析绑定的 pipeline
resolve_pipeline_for_session() {
  local session_id="$1"
  local bindings_file="$PROJECT_ROOT/specline/.pipeline-sessions.json"

  if [ ! -f "$bindings_file" ]; then
    return 1
  fi

  local change_name
  change_name=$(jq -r --arg sid "$session_id" '.[$sid].change // empty' "$bindings_file" 2>/dev/null)

  if [ -z "$change_name" ]; then
    return 1
  fi

  local state_file="$CHANGES_DIR/$change_name/.pipeline-state.json"

  if [ ! -f "$state_file" ]; then
    # 脏数据：pipeline 已归档或不存在，清理绑定
    jq --arg sid "$session_id" 'del(.[$sid])' "$bindings_file" > "${bindings_file}.tmp" && mv "${bindings_file}.tmp" "$bindings_file"
    return 1
  fi

  STATE_FILE="$state_file"
  return 0
}

STATE_FILE=""
if ! resolve_pipeline_for_session "$SESSION_ID"; then
  echo '{"permission": "allow"}'
  exit 0
fi

phase=$(jq -r '.current_phase' "$STATE_FILE")
change=$(jq -r '.change_name' "$STATE_FILE")

# 判断 Agent 类型分类
is_spec_agent=$(echo "$subagent_type" | grep -qE "specline-spec-creator|specline-spec-reviewer" && echo "true" || echo "false")
is_coding_agent=$(echo "$subagent_type" | grep -qE "^(specline-frontend-dev|specline-backend-dev|specline-config-dev)$" && echo "true" || echo "false")
is_review_agent=$(echo "$subagent_type" | grep -qE "^(specline-code-reviewer|specline-config-reviewer)$" && echo "true" || echo "false")
is_test_agent=$(echo "$subagent_type" | grep -qE "specline-test-writer|specline-test-runner" && echo "true" || echo "false")

case "$phase" in
  spec)
    if [ "$is_coding_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 SPEC 阶段不能启动编码 Agent: $subagent_type。变更: $change。请先完成 SPEC → CODING 阶段切换。\"}"
      exit 0
    fi
    if [ "$is_test_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 SPEC 阶段不能启动测试 Agent: $subagent_type。变更: $change。\"}"
      exit 0
    fi
    if [ "$is_review_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 SPEC 阶段不能启动代码审查 Agent: $subagent_type。变更: $change。请使用 specline-spec-reviewer。\"}"
      exit 0
    fi
    # spec-creator, spec-reviewer → 放行
    ;;

  coding)
    if [ "$is_spec_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 CODING 阶段不能启动 Spec Agent: $subagent_type。变更: $change。如需修改 Spec，请手动编辑文件。\"}"
      exit 0
    fi
    # 编码/测试/审查 agent → 放行
    ;;

  code_review)
    if [ "$is_spec_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 CODE REVIEW 阶段不能启动 Spec Agent: $subagent_type。变更: $change。\"}"
      exit 0
    fi
    if [ "$is_test_agent" = "true" ] && [ "$subagent_type" != "specline-test-writer" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 CODE REVIEW 阶段不能启动测试运行 Agent。变更: $change。Test 在下一阶段。\"}"
      exit 0
    fi
    ;;

  test)
    if [ "$is_spec_agent" = "true" ]; then
      echo "{\"permission\": \"deny\", \"user_message\": \"🚫 TEST 阶段不能启动 Spec Agent: $subagent_type。变更: $change。\"}"
      exit 0
    fi
    # 编码/测试/审查 agent → 放行（测试阶段可能需要编码修复）
    ;;

  archive)
    echo "{\"permission\": \"deny\", \"user_message\": \"🚫 变更 $change 已归档，不能启动任何子 Agent。\"}"
    exit 0
    ;;
esac

# 阶段匹配 + 白名单都通过
echo '{"permission": "allow"}'
exit 0
