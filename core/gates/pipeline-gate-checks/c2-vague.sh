#!/usr/bin/env bash
#
# c2-vague.sh — C2 检查：模糊需求检测
#
# 扫描 spec.md 中不可量化的模糊表述（如"足够快""适当"等），
# 跳过代码块（```）内内容，对匹配到的模糊词输出 WARNING。
#
# 依赖：common.sh（提供 semantic_warn 函数和 SEMANTIC_WARNINGS 计数器）
# 环境变量：SPEC_FILE — 指向 spec.md 的路径

# 加载共享工具函数（允许独立测试时直接 source）
if [ -z "${SEMANTIC_WARNINGS:-}" ]; then
  COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$COMMON_DIR/common.sh" ]; then
    source "$COMMON_DIR/common.sh"
  fi
fi

run_c2_vague() {
  if [ -z "${SPEC_FILE:-}" ] || [ ! -f "$SPEC_FILE" ]; then
    echo "⚠️ [WARNING] (C2) SPEC_FILE 未设置或文件不存在，跳过模糊需求检测" >&2
    return 0
  fi

  # 模糊词正则模式
  #   性能良好|足够快|适当[的地]|合理[的地]|必要时|等等|较好[的地]|
  #   尽量|较大规模|可能[的地]|若干|一定[的地]|一般[的地]|基本的|少量的
  local VAGUE_PATTERN='性能良好|足够快|适当[的地]|合理[的地]|必要时|等等|较好[的地]|尽量|较大规模|可能[的地]|若干|一定[的地]|一般[的地]|基本的|少量的'

  local in_codeblock=0
  local line_num=0

  while IFS= read -r line; do
    line_num=$((line_num + 1))

    # 检测代码块边界：以 ``` 开头（忽略后面的语言标记）
    if [[ "$line" =~ ^\`\`\` ]]; then
      if [ "$in_codeblock" -eq 0 ]; then
        in_codeblock=1
      else
        in_codeblock=0
      fi
      continue
    fi

    # 跳过代码块内部的行
    if [ "$in_codeblock" -eq 1 ]; then
      continue
    fi

    # 对普通文本行执行模糊词匹配
    if echo "$line" | grep -qE "$VAGUE_PATTERN" 2>/dev/null; then
      # 提取上下文（去除首尾空白）
      local context
      context=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

      semantic_warn "C2" "模糊需求表述: 第 ${line_num} 行 \"${context}\""
    fi
  done < "$SPEC_FILE"
}
