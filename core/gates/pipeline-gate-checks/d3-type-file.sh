#!/usr/bin/env bash
#
# d3-type-file.sh - D3: Type-File 一致性检测
#
# 检测 tasks.md 中每个任务的 Type 字段与 Files 字段的扩展名是否一致。
# 通过 source 加载，定义 run_d3_type_file() 函数。
#
# 依赖:
#   - common.sh（提供 semantic_warn / semantic_info 和全局计数器）
#   - 环境变量 TASKS_FILE（由 gate_semantic 设置）
#
# 兼容性: bash 3.2+ (macOS 默认 bash)

set -euo pipefail

# ===== Type -> 期望扩展名匹配函数（兼容 bash 3.2，无关联数组）=====
#
# is_extension_for_type <type> <extension>
# 返回: 0 = 匹配, 1 = 不匹配
is_extension_for_type() {
  local t="$1"
  local e="$2"

  case "$t" in
    frontend)
      case "$e" in
        tsx|jsx|css|scss|less|html|vue|svelte) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    backend)
      case "$e" in
        py|go|rs|java|rb|php) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    infra)
      case "$e" in
        yaml|yml|tf|toml) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    db)
      case "$e" in
        sql|prisma) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    config)
      case "$e" in
        json|yaml|yml|toml|cfg|env) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    docs)
      case "$e" in
        md|rst|txt) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
}

# ===== 特殊文件名匹配 =====
# infra 类型下的无扩展名特殊文件
is_infra_special_name() {
  local name="$1"
  local lc_name
  lc_name=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  case "$lc_name" in
    dockerfile|docker-compose|docker-compose.yml|docker-compose.yaml) return 0 ;;
    *) return 1 ;;
  esac
}

# ===== check_file_against_type =====
# 参数: $1 = task_id, $2 = type, $3 = file_path
# 返回: 0 = 一致, 1 = 不匹配
check_file_against_type() {
  local task_id="$1"
  local task_type="$2"
  local file_path="$3"

  # 提取扩展名
  local ext=""
  local basename
  basename=$(basename "$file_path")

  # 判断是否有扩展名（文件名包含点号且点号不在开头）
  case "$basename" in
    *.*)
      ext="${basename##*.}"
      ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
      ;;
    *)
      ext=""
      ;;
  esac

  # --- 特殊规则 1: infra 类型下，无扩展名或特殊名称文件 ---
  if [ "$task_type" = "infra" ]; then
    if is_infra_special_name "$basename"; then
      return 0
    fi
    # 也检查扩展名以 yml/yaml 结尾的 docker-compose 变体
    local lc_basename
    lc_basename=$(echo "$basename" | tr '[:upper:]' '[:lower:]')
    case "$lc_basename" in
      docker-compose.yml|docker-compose.yaml) return 0 ;;
    esac
  fi

  # --- 特殊规则 2: .ts + server/ 路径 + Type: backend -> 一致 ---
  if [ "$ext" = "ts" ] && [ "$task_type" = "backend" ]; then
    local lc_path
    lc_path=$(echo "$file_path" | tr '[:upper:]' '[:lower:]')
    case "$lc_path" in
      *server/*|*/server|*server*) return 0 ;;
    esac
    # 如果 .ts 文件不在 server/ 路径下且 Type 是 backend，不算匹配
    # 继续执行下面的通用检查（.ts 不在 backend 列表中，会失败）
  fi

  # --- 特殊规则 3: db 类型下，路径包含 migration 或 schema 关键词 -> 一致 ---
  if [ "$task_type" = "db" ]; then
    local lc_path
    lc_path=$(echo "$file_path" | tr '[:upper:]' '[:lower:]')
    case "$lc_path" in
      *migration*|*schema*) return 0 ;;
    esac
  fi

  # --- 特殊规则 4: config 类型下，.env.xxx 变体文件（如 .env.example）-> 一致 ---
  if [ "$task_type" = "config" ]; then
    local lc_basename
    lc_basename=$(echo "$basename" | tr '[:upper:]' '[:lower:]')
    case "$lc_basename" in
      .env|.env.*|*.env) return 0 ;;
    esac
  fi

  # --- 通用规则: 检查扩展名 ---
  if [ -z "$ext" ]; then
    return 1
  fi

  if is_extension_for_type "$task_type" "$ext"; then
    return 0
  fi

  return 1
}

