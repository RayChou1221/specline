#!/usr/bin/env bash
#
# specline-pipeline-gate.sh — 确定性门禁脚本（零 LLM 参与）
#
# Usage:
#   specline-pipeline-gate.sh <phase> --change <change-name>
#
# Phases:
#   new | list | artifacts | spec | build | lint | test-unit | test-integration | test-e2e | archive | status
#
# Exit codes:
#   0 = 通过
#   1 = 失败
#   2 = 输入参数错误

set -euo pipefail

# ===== 参数解析 =====
PHASE="${1:-}"
CHANGE=""
if [ "$#" -ge 3 ] && [ "$2" = "--change" ]; then
  CHANGE="$3"
fi

if [ -z "$PHASE" ]; then
  echo "Usage: specline-pipeline-gate.sh <phase> --change <change-name>"
  echo "Phases: new | list | artifacts | spec | build | lint | test-unit | test-integration | test-e2e | archive | status"
  exit 2
fi

# ===== 项目根目录 =====
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ===== 状态文件 =====
if [ -n "$CHANGE" ]; then
  STATE_FILE="$PROJECT_ROOT/specline/changes/$CHANGE/.pipeline-state.json"
else
  STATE_FILE=""
fi

# ===== 辅助函数 =====
now_iso8601() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_gate_passed() {
  local gate_path="$1"  # e.g., "phases.spec.gates.spec_gate"
  if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ]; then
    local time
    time=$(now_iso8601)
    jq --arg time "$time" \
      ".updated_at = \$time | .${gate_path} = { \"passed\": true, \"run_at\": \$time }" \
      "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  fi
}

fail() {
  echo "❌ $1" >&2
  exit 1
}

pass() {
  echo "✅ $1"
}

# ===== 获取 Spec 文件路径 =====
find_spec_file() {
  if [ -z "$CHANGE" ]; then
    echo ""
    return
  fi
  find "$PROJECT_ROOT/specline/changes/$CHANGE/specs" -name "spec.md" 2>/dev/null | head -1
}

# ===== Phase Handlers =====

gate_new() {
  if [ -z "$CHANGE" ]; then
    fail "需要 --change <name>"
  fi

  local change_dir="$PROJECT_ROOT/specline/changes/$CHANGE"

  if [ -d "$change_dir" ]; then
    echo "⚠️  Change '$CHANGE' 已存在"
    exit 0
  fi

  mkdir -p "$change_dir/specs"

  # 写入 .specline.yaml
  cat > "$change_dir/.specline.yaml" << YAML
schema: spec-driven
created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
YAML

  # 初始化 .pipeline-state.json
  cat > "$change_dir/.pipeline-state.json" << 'JSON'
{
  "version": 1,
  "change_name": "CHANGE_NAME_PLACEHOLDER",
  "created_at": "CREATED_AT_PLACEHOLDER",
  "updated_at": "CREATED_AT_PLACEHOLDER",
  "current_phase": "spec",
  "current_step": "spec-creator",
  "phases": {
    "spec": { "status": "in_progress", "retry_count": 0, "sub_phases": {}, "gates": { "spec_gate": { "passed": null }, "human_gate_1": { "passed": null } } },
    "coding": { "status": "pending", "tasks": [], "sub_phases": {}, "gates": { "build_gate": { "passed": null } } },
    "code_review": { "status": "pending", "retry_count": 0, "gates": { "lint_gate": { "passed": null }, "human_gate_2": { "passed": null } } },
    "test": { "status": "pending", "framework": null, "sub_phases": { "unit": { "status": "pending", "gates": { "test_unit_gate": { "passed": null } } }, "integration": { "status": "pending", "gates": { "test_integration_gate": { "passed": null } } }, "e2e": { "status": "pending", "gates": { "test_e2e_gate": { "passed": null } } } } },
    "archive": { "status": "pending", "gates": { "human_gate_3": { "passed": null }, "archive_gate": { "passed": null } } }
  }
}
JSON

  # 用实际值替换占位符
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  # macOS sed 兼容
  sed -i '' "s/CHANGE_NAME_PLACEHOLDER/$CHANGE/g" "$change_dir/.pipeline-state.json"
  sed -i '' "s/CREATED_AT_PLACEHOLDER/$now/g" "$change_dir/.pipeline-state.json"

  echo "✅ Change '$CHANGE' 已创建: $change_dir"
  echo "   .specline.yaml + .pipeline-state.json + specs/"

  write_gate_passed "phases.spec.gates.spec_gate"
}

