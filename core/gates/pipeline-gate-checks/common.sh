#!/usr/bin/env bash
#
# common.sh — Specline Pipeline Gate 语义检查共享工具
#
# 提供:
#   - 全局计数器: SEMANTIC_ERRORS, SEMANTIC_WARNINGS, SEMANTIC_INFOS
#   - 严重度报告函数: semantic_error(), semantic_warn(), semantic_info()
#   - 文件定位函数: find_spec_file(), find_tasks_file()
#
# 兼容性: bash 3.2+ (macOS 默认 bash)

set -euo pipefail

# ===== 全局计数器 =====
SEMANTIC_ERRORS=${SEMANTIC_ERRORS:-0}
SEMANTIC_WARNINGS=${SEMANTIC_WARNINGS:-0}
SEMANTIC_INFOS=${SEMANTIC_INFOS:-0}

# ===== 严重度报告函数 =====

# semantic_error <code> <message>
# 输出 ERROR 级别消息到 stderr，并增加 SEMANTIC_ERRORS 计数
semantic_error() {
  local code="$1"
  local msg="$2"
  echo "❌ [ERROR] (${code}) ${msg}" >&2
  SEMANTIC_ERRORS=$((SEMANTIC_ERRORS + 1))
}

# semantic_warn <code> <message>
# 输出 WARNING 级别消息到 stdout，并增加 SEMANTIC_WARNINGS 计数
semantic_warn() {
  local code="$1"
  local msg="$2"
  echo "⚠️ [WARNING] (${code}) ${msg}"
  SEMANTIC_WARNINGS=$((SEMANTIC_WARNINGS + 1))
}

# semantic_info <code> <message>
# 输出 INFO 级别消息到 stdout，并增加 SEMANTIC_INFOS 计数
semantic_info() {
  local code="$1"
  local msg="$2"
  echo "ℹ️ [INFO] (${code}) ${msg}"
  SEMANTIC_INFOS=$((SEMANTIC_INFOS + 1))
}

# ===== 文件定位函数 =====

# find_spec_file
# 在 specline/changes/$CHANGE/specs/ 下查找 spec.md
find_spec_file() {
  if [ -z "${CHANGE:-}" ]; then
    echo ""
    return
  fi
  find "${PROJECT_ROOT:-.}/specline/changes/${CHANGE}/specs" -name "spec.md" 2>/dev/null | head -1
}

# find_tasks_file
# 返回 tasks.md 路径
find_tasks_file() {
  if [ -z "${CHANGE:-}" ]; then
    echo ""
    return
  fi
  echo "${PROJECT_ROOT:-.}/specline/changes/${CHANGE}/tasks.md"
}