# ===== run_d3_type_file =====
# 主入口函数，由 gate_semantic 在 source 后调用
run_d3_type_file() {
  if [ -z "${TASKS_FILE:-}" ] || [ ! -f "$TASKS_FILE" ]; then
    echo "[WARN] TASKS_FILE 未设置或不存在，跳过 D3 检查" >&2
    return 0
  fi

  local all_pass=true
  local skipped_count=0
  local mismatch_count=0

  # 用 awk 解析 tasks.md，输出结构化的任务信息
  # 输出格式：
  #   FILE|<task_id>|<type>|<file_path>
  #   NOFILES|<task_id>|<type>
  local parsed_data
  parsed_data=$(awk '
    /^## [0-9]+\./ {
      # 新任务开始前，处理上一个任务
      if (task_id != "" && has_type == 1 && has_files == 0) {
        print "NOFILES|" task_id "|" task_type
      }
      # 提取新任务编号
      task_id = $2
      gsub(/\..*/, "", task_id)
      task_type = ""
      has_type = 0
      has_files = 0
    }
    /\*\*Type\*\*:/ {
      task_type = $0
      sub(/.*\*\*Type\*\*:[ \t]*/, "", task_type)
      sub(/[ \t]+$/, "", task_type)
      has_type = 1
    }
    /\*\*Files\*\*:/ {
      has_files = 1
      files_str = $0
      sub(/.*\*\*Files\*\*:[ \t]*/, "", files_str)
      # 分割逗号分隔的文件列表
      n = split(files_str, file_list, /,[ \t]*/)
      for (i = 1; i <= n; i++) {
        gsub(/^[ \t]+|[ \t]+$/, "", file_list[i])
        if (file_list[i] != "") {
          print "FILE|" task_id "|" task_type "|" file_list[i]
        }
      }
    }
    END {
      # 处理最后一个任务
      if (task_id != "" && has_type == 1 && has_files == 0) {
        print "NOFILES|" task_id "|" task_type
      }
    }
  ' "$TASKS_FILE")

  # 逐行处理解析结果
  while IFS= read -r line; do
    [ -z "$line" ] && continue

    local field1 field2 field3 field4
    field1=$(echo "$line" | cut -d'|' -f1)
    field2=$(echo "$line" | cut -d'|' -f2)
    field3=$(echo "$line" | cut -d'|' -f3)
    field4=$(echo "$line" | cut -d'|' -f4)

    case "$field1" in
      FILE)
        local tid="$field2"
        local ttype="$field3"
        local fpath="$field4"

        if ! check_file_against_type "$tid" "$ttype" "$fpath"; then
          semantic_warn "D3" "任务 ${tid} (Type: ${ttype}) 的 Files 可能不匹配 — ${fpath}"
          all_pass=false
          mismatch_count=$((mismatch_count + 1))
        fi
        ;;
      NOFILES)
        local tid="$field2"
        local ttype="$field3"
        semantic_info "D3" "任务 ${tid} 无 Files 字段，跳过 Type-File 一致性检查"
        skipped_count=$((skipped_count + 1))
        ;;
    esac
  done <<< "$parsed_data"

  # 输出汇总信息
  if [ "$all_pass" = true ]; then
    echo "[OK] D3 Type-File 一致性检查全部通过"
  fi

  return 0
}

# 如果直接执行此脚本（非 source），运行检查
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ -z "${TASKS_FILE:-}" ]; then
    echo "用法: TASKS_FILE=<path> bash $0"
    exit 1
  fi
  run_d3_type_file
fi