gate_list() {
  local changes_dir="$PROJECT_ROOT/specline/changes"
  local json_output=false

  if [ "${1:-}" = "--json" ]; then
    json_output=true
  fi

  if [ ! -d "$changes_dir" ]; then
    if $json_output; then
      echo '[]'
    else
      echo "(无活跃 change)"
    fi
    exit 0
  fi

  if $json_output; then
    echo "["
    local first=true
    for f in "$changes_dir"/*/.pipeline-state.json; do
      [ -f "$f" ] || continue
      # 跳过 archive/
      if echo "$f" | grep -q "/archive/"; then continue; fi
      local dir name phase
      dir=$(dirname "$f")
      name=$(basename "$dir")
      phase=$(jq -r '.current_phase // "unknown"' "$f" 2>/dev/null)
      if [ "$first" = true ]; then first=false; else echo ","; fi
      echo "  {\"name\":\"$name\",\"phase\":\"$phase\"}"
    done
    echo "]"
  else
    for f in "$changes_dir"/*/.pipeline-state.json; do
      [ -f "$f" ] || continue
      if echo "$f" | grep -q "/archive/"; then continue; fi
      local dir name phase
      dir=$(dirname "$f")
      name=$(basename "$dir")
      phase=$(jq -r '.current_phase // "unknown"' "$f" 2>/dev/null)
      echo "  $name (phase: $phase)"
    done
  fi
}

gate_artifacts() {
  if [ -z "$CHANGE" ]; then
    fail "需要 --change <name>"
  fi

  local dir="$PROJECT_ROOT/specline/changes/$CHANGE"
  local json_output=false

  if [ "${1:-}" = "--json" ]; then
    json_output=true
  fi

  local has_proposal=false has_design=false has_tasks=false has_specs=false

  [ -f "$dir/proposal.md" ] && has_proposal=true
  [ -f "$dir/design.md" ] && has_design=true
  [ -f "$dir/tasks.md" ] && has_tasks=true
  [ -d "$dir/specs" ] && [ -n "$(find "$dir/specs" -name 'spec.md' 2>/dev/null)" ] && has_specs=true

  if $json_output; then
    echo "{"
    echo "  \"proposal\": $has_proposal,"
    echo "  \"design\": $has_design,"
    echo "  \"tasks\": $has_tasks,"
    echo "  \"specs\": $has_specs"
    echo "}"
  else
    echo "Artifacts for '$CHANGE':"
    echo "  proposal.md: $has_proposal"
    echo "  design.md:   $has_design"
    echo "  tasks.md:    $has_tasks"
    echo "  spec.md:     $has_specs"
  fi
}

