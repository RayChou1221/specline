#!/usr/bin/env bash
#
# d1-cycle.sh — D1: 依赖环路检测
#
# 使用 awk 实现三色 DFS 检测 tasks.md 中任务依赖关系是否形成环路。
# 核心逻辑在 awk 中执行，避免 bash 版本兼容性问题（macOS bash 3.2）。
#
# 用法：
#   export TASKS_FILE=/path/to/tasks.md
#   source d1-cycle.sh && run_d1_cycle
#
# 环境变量：
#   TASKS_FILE — tasks.md 文件路径

# 确保计数器变量已定义（兼容独立 source 运行场景）
: "${SEMANTIC_ERRORS:=0}"
: "${SEMANTIC_WARNINGS:=0}"
: "${SEMANTIC_INFOS:=0}"

run_d1_cycle() {
  local tasks_file="${TASKS_FILE:-}"

  if [ -z "$tasks_file" ] || [ ! -f "$tasks_file" ]; then
    echo "⚠️ D1: TASKS_FILE 未设置或文件不存在，跳过依赖环路检测" >&2
    return 0
  fi

  # ──────────────────────────────────────────────
  # 使用 awk 完成全部检测逻辑：
  #   1. 解析 Depends 行构建邻接表
  #   2. 三色 DFS 环路检测
  #   3. 输出 "SELF:task_id" 或 "CYCLE:path" 行
  # ──────────────────────────────────────────────
  local result
  result=$(awk '
    # 解析任务编号
    /^## / {
      task = $2
      gsub(/\..*/, "", task)
    }
    # 解析 Depends 行
    /\*\*Depends\*\*:/ {
      deps = $0
      sub(/.*\*\*Depends\*\*:[ \t]*/, "", deps)
      gsub(/^[ \t]+|[ \t]+$/, "", deps)
      if (deps ~ /\(none\)/) {
        deps = ""
      }
      # 清理依赖列表：去空格，过滤非数字字符（防止意外格式变化）
      gsub(/[ \t]/, "", deps)
      gsub(/[^0-9,]/, "", deps)
      gsub(/,/, " ", deps)
      # 去掉多余的连续空格
      gsub(/  +/, " ", deps)
      gsub(/^ | $/, "", deps)
      adj[task] = deps
    }
    END {
      if (length(adj) == 0) exit 0

      # 收集所有任务 ID
      for (t in adj) {
        all_tasks[t] = 1
      }

      errors = 0

      # 对每个任务执行 DFS（使用参数传递路径，自动处理回溯）
      for (t in all_tasks) {
        if (!(t in color) || color[t] == 0) {
          dfs(t, "")
        }
      }
    }

    function dfs(node, path,   neighbors_str, n, i, arr, cnt, new_path, path_idx) {
      color[node] = 1
      new_path = path (path == "" ? "" : " ") node

      neighbors_str = adj[node]

      cnt = split(neighbors_str, arr, " ")
      for (i = 1; i <= cnt; i++) {
        n = arr[i]
        if (n == "") continue

        # 自引用
        if (n == node) {
          print "SELF:" node
          errors++
          continue
        }

        # 检查颜色
        if (n in color && color[n] == 1) {
          # 发现环路：从 new_path 中提取从 n 开始的路径
          path_idx = index(" " new_path " ", " " n " ")
          if (path_idx > 0) {
            cycle_seg = substr(new_path, path_idx)
          } else {
            cycle_seg = new_path
          }
          gsub(/ /, " → ", cycle_seg)
          print "CYCLE:" cycle_seg " → " n
          errors++
        } else if (!(n in color) || color[n] == 0) {
          dfs(n, new_path)
        }
      }

      color[node] = 2
    }
  ' "$tasks_file" 2>&1)

  # ──────────────────────────────────────────────
  # 处理 awk 输出，调用 semantic_error
  # ──────────────────────────────────────────────
  if [ -z "$result" ]; then
    echo "✅ D1 依赖环路检测通过（无环路）"
    return 0
  fi

  local line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      SELF:*)
        local self_task="${line#SELF:}"
        if type -t semantic_error &>/dev/null; then
          semantic_error "D1" "依赖环路检测: 任务 ${self_task} 自引用"
        else
          echo "❌ [ERROR] (D1) 依赖环路检测: 任务 ${self_task} 自引用" >&2
          ((SEMANTIC_ERRORS++))
        fi
        ;;
      CYCLE:*)
        local cycle_path="${line#CYCLE:}"
        if type -t semantic_error &>/dev/null; then
          semantic_error "D1" "依赖环路检测: 发现环路 ${cycle_path}"
        else
          echo "❌ [ERROR] (D1) 依赖环路检测: 发现环路 ${cycle_path}" >&2
          ((SEMANTIC_ERRORS++))
        fi
        ;;
    esac
  done <<< "$result"

  return 0
}
