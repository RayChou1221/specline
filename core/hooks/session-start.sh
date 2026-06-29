#!/usr/bin/env bash
# specline-session-start.sh — sessionStart Hook (Pipeline Session Binding)
#
# 新会话启动时:
#   1. 清理过期绑定（7 天未更新）
#   2. 检查当前 session 是否已有绑定
#   3. 有绑定且 pipeline 仍活跃 → 使用已有绑定，注入上下文
#   4. 有绑定但 pipeline 已失效 → 清理脏数据，重新扫描
#   5. 无绑定 → 透明放行（echo '{}'）——不自动绑定，避免跨窗口污染
#
# Input (stdin JSON):
#   { "session_id": "...", "is_background_agent": bool, ... }
#
# Output (stdout JSON):
#   { "additional_context": "<pipeline 上下文>" }  或  {}（无活跃 pipeline）

set -euo pipefail

# ============================================================================
# Input
# ============================================================================

input=$(cat)

# 跳过 background agent（子 Agent 不需要 pipeline 上下文）
is_bg=$(echo "$input" | jq -r '.is_background_agent // false')
if [ "$is_bg" = "true" ]; then
  echo '{}'
  exit 0
fi

session_id=$(echo "$input" | jq -r '.session_id // empty')
if [ -z "$session_id" ]; then
  echo '{}'
  exit 0
fi

# ============================================================================
# Paths
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BINDINGS_FILE="$PROJECT_ROOT/specline/.pipeline-sessions.json"
CHANGES_DIR="$PROJECT_ROOT/specline/changes"

# ============================================================================
# Helper Functions
# ============================================================================

# init_bindings_file — ensure bindings file exists with a valid JSON object
init_bindings_file() {
  if [ ! -f "$BINDINGS_FILE" ]; then
    mkdir -p "$(dirname "$BINDINGS_FILE")"
    echo '{}' > "$BINDINGS_FILE"
  fi

  # Validate it's readable JSON; reset if corrupted
  if ! jq empty "$BINDINGS_FILE" 2>/dev/null; then
    echo '{}' > "$BINDINGS_FILE"
  fi
}

# clean_expired_bindings — remove bindings where bound_at > 7 days ago
# Uses ISO-8601 lexical comparison: works on both macOS and Linux
clean_expired_bindings() {
  [ -f "$BINDINGS_FILE" ] || return 0

  local cutoff_date
  # macOS date, fallback to Linux date
  cutoff_date=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)

  if [ -z "$cutoff_date" ]; then
    return 0  # Cannot determine cutoff, skip cleanup
  fi

  local tmp_file="${BINDINGS_FILE}.tmp"
  # Keep only entries whose bound_at is >= cutoff (i.e. within the last 7 days)
  jq --arg cutoff "$cutoff_date" \
    'with_entries(select(.value.bound_at >= $cutoff))' \
    "$BINDINGS_FILE" > "$tmp_file" 2>/dev/null && \
    mv "$tmp_file" "$BINDINGS_FILE" 2>/dev/null || true
}

# is_pipeline_active — check if a pipeline's state file exists and is not archived
# Returns 0 (active) or 1 (inactive)
is_pipeline_active() {
  local change_name="$1"
  local state_file="$CHANGES_DIR/$change_name/.pipeline-state.json"

  [ -f "$state_file" ] || return 1

  local phase
  phase=$(jq -r '.current_phase // "unknown"' "$state_file" 2>/dev/null)
  [ "$phase" != "archive" ] || return 1

  return 0
}