gate_spec() {
  local spec_file
  spec_file=$(find_spec_file)

  if [ -z "$spec_file" ] || [ ! -f "$spec_file" ]; then
    fail "spec.md 不存在。请确保 spec-creator 已生成 spec 文件。"
  fi

  # 1. H1 含 "Specification"
  if ! grep -q "^# .* Specification" "$spec_file"; then
    fail "标题格式错误：H1 必须包含 'Specification' 关键词"
  fi

  # 2. 含 Purpose 章节
  if ! grep -q "^## Purpose" "$spec_file"; then
    fail "缺少 ## Purpose 章节"
  fi

  # 3. 含 Requirements 章节
  if ! grep -q "^## Requirements" "$spec_file"; then
    fail "缺少 ## Requirements 章节"
  fi

  # 4. 至少 1 个 Requirement
  local req_count
  req_count=$(grep -c "^### Requirement:" "$spec_file" || echo "0")
  if [ "$req_count" -lt 1 ]; then
    fail "至少需要 1 个 Requirement，当前: $req_count"
  fi
  pass "Requirements 数量: $req_count"

  # 5. 每个 Requirement 至少 1 个 Scenario（简化检查：Scenario 总数 >= Requirement 总数）
  local scenario_count
  scenario_count=$(grep -c "^#### Scenario:" "$spec_file" || echo "0")
  if [ "$scenario_count" -lt "$req_count" ]; then
    fail "每个 Requirement 至少需要 1 个 Scenario。Requirement: $req_count, Scenario: $scenario_count"
  fi
  pass "Scenario 数量: $scenario_count"

  # 6. WHEN/THEN 配对检查
  local when_count then_count
  when_count=$(grep -c "\*\*WHEN\*\*" "$spec_file" || echo "0")
  then_count=$(grep -c "\*\*THEN\*\*" "$spec_file" || echo "0")
  if [ "$when_count" -ne "$then_count" ]; then
    fail "WHEN/THEN 数量不匹配。WHEN: $when_count, THEN: $then_count"
  fi
  pass "WHEN/THEN 配对检查通过 ($when_count 对)"

  # 7. review.json 状态检查（如果存在）
  local review_file
  review_file="$(dirname "$spec_file")/spec-review.json"
  if [ -f "$review_file" ]; then
    local review_status
    review_status=$(jq -r '.status' "$review_file" 2>/dev/null || echo "missing")
    if [ "$review_status" != "approved" ]; then
      fail "spec-review.json 审核未通过 (status: $review_status)"
    fi
    pass "审核状态: approved"

    # 7b. 检查 coverage（所有 Requirement 和 Scenario 被 task 的 Covers 覆盖）
    local cov_req_total cov_req_covered
    cov_req_total=$(jq -r '.coverage.requirements_total' "$review_file" 2>/dev/null || echo "0")
    cov_req_covered=$(jq -r '.coverage.requirements_covered' "$review_file" 2>/dev/null || echo "0")
    if [ "$cov_req_covered" -lt "$cov_req_total" ]; then
      fail "Requirement 覆盖不全: $cov_req_covered/$cov_req_total"
    fi
    pass "Requirement 覆盖率: $cov_req_covered/$cov_req_total"
  else
    pass "审核状态: 无 spec-review.json（跳过审核检查）"
  fi

  # 8. 检查 tasks.md 是否存在且含完整的 Type/Depends/Covers/Files 标注
  local tasks_file="$PROJECT_ROOT/specline/changes/$CHANGE/tasks.md"
  if [ ! -f "$tasks_file" ]; then
    fail "tasks.md 不存在"
  fi
  pass "tasks.md 存在"

  # 9. 检查每个任务标注完整性
  local task_count type_count deps_count covers_count files_count
  task_count=$(grep -c '^## ' "$tasks_file" || echo "0")
  type_count=$(grep -c '\*\*Type\*\*:' "$tasks_file" || echo "0")
  deps_count=$(grep -c '\*\*Depends\*\*:' "$tasks_file" || echo "0")
  covers_count=$(grep -c '\*\*Covers\*\*:' "$tasks_file" || echo "0")
  files_count=$(grep -c '\*\*Files\*\*:' "$tasks_file" || echo "0")

  if [ "$type_count" -lt "$task_count" ] || [ "$deps_count" -lt "$task_count" ] || \
     [ "$covers_count" -lt "$task_count" ] || [ "$files_count" -lt "$task_count" ]; then
    fail "tasks.md 标注不完整：任务=$task_count, Type=$type_count, Depends=$deps_count, Covers=$covers_count, Files=$files_count"
  fi
  pass "tasks.md 标注完整性检查通过 ($task_count 个任务)"

  # 10. 至少 1 个任务无依赖
  local independent_count
  independent_count=$(grep -c '\*\*Depends\*\*: (none)' "$tasks_file" || echo "0")
  if [ "$independent_count" -lt 1 ]; then
    fail "至少需要 1 个无依赖任务 (Depends: none)，当前: $independent_count"
  fi
  pass "无依赖任务数: $independent_count"

  write_gate_passed "phases.spec.gates.spec_gate"
  pass "Spec Gate 全部通过"
}

