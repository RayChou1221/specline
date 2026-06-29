#!/usr/bin/env bash
#
# a2-a3-reverse.sh — A2/A3 反向覆盖验证
#
# 从 spec.md 提取所有 Requirement 和 Scenario 名称，
# 与 tasks.md 中 Covers 字段引用的名称做交叉比对，
# 输出未被任何任务覆盖的 Requirement 和 Scenario（INFO 级别）。
#
# 依赖环境变量:
#   SPEC_FILE  — spec.md 文件路径
#   TASKS_FILE — tasks.md 文件路径
#   SPEC_REVIEW_FILE — 可选，spec-review.json 路径（交叉验证）
#
# 使用方式:
#   source a2-a3-reverse.sh
#   SPEC_FILE=... TASKS_FILE=... run_a2_a3_reverse

run_a2_a3_reverse() {
  local spec_file="${SPEC_FILE:-}"
  local tasks_file="${TASKS_FILE:-}"
  local review_file="${SPEC_REVIEW_FILE:-}"

  # 验证输入文件
  if [ -z "$spec_file" ] || [ ! -f "$spec_file" ]; then
    echo "ERROR: spec.md 文件不存在或未通过 SPEC_FILE 指定: ${spec_file:-未设置}" >&2
    return 1
  fi
  if [ -z "$tasks_file" ] || [ ! -f "$tasks_file" ]; then
    echo "ERROR: tasks.md 文件不存在或未通过 TASKS_FILE 指定: ${tasks_file:-未设置}" >&2
    return 1
  fi

  # =========================================
  # Step 1: 从 spec.md 提取所有 Requirement 和 Scenario 名称
  # =========================================

  local tmp_spec_reqs
  tmp_spec_reqs=$(mktemp) || return 1
  local tmp_spec_scens
  tmp_spec_scens=$(mktemp) || return 1
  local tmp_tasks_reqs
  tmp_tasks_reqs=$(mktemp) || return 1
  local tmp_tasks_scens
  tmp_tasks_scens=$(mktemp) || return 1

  _a2a3_cleanup() {
    rm -f "${tmp_spec_reqs:-}" "${tmp_spec_scens:-}" "${tmp_tasks_reqs:-}" "${tmp_tasks_scens:-}"
  }
  trap _a2a3_cleanup RETURN

  # 从 spec.md 解析 Requirement 和 Scenario
  local current_req=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^###[[:space:]]+Requirement:[[:space:]]+(.+)$ ]]; then
      current_req="${BASH_REMATCH[1]}"
      current_req="${current_req%"${current_req##*[![:space:]]}"}"
      echo "$current_req" >> "$tmp_spec_reqs"
    elif [[ "$line" =~ ^####[[:space:]]+Scenario:[[:space:]]+(.+)$ ]]; then
      local scen="${BASH_REMATCH[1]}"
      scen="${scen%"${scen##*[![:space:]]}"}"
      if [ -n "$current_req" ]; then
        printf '%s\t%s\n' "$current_req" "$scen" >> "$tmp_spec_scens"
      fi
    fi
  done < "$spec_file"

  # =========================================
  # Step 2: 从 tasks.md 提取 Covers 引用的 Requirement 和 Scenario
  # =========================================

  while IFS= read -r line; do
    if [[ "$line" =~ \*\*Covers\*\*[[:space:]]*:[[:space:]]*(.+) ]]; then
      local covers_content="${BASH_REMATCH[1]}"

      # 提取 Requirement 名称
      if [[ "$covers_content" =~ Requirement:[[:space:]]*([^,，]+) ]]; then
        local task_req="${BASH_REMATCH[1]}"
        task_req="${task_req%"${task_req##*[![:space:]]}"}"
        echo "$task_req" >> "$tmp_tasks_reqs"
      fi

      # 提取 Scenario 名称
      if [[ "$covers_content" =~ Scenario:[[:space:]]*(.+)$ ]]; then
        local scenarios_str="${BASH_REMATCH[1]}"
        scenarios_str="${scenarios_str%"${scenarios_str##*[![:space:]]}"}"

        # 用 、或 , 或 ，分割 Scenario 名称
        local cleaned="${scenarios_str//、/ }"
        cleaned="${cleaned//，/,}"
        cleaned="${cleaned//,/ }"
        cleaned="${cleaned//\// }"

        for item in $cleaned; do
          item="${item#"${item%%[![:space:]]*}"}"
          item="${item%"${item##*[![:space:]]}"}"
          if [ -n "$item" ]; then
            echo "$item" >> "$tmp_tasks_scens"
          fi
        done
      fi
    fi
  done < "$tasks_file"

  # =========================================
  # Step 3: 计算差集 — 未被覆盖的 Requirement 和 Scenario
  # =========================================

  sort -u "$tmp_spec_reqs" -o "$tmp_spec_reqs" 2>/dev/null || true
  sort -u "$tmp_spec_scens" -o "$tmp_spec_scens" 2>/dev/null || true
  sort -u "$tmp_tasks_reqs" -o "$tmp_tasks_reqs" 2>/dev/null || true
  sort -u "$tmp_tasks_scens" -o "$tmp_tasks_scens" 2>/dev/null || true

  local uncovered_req_count=0
  local uncovered_scen_count=0

  # 查找未被覆盖的 Requirement
  if [ -s "$tmp_spec_reqs" ]; then
    while IFS= read -r req; do
      if ! grep -qxF "$req" "$tmp_tasks_reqs" 2>/dev/null; then
        semantic_info "A2/A3" "Requirement \"${req}\" 不被任何任务覆盖"
        uncovered_req_count=$((uncovered_req_count + 1))
      fi
    done < "$tmp_spec_reqs"
  fi

  # 查找未被覆盖的 Scenario
  if [ -s "$tmp_spec_scens" ]; then
    while IFS=$'\t' read -r req scen; do
      if ! grep -qxF "$scen" "$tmp_tasks_scens" 2>/dev/null; then
        semantic_info "A2/A3" "Scenario \"${scen}\"（Requirement: \"${req}\"）不被任何任务覆盖"
        uncovered_scen_count=$((uncovered_scen_count + 1))
      fi
    done < "$tmp_spec_scens"
  fi

  # =========================================
  # Step 4: 全部覆盖时的汇总信息
  # =========================================
  if [ "$uncovered_req_count" -eq 0 ] && [ "$uncovered_scen_count" -eq 0 ]; then
    semantic_info "A2/A3" "所有 Requirement 和 Scenario 均被 Covers 覆盖"
  fi

  # =========================================
  # Step 5: 与 spec-review.json 交叉验证（如果存在）
  # =========================================
  if [ -z "$review_file" ]; then
    local spec_dir
    spec_dir=$(dirname "$spec_file")
    if [ -f "${spec_dir}/spec-review.json" ]; then
      review_file="${spec_dir}/spec-review.json"
    fi
  fi

  if [ -n "$review_file" ] && [ -f "$review_file" ]; then
    local review_reqs_covered
    local review_reqs_total
    review_reqs_covered=$(jq -r '.coverage.requirements_covered // "N/A"' "$review_file" 2>/dev/null || echo "N/A")
    review_reqs_total=$(jq -r '.coverage.requirements_total // "N/A"' "$review_file" 2>/dev/null || echo "N/A")

    if [ "$review_reqs_covered" != "N/A" ] && [ "$review_reqs_total" != "N/A" ]; then
      local spec_total_reqs
      local spec_covered_reqs
      spec_total_reqs=$(wc -l < "$tmp_spec_reqs" | tr -d '[:space:]')
      spec_covered_reqs=$((spec_total_reqs - uncovered_req_count))

      if [ "$spec_covered_reqs" -ne "$review_reqs_covered" ] || [ "$spec_total_reqs" -ne "$review_reqs_total" ]; then
        semantic_info "A2/A3" "与 spec-review.json 差异: A2 发现 ${spec_total_reqs} 个 Requirement（${spec_covered_reqs} 被覆盖），spec-review.json 报告 ${review_reqs_total} 个（${review_reqs_covered} 被覆盖）"
      fi
    fi
  fi
}