# scan_active_pipelines — scan changes/ (excluding archive/) for active pipelines
# Output: one line per pipeline: change_name|phase|state_file_path
scan_active_pipelines() {
  if [ ! -d "$CHANGES_DIR" ]; then
    return 0
  fi

  for state_file in "$CHANGES_DIR"/*/.pipeline-state.json; do
    [ -f "$state_file" ] || continue

    # Exclude archive/
    case "$state_file" in
      */archive/*) continue ;;
    esac

    local change_name phase
    change_name=$(jq -r '.change_name // ""' "$state_file" 2>/dev/null)
    phase=$(jq -r '.current_phase // ""' "$state_file" 2>/dev/null)

    [ -n "$change_name" ] || continue
    [ "$phase" != "archive" ] || continue

    printf '%s|%s|%s\n' "$change_name" "$phase" "$state_file"
  done
}

# phase_constraints — output constraint text for a given phase (to stdout)
phase_constraints() {
  local phase="$1"
  case "$phase" in
    spec)
      printf '%s\n' "- 只能通过 specline-spec-creator / specline-spec-reviewer 子 Agent 工作"
      printf '%s\n' "- 禁止编辑任何应用代码文件（.ts/.tsx/.py/.go 等）"
      printf '%s\n' "- 规划文件生成后需运行 Spec Gate"
      ;;
    coding)
      printf '%s\n' "- 编码必须通过子 Agent：specline-frontend-dev / specline-backend-dev / specline-config-dev"
      printf '%s\n' "- 禁止直接编辑应用代码文件"
      printf '%s\n' "- 每批次任务完成后运行 Build Gate"
      printf '%s\n' "- 每个 Task 完成后更新 tasks.md 的 checkbox"
      ;;
    code_review)
      printf '%s\n' "- 只能运行 specline-code-reviewer + Lint Gate"
      printf '%s\n' "- 如需修复代码，通过子 Agent 完成"
      ;;
    test)
      printf '%s\n' "- 运行测试 Gate 链：unit → integration → e2e"
      printf '%s\n' "- 测试失败时通过 specline-test-runner 分析原因"
      printf '%s\n' "- 代码修复通过子 Agent，测试修复通过 specline-test-writer"
      ;;
    *)
      printf '%s\n' "- 遵循 specline-pipeline SKILL 的当前阶段约束"
      ;;
  esac
}

# build_context — generate a JSON-escaped additional_context string for a bound pipeline
build_context() {
  local change_name="$1"
  local phase="$2"
  local state_file="$3"

  {
    printf '🚨 **Specline Pipeline 运行中**\n\n'
    printf '**当前变更**: %s\n' "$change_name"
    printf '**当前阶段**: %s\n' "$phase"

    # Task progress for coding phase
    if [ "$phase" = "coding" ] && [ -f "$state_file" ]; then
      local completed total
      completed=$(jq -r '[.phases.coding.tasks[]? | select(.status == "completed")] | length' "$state_file" 2>/dev/null || printf '0')
      total=$(jq -r '[.phases.coding.tasks[]?] | length' "$state_file" 2>/dev/null || printf '0')
      if [ "$total" != "0" ]; then
        printf '**任务进度**: %s/%s 完成\n' "$completed" "$total"
      fi
    fi

    printf '\n**阶段约束**:\n'
    phase_constraints "$phase"
    printf '\n'
    printf '**重要**: 你是 Specline Pipeline 编排者。上述约束具有最高优先级，必须在每个操作前检查是否符合当前阶段要求。'
  } | jq -Rs '.'
}

# phase_constraint_table — static phase constraint reference table (markdown)
phase_constraint_table() {
  cat << 'TABLEEOF'
| 阶段 | 约束 |
|------|------|
| spec | 只能通过 specline-spec-creator/specline-spec-reviewer 子 Agent 工作，禁止编辑代码 |
| coding | 必须通过子 Agent 编码，批次完成后运行 Build Gate，更新 tasks.md |
| code_review | 只能运行 specline-code-reviewer + Lint Gate |
| test | 运行测试 Gate 链：unit → integration → e2e |
TABLEEOF
}

# write_binding — write a session_id → change_name binding to .pipeline-sessions.json
write_binding() {
  local sid="$1"
  local change="$2"

  local now_iso
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local tmp_file="${BINDINGS_FILE}.tmp"
  jq --arg sid "$sid" --arg change "$change" --arg now "$now_iso" \
    '.[$sid] = {"change": $change, "bound_at": $now}' \
    "$BINDINGS_FILE" > "$tmp_file" 2>/dev/null && \
    mv "$tmp_file" "$BINDINGS_FILE" 2>/dev/null || true
}

# delete_binding — remove a session_id entry from .pipeline-sessions.json
delete_binding() {
  local session_id="$1"

  [ -f "$BINDINGS_FILE" ] || return 0

  local tmp_file="${BINDINGS_FILE}.tmp"
  jq --arg sid "$session_id" 'del(.[$sid])' "$BINDINGS_FILE" > "$tmp_file" 2>/dev/null && \
    mv "$tmp_file" "$BINDINGS_FILE" 2>/dev/null || true
}

# ============================================================================
# Main Logic
# ============================================================================

init_bindings_file

# 1. Clean expired bindings (bound_at > 7 days ago)
clean_expired_bindings

# 2. Check existing binding for this session
existing_change=""
if [ -f "$BINDINGS_FILE" ]; then
  existing_change=$(jq -r --arg sid "$session_id" '.[$sid].change // empty' "$BINDINGS_FILE" 2>/dev/null)
fi

if [ -n "$existing_change" ]; then
  if is_pipeline_active "$existing_change"; then
    # Binding is still valid — use it
    state_file="$CHANGES_DIR/$existing_change/.pipeline-state.json"
    phase=$(jq -r '.current_phase // "unknown"' "$state_file" 2>/dev/null)

    ctx_json=$(build_context "$existing_change" "$phase" "$state_file")

    printf '{\n  "additional_context": %s\n}\n' "$ctx_json"
    exit 0
  else
    # Dirty data: pipeline archived or deleted — clean up and rescan
    delete_binding "$session_id"
  fi
fi


# 3. No (valid) binding → transparent pass-through
# 不再自动绑定或注入任何 pipeline 上下文，避免跨窗口污染。
# 用户需通过 /specline-pipeline --change <name> 显式绑定。
echo '{}'
exit 0