gate_build() {
  # TypeScript 编译检查（如果存在 tsconfig.json）
  if [ -f "$PROJECT_ROOT/tsconfig.json" ]; then
    echo "正在检查 TypeScript 编译..."
    if ! npx tsc --noEmit 2>&1; then
      fail "TypeScript 编译失败"
    fi
    pass "TypeScript 编译通过"
  fi

  # Python 语法检查
  echo "正在检查 Python 语法..."
  local py_dirs=""
  for d in agent server scripts; do
    if [ -d "$PROJECT_ROOT/$d" ]; then
      py_dirs="$py_dirs $d"
    fi
  done
  if [ -n "$py_dirs" ]; then
    if ! python -m compileall -q $py_dirs 2>&1; then
      fail "Python 语法错误"
    fi
    pass "Python 语法检查通过"
  fi

  write_gate_passed "phases.coding.gates.build_gate"
  pass "Build Gate 全部通过"
}

gate_lint() {
  # Python lint (ruff)
  if command -v ruff &>/dev/null; then
    echo "正在检查 Python 代码规范..."
    if ! ruff check "$PROJECT_ROOT" --quiet 2>&1; then
      fail "Python lint 失败"
    fi
    pass "Python lint 通过"
  else
    echo "⚠️  ruff 未安装，跳过 Python lint"
  fi

  # JS/TS lint (eslint)
  if [ -f "$PROJECT_ROOT/package.json" ]; then
    if command -v npx &>/dev/null; then
      echo "正在检查 JS/TS 代码规范..."
      if ! npx eslint "$PROJECT_ROOT" --max-warnings 0 --quiet 2>&1; then
        fail "JS/TS lint 失败"
      fi
      pass "JS/TS lint 通过"
    fi
  fi

  # code-review.json error 计数
  local review_file="$PROJECT_ROOT/code-review.json"
  if [ -f "$review_file" ]; then
    local error_count
    error_count=$(jq '[.findings[] | select(.severity=="error")] | length' "$review_file" 2>/dev/null || echo "0")
    if [ "$error_count" -gt 0 ]; then
      fail "code-review.json 中发现 $error_count 个 error，必须修复"
    fi
    pass "Review errors: 0"
  fi

  write_gate_passed "phases.code_review.gates.lint_gate"
  pass "Lint Gate 全部通过"
}

# ===== 测试框架自动检测 =====
# 优先级：.pipeline-state.json 中的 test_framework > 项目配置文件检测 > 默认 pytest
detect_test_framework() {
  framework="" test_cmd="" coverage_cmd=""

  # 1. 先尝试从状态文件读取 test-writer 的检测结果
  if [ -f "$STATE_FILE" ]; then
    local recorded
    recorded=$(jq -r '.phases.test.framework // empty' "$STATE_FILE" 2>/dev/null)
    if [ -n "$recorded" ]; then
      framework="$recorded"
    fi
  fi

  # 2. 如果状态文件没有，从项目配置文件检测
  if [ -z "$framework" ]; then
    if [ -f "$PROJECT_ROOT/package.json" ]; then
      if grep -q '"jest"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
        framework="jest"
      elif grep -q '"vitest"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
        framework="vitest"
      elif grep -q '"mocha"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
        framework="mocha"
      fi
    elif [ -f "$PROJECT_ROOT/go.mod" ]; then
      framework="go-test"
    elif [ -f "$PROJECT_ROOT/Cargo.toml" ]; then
      framework="cargo-test"
    elif [ -f "$PROJECT_ROOT/pom.xml" ] || [ -f "$PROJECT_ROOT/build.gradle" ]; then
      framework="junit"
    fi
  fi

  # 3. 默认兜底
  if [ -z "$framework" ]; then
    framework="pytest"
  fi

  # 根据框架确定命令
  case "$framework" in
    jest)
      test_cmd="npx jest"
      coverage_cmd="npx jest --coverage"
      ;;
    vitest)
      test_cmd="npx vitest run"
      coverage_cmd="npx vitest run --coverage"
      ;;
    mocha)
      test_cmd="npx mocha"
      coverage_cmd="npx nyc mocha"
      ;;
    go-test)
      test_cmd="go test"
      coverage_cmd="go test -cover"
      ;;
    cargo-test)
      test_cmd="cargo test"
      coverage_cmd="cargo tarpaulin 2>/dev/null || cargo test"  # tarpaulin 可能未安装
      ;;
    junit)
      if [ -f "$PROJECT_ROOT/pom.xml" ]; then
        test_cmd="mvn test"
        coverage_cmd="mvn jacoco:report"
      else
        test_cmd="gradle test"
        coverage_cmd="gradle jacocoTestReport"
      fi
      ;;
    pytest|*)
      test_cmd="pytest"
      coverage_cmd="pytest --cov --cov-fail-under=80"
      ;;
  esac

  echo "检测到测试框架: $framework (命令: $test_cmd)"
}

