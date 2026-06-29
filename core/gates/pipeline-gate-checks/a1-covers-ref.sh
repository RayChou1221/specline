#!/usr/bin/env bash
#
# a1-covers-ref.sh — A1: Covers 引用存在性验证
#
# 验证 tasks.md 中每个任务的 Covers 字段引用的 Requirement 名称和 Scenario
# 名称在 spec.md 中实际存在。
#
# 兼容 bash 3.2+（macOS 默认版本），不使用关联数组（declare -A）。
#
# 依赖 common.sh 中定义的：
#   - semantic_error(code, msg)
#   - semantic_warn(code, msg)
#   - semantic_info(code, msg)
#   - SEMANTIC_ERRORS / SEMANTIC_WARNINGS / SEMANTIC_INFOS 全局计数器
#
# 环境变量：
#   SPEC_FILE  — spec.md 的路径
#   TASKS_FILE — tasks.md 的路径

# 确保正确处理多字节 UTF-8 字符（中文 Scenario/Requirement 名称）
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"

run_a1_covers_ref() {
  # ==== 输入校验 ====
  if [ ! -f "${SPEC_FILE:-}" ]; then
    semantic_error "A1" "spec.md 不存在: ${SPEC_FILE:-未设置}"
    return
  fi

  if [ ! -f "${TASKS_FILE:-}" ]; then
    semantic_error "A1" "tasks.md 不存在: ${TASKS_FILE:-未设置}"
    return
  fi

  # ==== 临时文件（存储 Requirement 和 Scenario 名称集合） ====
  # 兼容 bash 3.2，不使用 declare -A 关联数组
  local _req_file _scen_file
  _req_file=$(mktemp) || { semantic_error "A1" "无法创建临时文件"; return; }
  _scen_file=$(mktemp) || { rm -f "$_req_file"; semantic_error "A1" "无法创建临时文件"; return; }

  # ==== 1. 从 spec.md 提取 Requirement 和 Scenario 名称 ====
  local current_req="" scen_name=""

  while IFS= read -r line; do
    if [[ "$line" =~ ^###[[:space:]]+Requirement:[[:space:]]+(.+)$ ]]; then
      current_req="${BASH_REMATCH[1]}"
      current_req=$(echo "$current_req" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
      echo "$current_req" >> "$_req_file"
    elif [[ "$line" =~ ^####[[:space:]]+Scenario:[[:space:]]+(.+)$ ]]; then
      scen_name="${BASH_REMATCH[1]}"
      scen_name=$(echo "$scen_name" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
      if [ -n "$current_req" ]; then
        echo "${current_req}|${scen_name}" >> "$_scen_file"
      fi
    fi
  done < "$SPEC_FILE"

  # ==== 2. 从 tasks.md 解析 Covers 引用 ====
  local task_num=0
  local covers_content req_name scenarios_str split_list
  covers_content=""; req_name=""; scenarios_str=""; split_list=""

  while IFS= read -r line; do
    # 追踪任务编号（从 "## N." 标题行）
    if [[ "$line" =~ ^##[[:space:]]+([0-9]+)\. ]]; then
      task_num="${BASH_REMATCH[1]}"
      continue
    fi

    # 跳过非 Covers 行
    if [[ "$line" != *"**Covers**:"* ]]; then
      continue
    fi

    # 提取 Covers 内容
    covers_content=$(echo "$line" \
      | sed 's/.*\*\*Covers\*\*:[[:space:]]*//' \
      | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

    # 格式检查：必须有 "Requirement:" 前缀
    if [[ ! "$covers_content" =~ Requirement: ]]; then
      semantic_warn "A1" "任务 $task_num 的 Covers 行格式不规范，跳过该任务的引用验证"
      continue
    fi

    # 提取 Requirement 名称（Requirement: 之后到第一个分隔符之前）
    req_name=$(echo "$covers_content" \
      | sed -n 's/.*Requirement:[[:space:]]*//p' \
      | sed 's/[[:space:]]*[,，、].*//' \
      | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

    if [ -z "$req_name" ]; then
      semantic_warn "A1" "任务 $task_num 的 Covers 行缺少 Requirement 名称，跳过该任务的引用验证"
      continue
    fi

    # 校验 Requirement 存在性
    if ! grep -qxF "$req_name" "$_req_file" 2>/dev/null; then
      semantic_error "A1" "Covers 引用不存在: 任务 $task_num 引用了不存在的 Requirement \"$req_name\""
    fi

    # 提取并校验 Scenario 名称列表
    if [[ "$covers_content" =~ Scenario:[[:space:]]*(.+)$ ]]; then
      scenarios_str="${BASH_REMATCH[1]}"
      scenarios_str=$(echo "$scenarios_str" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

      # 拆分 Scenario 名称（分隔符：、 ， ,）
      split_list=$(echo "$scenarios_str" \
        | sed 's/[、，]/\'$'\n''/g' \
        | sed 's/,[[:space:]]*/\'$'\n''/g')

      while IFS= read -r scen_name; do
        scen_name=$(echo "$scen_name" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [ -z "$scen_name" ] && continue

        if ! grep -qxF "${req_name}|${scen_name}" "$_scen_file" 2>/dev/null; then
          semantic_error "A1" "Covers 引用不存在: 任务 $task_num 引用了不存在的 Scenario \"$scen_name\"（在 Requirement \"$req_name\" 下）"
        fi
      done <<< "$split_list"
    fi
  done < "$TASKS_FILE"

  # ==== 清理临时文件 ====
  rm -f "$_req_file" "$_scen_file"
}
