#!/usr/bin/env bash
#
# c1-exception.sh — C1: 异常场景覆盖率检测
#
# 检查 spec.md 中每个 Requirement 是否至少包含一个异常/错误场景。
# 使用 SPEC_FILE 环境变量定位 spec 文件（由 gate_semantic 设置）。
#
# 异常关键词（不区分大小写）：
#   错误|失败|异常|超时|无效|不存在|未找到|拒绝|过期|冲突|超出|不允许|未授权|已存在
#
# Usage（由 gate_semantic source 后调用）:
#   run_c1_exception

run_c1_exception() {
  # 检查 spec 文件是否存在
  if [ ! -f "$SPEC_FILE" ]; then
    return 0
  fi

  # 检查是否有 Requirement 区块
  local req_count
  req_count=$(grep -c '^### Requirement:' "$SPEC_FILE" 2>/dev/null || true)
  req_count="${req_count:-0}"
  if [ "$req_count" = "0" ]; then
    semantic_warn "C1" "未找到任何 Requirement 区块，跳过异常场景覆盖率检查"
    return 0
  fi

  # 异常关键词（不区分大小写，用 grep -iE 扩展正则）
  local keywords="错误|失败|异常|超时|无效|不存在|未找到|拒绝|过期|冲突|超出|不允许|未授权|已存在"

  # 用 awk 按 Requirement 分组 Scenario 标题
  # 输出格式: 需求名称|场景标题1|场景标题2|...
  # 将 awk 输出捕获到变量，再用 here-string 逐行处理，避免管道 subshell 导致计数器丢失
  local grouped
  grouped=$(awk '
    /^### Requirement:/ {
      if (current_req != "") print current_req "|" scenarios
      current_req = $0
      sub(/^### Requirement: /, "", current_req)
      scenarios = ""
    }
    /^#### Scenario:/ {
      s = $0
      sub(/^#### Scenario: /, "", s)
      if (scenarios != "") scenarios = scenarios "|"
      scenarios = scenarios s
    }
    END {
      if (current_req != "") print current_req "|" scenarios
    }
  ' "$SPEC_FILE")

  # 逐行处理每个 Requirement
  while IFS='|' read -r req_name scenarios_str; do
    [ -z "$req_name" ] && continue

    # 统计该 Requirement 的 Scenario 数量
    local scenario_count
    if [ -z "$scenarios_str" ]; then
      scenario_count=0
    else
      scenario_count=$(echo "$scenarios_str" | awk -F'|' '{print NF}')
    fi

    # 检查 Scenario 标题集合中是否包含异常关键词
    if ! echo "$scenarios_str" | grep -qiE "$keywords" 2>/dev/null; then
      semantic_warn "C1" "Requirement \"${req_name}\" 缺少异常场景（${scenario_count} 个 Scenario 中无异常/错误场景关键词）"
    fi
  done <<< "$grouped"
}