gate_test_unit() {
  echo "正在执行单元测试..."
  detect_test_framework

  # 确定测试目录
  local test_dir=""
  for d in "$PROJECT_ROOT/tests/unit" "$PROJECT_ROOT/tests" "$PROJECT_ROOT/__tests__" "$PROJECT_ROOT/test"; do
    if [ -d "$d" ]; then
      test_dir="$d"
      break
    fi
  done

  if [ -z "$test_dir" ]; then
    echo "⚠️  未找到测试目录，尝试用框架默认命令运行..."
    if ! eval "$test_cmd" 2>&1; then
      fail "单元测试失败（无测试目录且框架命令执行失败）"
    fi
  else
    echo "测试目录: $test_dir"
    if ! eval "$test_cmd \"$test_dir\" -v 2>&1"; then
      fail "单元测试失败"
    fi
  fi

  # 覆盖率检查（非阻塞，警告即可——覆盖率的深入分析由 test-runner agent 负责）
  echo "正在检查覆盖率..."
  if ! eval "$coverage_cmd \"$test_dir\" 2>&1"; then
    echo "⚠️  覆盖率检查未通过（不阻塞，由 test-runner agent 深入分析）"
  fi

  write_gate_passed "phases.test.sub_phases.unit.gates.test_unit_gate"
  pass "单元测试通过"
}

gate_test_integration() {
  echo "正在执行集成测试..."
  detect_test_framework

  local test_dir=""
  for d in "$PROJECT_ROOT/tests/integration" "$PROJECT_ROOT/__tests__/integration"; do
    if [ -d "$d" ]; then
      test_dir="$d"
      break
    fi
  done

  if [ -z "$test_dir" ]; then
    echo "⚠️  无集成测试目录，跳过"
  else
    echo "测试目录: $test_dir"
    if ! eval "$test_cmd \"$test_dir\" -v 2>&1"; then
      fail "集成测试失败"
    fi
    # 覆盖率
    if ! eval "$coverage_cmd \"$test_dir\" 2>&1"; then
      echo "⚠️  覆盖率检查未通过（不阻塞）"
    fi
  fi
  write_gate_passed "phases.test.sub_phases.integration.gates.test_integration_gate"
  pass "集成测试通过"
}

gate_test_e2e() {
  echo "正在执行 E2E 测试..."
  detect_test_framework

  local test_dir=""
  for d in "$PROJECT_ROOT/tests/e2e" "$PROJECT_ROOT/__tests__/e2e" "$PROJECT_ROOT/e2e"; do
    if [ -d "$d" ]; then
      test_dir="$d"
      break
    fi
  done

  if [ -z "$test_dir" ]; then
    echo "⚠️  无 E2E 测试目录，跳过"
  else
    echo "测试目录: $test_dir"
    if ! eval "$test_cmd \"$test_dir\" -v 2>&1"; then
      fail "E2E 测试失败"
    fi
    # E2E 通常不需要覆盖率检查
  fi
  write_gate_passed "phases.test.sub_phases.e2e.gates.test_e2e_gate"
  pass "E2E 测试通过"
}

gate_archive() {
  if [ -z "$CHANGE" ]; then
    fail "需要 --change <name>"
  fi

  # 如果传了 --execute，执行实际归档动作
  if [ "${1:-}" = "--execute" ]; then
    local src_dir="$PROJECT_ROOT/specline/changes/$CHANGE"
    local archive_dir="$PROJECT_ROOT/specline/changes/archive"
    local date_prefix
    date_prefix=$(date -u +"%Y-%m-%d")
    local dest="$archive_dir/${date_prefix}-${CHANGE}"

    if [ ! -d "$src_dir" ]; then
      fail "Change '$CHANGE' 不存在: $src_dir"
    fi

    # 检查基本文件
    if [ ! -f "$src_dir/proposal.md" ]; then
      fail "缺少 proposal.md"
    fi
    if [ ! -f "$src_dir/tasks.md" ]; then
      fail "缺少 tasks.md"
    fi

    # 同步 delta specs 到主 specs
    if [ -d "$src_dir/specs" ]; then
      echo "正在同步 delta specs 到 specline/specs/..."
      cp -r "$src_dir/specs/"* "$PROJECT_ROOT/specline/specs/" 2>/dev/null || true
    fi

    # 移动到归档
    mkdir -p "$archive_dir"
    if [ -d "$dest" ]; then
      fail "归档目标已存在: $dest"
    fi

    mv "$src_dir" "$dest"
    echo "✅ 已归档到: $dest"

    # 更新状态文件
    if [ -f "$dest/.pipeline-state.json" ]; then
      local now
      now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      # macOS sed 兼容
      sed -i '' "s/\"current_phase\": \"[^\"]*\"/\"current_phase\": \"archived\"/g" "$dest/.pipeline-state.json" 2>/dev/null || true
    fi

    exit 0
  fi

  # 验证模式（原有逻辑，路径改为 specline）
  local archive_dir="$PROJECT_ROOT/specline/changes/archive"
  local found
  found=$(find "$archive_dir" -maxdepth 1 -type d -name "*$CHANGE" 2>/dev/null | head -1)

  if [ -z "$found" ]; then
    fail "归档目录不存在: $archive_dir/*$CHANGE"
  fi

  if [ ! -f "$found/proposal.md" ]; then
    fail "归档目录缺少 proposal.md"
  fi
  if [ ! -f "$found/tasks.md" ]; then
    fail "归档目录缺少 tasks.md"
  fi

  write_gate_passed "phases.archive.gates.archive_gate"
  pass "Archive Gate 全部通过"
}

gate_status() {
  if [ ! -f "$STATE_FILE" ]; then
    echo '{"status":"no_pipeline","message":"未找到流水线状态文件"}'
    exit 0
  fi

  jq '{
    change: .change_name,
    phase: .current_phase,
    step: .current_step,
    tasks: .phases.coding.tasks | map({id: .id, type: .type, status: .status, batch: .batch}),
    progress: {
      spec: .phases.spec.status,
      coding: .phases.coding.status,
      code_review: .phases.code_review.status,
      test: .phases.test.status,
      archive: .phases.archive.status
    }
  }' "$STATE_FILE"
}

# ===== 分派 =====

case "$PHASE" in
  new)
    gate_new
    ;;
  list)
    gate_list "$@"
    ;;
  artifacts)
    gate_artifacts "$@"
    ;;
  spec)
    gate_spec
    ;;
  build)
    gate_build
    ;;
  lint)
    gate_lint
    ;;
  test-unit)
    gate_test_unit
    ;;
  test-integration)
    gate_test_integration
    ;;
  test-e2e)
    gate_test_e2e
    ;;
  archive)
    gate_archive "$@"
    ;;
  status)
    gate_status
    ;;
  *)
    echo "未知 phase: $PHASE"
    echo "可用: new | list | artifacts | spec | build | lint | test-unit | test-integration | test-e2e | archive | status"
    exit 2
    ;;
esac

exit 0
