#!/usr/bin/env bash
#
# specline-pipeline-gate.sh — 确定性门禁脚本（零 LLM 参与）
#
# Usage:
#   specline-pipeline-gate.sh <phase> --change <change-name>
#
# Phases:
#   new | list | artifacts | spec | semantic | build | lint | test-unit | test-integration | test-e2e | detect-modules | bind | archive | status
#
# Exit codes:
#   0 = 通过
#   1 = 失败
#   2 = 输入参数错误

set -euo pipefail

PHASE="${1:-}"
CHANGE=""
EXECUTE_ARCHIVE=""
POSITIONAL_ARGS=()

# 遍历所有参数，不依赖位置
shift  # 跳过 PHASE
while [ $# -gt 0 ]; do
  case "$1" in
    --change)
      CHANGE="$2"
      shift 2
      ;;
    --execute)
      EXECUTE_ARCHIVE="--execute"
      shift
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done
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

MODULES_JSON=""

detect_project_modules() {
  # 扫描 maxdepth 2 的语言标记文件，输出 JSON 数组
  # 格式: [{"path":"backend/","language":"go"},{"path":"frontend/","language":"typescript"}]
  # 排除: node_modules/, .git/, vendor/, dist/

  local modules='[]'

  while IFS= read -r marker; do
    [ -z "$marker" ] && continue
    local dir
    dir=$(dirname "$marker")
    local rel_dir="${dir#$PROJECT_ROOT/}"
    [ "$rel_dir" = "$dir" ] && rel_dir="."
    [ "$rel_dir" != "." ] && rel_dir="${rel_dir}/"

    case "$(basename "$marker")" in
      go.mod)
        modules=$(echo "$modules" | jq --arg p "$rel_dir" '. + [{"path":$p,"language":"go"}]')
        ;;
      Cargo.toml)
        modules=$(echo "$modules" | jq --arg p "$rel_dir" '. + [{"path":$p,"language":"rust"}]')
        ;;
      pyproject.toml|setup.cfg|requirements.txt)
        local exists
        exists=$(echo "$modules" | jq --arg p "$rel_dir" '[.[] | select(.path == $p and .language == "python")] | length')
        if [ "$exists" = "0" ]; then
          modules=$(echo "$modules" | jq --arg p "$rel_dir" '. + [{"path":$p,"language":"python"}]')
        fi
        ;;
      package.json)
        if ! grep -q '"workspaces"' "$marker" 2>/dev/null; then
          local lang="javascript"
          [ -f "${dir}/tsconfig.json" ] && lang="typescript"
          modules=$(echo "$modules" | jq --arg p "$rel_dir" --arg l "$lang" '. + [{"path":$p,"language":$l}]')
        fi
        ;;
      pom.xml)
        modules=$(echo "$modules" | jq --arg p "$rel_dir" '. + [{"path":$p,"language":"java"}]')
        ;;
      build.gradle|build.gradle.kts)
        local exists
        exists=$(echo "$modules" | jq --arg p "$rel_dir" '[.[] | select(.path == $p)] | length')
        if [ "$exists" = "0" ]; then
          modules=$(echo "$modules" | jq --arg p "$rel_dir" '. + [{"path":$p,"language":"kotlin"}]')
        fi
        ;;
    esac
  done < <(find "$PROJECT_ROOT" -maxdepth 2 \
    \( -name "go.mod" -o -name "package.json" -o -name "Cargo.toml" \
       -o -name "pyproject.toml" -o -name "setup.cfg" -o -name "requirements.txt" \
       -o -name "pom.xml" -o -name "build.gradle" -o -name "build.gradle.kts" \) \
    -not -path "*/node_modules/*" -not -path "*/.git/*" \
    -not -path "*/vendor/*" -not -path "*/dist/*" -not -path "*/.tmp*/*" -not -path "*/.tmp-*" 2>/dev/null)

  echo "$modules"
}

load_project_config() {
  local config_file="$PROJECT_ROOT/specline/config.yaml"
  MODULES_JSON=""

  if [ -f "$config_file" ] && grep -q '^project:' "$config_file" 2>/dev/null; then
    if grep -q '^    - path:' "$config_file" 2>/dev/null; then
      MODULES_JSON=$(awk '
        /^  modules:/ { in_modules=1; next }
        /^  [a-z]/ && !/^    / { in_modules=0 }
        /^[a-z]/ { in_modules=0 }
        in_modules && /^    - path:/ {
          if (path != "") printf ","
          path=$NF; gsub(/["'\'']/, "", path)
          printf "{\"path\":\"%s\"", path
        }
        in_modules && /^      language:/ {
          lang=$NF; gsub(/["'\'']/, "", lang)
          printf ",\"language\":\"%s\"}", lang
        }
      ' "$config_file")
      if [ -n "$MODULES_JSON" ]; then
        MODULES_JSON="[${MODULES_JSON}]"
      fi
    fi
  fi

  if [ -z "$MODULES_JSON" ] || [ "$MODULES_JSON" = "[]" ]; then
    MODULES_JSON=$(detect_project_modules)
  fi
}

module_absolute_path() {
  local rel_path="$1"
  if [ "$rel_path" = "." ] || [ "$rel_path" = "./" ]; then
    echo "$PROJECT_ROOT"
  else
    echo "$PROJECT_ROOT/${rel_path%/}"
  fi
}

module_has_eslint_config() {
  local mod_dir="$1"
  local f
  for f in eslint.config.js eslint.config.mjs eslint.config.cjs .eslintrc.js .eslintrc.cjs .eslintrc.json; do
    [ -f "$mod_dir/$f" ] && return 0
  done
  return 1
}

build_module() {
  local rel_path="$1"
  local lang="$2"
  local mod_dir
  mod_dir=$(module_absolute_path "$rel_path")

  case "$lang" in
    go)
      echo "正在 build Go 模块: $rel_path"
      if ! (cd "$mod_dir" && go build ./...); then
        fail "Go build 失败 ($rel_path)"
      fi
      ;;
    typescript)
      echo "正在 build TypeScript 模块: $rel_path"
      if ! (cd "$mod_dir" && npx tsc --noEmit); then
        fail "TypeScript 编译失败 ($rel_path)"
      fi
      ;;
    javascript)
      echo "ℹ️  JavaScript 模块 $rel_path 无 compile 步骤，跳过 build"
      ;;
    python)
      echo "正在检查 Python 语法: $rel_path"
      if ! (cd "$mod_dir" && python3 -m compileall -q .); then
        fail "Python 语法错误 ($rel_path)"
      fi
      ;;
    rust)
      echo "正在 build Rust 模块: $rel_path"
      if ! (cd "$mod_dir" && cargo build); then
        fail "Rust build 失败 ($rel_path)"
      fi
      ;;
    java)
      echo "正在 build Java 模块: $rel_path"
      if ! (cd "$mod_dir" && mvn compile -q); then
        fail "Java build 失败 ($rel_path)"
      fi
      ;;
    kotlin)
      echo "正在 build Kotlin 模块: $rel_path"
      if [ -f "$mod_dir/build.gradle.kts" ] || [ -f "$mod_dir/build.gradle" ]; then
        if ! (cd "$mod_dir" && ./gradlew compileKotlin -q 2>/dev/null || gradle compileKotlin -q); then
          fail "Kotlin build 失败 ($rel_path)"
        fi
      fi
      ;;
    *)
      echo "⚠️  未知语言 '$lang' ($rel_path)，跳过 build"
      ;;
  esac
}

lint_module() {
  local rel_path="$1"
  local lang="$2"
  local mod_dir
  mod_dir=$(module_absolute_path "$rel_path")

  case "$lang" in
    go)
      echo "正在 lint Go 模块: $rel_path"
      if command -v go &>/dev/null; then
        if ! (cd "$mod_dir" && go vet ./...); then
          fail "Go vet 失败 ($rel_path)"
        fi
        if command -v golangci-lint &>/dev/null; then
          if ! (cd "$mod_dir" && golangci-lint run ./...); then
            fail "golangci-lint 失败 ($rel_path)"
          fi
        fi
      else
        echo "⚠️  go 未安装，跳过 Go lint ($rel_path)"
      fi
      ;;
    typescript|javascript)
      if module_has_eslint_config "$mod_dir"; then
        echo "正在 lint JS/TS 模块: $rel_path"
        if command -v npx &>/dev/null; then
          if ! (cd "$mod_dir" && npx eslint . --quiet); then
            fail "ESLint 失败 ($rel_path)"
          fi
        fi
      else
        echo "ℹ️  模块 $rel_path 无 eslint 配置，跳过 JS/TS lint"
      fi
      ;;
    python)
      if command -v ruff &>/dev/null; then
        echo "正在 lint Python 模块: $rel_path"
        if ! (cd "$mod_dir" && ruff check . --quiet); then
          fail "Python lint 失败 ($rel_path)"
        fi
      else
        echo "⚠️  ruff 未安装，跳过 Python lint ($rel_path)"
      fi
      ;;
    rust)
      echo "正在 lint Rust 模块: $rel_path"
      if ! (cd "$mod_dir" && cargo clippy -- -D warnings 2>/dev/null || cargo clippy); then
        fail "Rust clippy 失败 ($rel_path)"
      fi
      ;;
    java|kotlin)
      echo "ℹ️  Java/Kotlin lint 暂未集成 ($rel_path)，跳过"
      ;;
    *)
      echo "⚠️  未知语言 '$lang' ($rel_path)，跳过 lint"
      ;;
  esac
}

run_default_unit_test() {
  local rel_path="$1"
  local lang="$2"
  local mod_dir
  mod_dir=$(module_absolute_path "$rel_path")

  case "$lang" in
    go)
      echo "正在执行 Go 单元测试: $rel_path"
      if ! (cd "$mod_dir" && go test ./...); then
        fail "Go 单元测试失败 ($rel_path)"
      fi
      ;;
    python)
      echo "正在执行 Python 单元测试: $rel_path"
      if ! (cd "$mod_dir" && pytest); then
        fail "Python 单元测试失败 ($rel_path)"
      fi
      ;;
    typescript|javascript)
      if [ -f "$mod_dir/package.json" ]; then
        if grep -q '"vitest"' "$mod_dir/package.json" 2>/dev/null; then
          echo "正在执行 Vitest 单元测试: $rel_path"
          if ! (cd "$mod_dir" && npx vitest run); then
            fail "Vitest 单元测试失败 ($rel_path)"
          fi
        elif grep -q '"jest"' "$mod_dir/package.json" 2>/dev/null; then
          echo "正在执行 Jest 单元测试: $rel_path"
          if ! (cd "$mod_dir" && npx jest); then
            fail "Jest 单元测试失败 ($rel_path)"
          fi
        else
          echo "⚠️  模块 $rel_path 未检测到 vitest/jest，跳过单元测试"
        fi
      fi
      ;;
    rust)
      echo "正在执行 Rust 单元测试: $rel_path"
      if ! (cd "$mod_dir" && cargo test); then
        fail "Rust 单元测试失败 ($rel_path)"
      fi
      ;;
    java)
      echo "正在执行 Java 单元测试: $rel_path"
      if [ -f "$mod_dir/pom.xml" ]; then
        if ! (cd "$mod_dir" && mvn test -q); then
          fail "Java 单元测试失败 ($rel_path)"
        fi
      fi
      ;;
    kotlin)
      echo "正在执行 Kotlin 单元测试: $rel_path"
      if [ -f "$mod_dir/build.gradle.kts" ] || [ -f "$mod_dir/build.gradle" ]; then
        if ! (cd "$mod_dir" && ./gradlew test -q 2>/dev/null || gradle test -q); then
          fail "Kotlin 单元测试失败 ($rel_path)"
        fi
      fi
      ;;
    *)
      echo "⚠️  未知语言 '$lang' ($rel_path)，跳过单元测试"
      ;;
  esac
}

run_default_integration_test() {
  local rel_path="$1"
  local lang="$2"
  local mod_dir
  mod_dir=$(module_absolute_path "$rel_path")

  case "$lang" in
    go)
      echo "正在执行 Go 集成测试: $rel_path"
      if ! (cd "$mod_dir" && go test ./...); then
        fail "Go 集成测试失败 ($rel_path)"
      fi
      ;;
    python)
      if [ -d "$mod_dir/tests/integration" ]; then
        echo "正在执行 Python 集成测试: $rel_path"
        if ! (cd "$mod_dir" && pytest tests/integration -v); then
          fail "Python 集成测试失败 ($rel_path)"
        fi
      else
        echo "ℹ️  模块 $rel_path 无 tests/integration/，跳过集成测试"
      fi
      ;;
    typescript|javascript)
      if [ -d "$mod_dir/tests/integration" ]; then
        if grep -q '"vitest"' "$mod_dir/package.json" 2>/dev/null; then
          if ! (cd "$mod_dir" && npx vitest run tests/integration); then
            fail "Vitest 集成测试失败 ($rel_path)"
          fi
        elif grep -q '"jest"' "$mod_dir/package.json" 2>/dev/null; then
          if ! (cd "$mod_dir" && npx jest tests/integration); then
            fail "Jest 集成测试失败 ($rel_path)"
          fi
        fi
      else
        echo "ℹ️  模块 $rel_path 无 tests/integration/，跳过集成测试"
      fi
      ;;
    rust)
      if [ -d "$mod_dir/tests" ]; then
        if ! (cd "$mod_dir" && cargo test --test '*' 2>/dev/null || cargo test); then
          fail "Rust 集成测试失败 ($rel_path)"
        fi
      fi
      ;;
    *)
      echo "ℹ️  语言 '$lang' 集成测试默认命令未定义 ($rel_path)，跳过"
      ;;
  esac
}

run_default_e2e_test() {
  local rel_path="$1"
  local lang="$2"
  local mod_dir
  mod_dir=$(module_absolute_path "$rel_path")

  case "$lang" in
    python)
      if [ -d "$mod_dir/tests/e2e" ]; then
        if ! (cd "$mod_dir" && pytest tests/e2e -v); then
          fail "Python E2E 测试失败 ($rel_path)"
        fi
      else
        echo "ℹ️  模块 $rel_path 无 tests/e2e/，跳过 E2E 测试"
      fi
      ;;
    typescript|javascript)
      if [ -d "$mod_dir/tests/e2e" ] || [ -d "$mod_dir/e2e" ]; then
        local e2e_dir="tests/e2e"
        [ -d "$mod_dir/e2e" ] && e2e_dir="e2e"
        if grep -q '"vitest"' "$mod_dir/package.json" 2>/dev/null; then
          if ! (cd "$mod_dir" && npx vitest run "$e2e_dir"); then
            fail "Vitest E2E 测试失败 ($rel_path)"
          fi
        elif grep -q '"jest"' "$mod_dir/package.json" 2>/dev/null; then
          if ! (cd "$mod_dir" && npx jest "$e2e_dir"); then
            fail "Jest E2E 测试失败 ($rel_path)"
          fi
        fi
      else
        echo "ℹ️  模块 $rel_path 无 E2E 测试目录，跳过"
      fi
      ;;
    *)
      echo "ℹ️  语言 '$lang' E2E 测试默认命令未定义 ($rel_path)，跳过"
      ;;
  esac
}

verify_test_result_files() {
  local result_file="$1"
  local files_key="$2"
  local missing=""

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ ! -f "$PROJECT_ROOT/$f" ]; then
      missing="${missing}
  - $f"
    fi
  done < <(jq -r --arg key "$files_key" '.[$key][]?' "$result_file" 2>/dev/null)

  if [ -n "$missing" ]; then
    fail "${files_key} 中的测试文件不存在:${missing}"
  fi
}

run_tests_by_modules() {
  local test_kind="$1"
  local count
  count=$(echo "$MODULES_JSON" | jq 'length')

  if [ "$count" -eq 0 ]; then
    echo "⚠️  未检测到项目模块，跳过${test_kind}测试"
    return 0
  fi

  local i=0
  while [ "$i" -lt "$count" ]; do
    local path lang
    path=$(echo "$MODULES_JSON" | jq -r ".[$i].path")
    lang=$(echo "$MODULES_JSON" | jq -r ".[$i].language")

    case "$test_kind" in
      unit) run_default_unit_test "$path" "$lang" ;;
      integration) run_default_integration_test "$path" "$lang" ;;
      e2e) run_default_e2e_test "$path" "$lang" ;;
    esac

    i=$((i + 1))
  done
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
  mkdir -p "$change_dir/.tmp"

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
  # 跨平台 sed（macOS/Linux 兼容）
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/CHANGE_NAME_PLACEHOLDER/$CHANGE/g" "$change_dir/.pipeline-state.json"
    sed -i '' "s/CREATED_AT_PLACEHOLDER/$now/g" "$change_dir/.pipeline-state.json"
  else
    sed -i "s/CHANGE_NAME_PLACEHOLDER/$CHANGE/g" "$change_dir/.pipeline-state.json"
    sed -i "s/CREATED_AT_PLACEHOLDER/$now/g" "$change_dir/.pipeline-state.json"
  fi

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

  # 6. WHEN/THEN 语义检查（每个 Scenario 至少 1 WHEN + 1 THEN）
  local bad_scenarios=""
  local current_scenario="" has_when=0 has_then=0

  while IFS= read -r line; do
    if [[ "$line" =~ ^####\ Scenario: ]]; then
      if [ -n "$current_scenario" ] && { [ "$has_when" -eq 0 ] || [ "$has_then" -eq 0 ]; }; then
        bad_scenarios="${bad_scenarios}\n  - ${current_scenario} (WHEN=${has_when}, THEN=${has_then})"
      fi
      current_scenario="${line#*Scenario: }"
      has_when=0; has_then=0
    fi
    [[ "$line" == *'**WHEN**'* ]] && ((has_when++)) || true
    [[ "$line" == *'**THEN**'* ]] && ((has_then++)) || true
  done < "$spec_file"

  if [ -n "$current_scenario" ] && { [ "$has_when" -eq 0 ] || [ "$has_then" -eq 0 ]; }; then
    bad_scenarios="${bad_scenarios}\n  - ${current_scenario} (WHEN=${has_when}, THEN=${has_then})"
  fi

  if [ -n "$bad_scenarios" ]; then
    fail "以下 Scenario 缺少 WHEN 或 THEN:${bad_scenarios}"
  fi
  pass "WHEN/THEN 语义检查通过 (每个 Scenario 至少 1 WHEN + 1 THEN)"

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

  # 10. Testable 字段校验
  local testable_count
  testable_count=$(grep -c '\*\*Testable\*\*:' "$tasks_file" || echo "0")

  if [ "$testable_count" -eq 0 ]; then
    echo "⚠️  Testable 标注缺失（向后兼容模式：缺失字段的任务将被视为 Testable: false）"
  elif [ "$testable_count" -gt 0 ] && [ "$testable_count" -lt "$task_count" ]; then
    local missing_testable_tasks
    missing_testable_tasks=$(awk '
      /^## / {
        if (in_task && !has_testable) missing = missing (missing ? ", " : "") prev_task
        prev_task = $2; gsub(/\..*/, "", prev_task)
        in_task = 1; has_testable = 0
      }
      /\*\*Testable\*\*:/ { has_testable = 1 }
      END {
        if (in_task && !has_testable) missing = missing (missing ? ", " : "") prev_task
        print missing
      }' "$tasks_file")
    echo "⚠️  Testable 标注不完整：任务=$task_count, Testable=$testable_count（缺失任务: $missing_testable_tasks；缺失字段的任务将被视为 Testable: false）"
  else
    pass "Testable 标注完整性检查通过 ($testable_count/$task_count)"
  fi

  # 11. 至少 1 个任务无依赖
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
  load_project_config

  local module_count
  module_count=$(echo "$MODULES_JSON" | jq 'length')

  if [ "$module_count" -eq 0 ]; then
    echo "⚠️  未检测到项目模块，跳过 build 命令"
  else
    local i=0
    while [ "$i" -lt "$module_count" ]; do
      local path lang
      path=$(echo "$MODULES_JSON" | jq -r ".[$i].path")
      lang=$(echo "$MODULES_JSON" | jq -r ".[$i].language")
      build_module "$path" "$lang"
      i=$((i + 1))
    done
    pass "模块 build 检查通过 ($module_count 个模块)"
  fi

  # Agent 产出 JSON 验证（task-result.json files_changed / files）
  if [ -n "$CHANGE" ]; then
    local task_result="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/task-result.json"
    if [ -f "$task_result" ]; then
      echo "正在验证 task-result.json 声明的文件..."
      local missing_files=""
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        if [ ! -f "$PROJECT_ROOT/$f" ]; then
          missing_files="${missing_files}
  - $f"
        fi
      done < <(jq -r '(.files_changed // .files // [])[]?' "$task_result" 2>/dev/null)

      if [ -n "$missing_files" ]; then
        fail "task-result.json 声明的文件不存在:${missing_files}"
      fi
      pass "task-result.json 文件验证通过"
    fi
  fi

  # 单元测试文件存在性检查（Testable=true 任务）
  local tasks_file="$PROJECT_ROOT/specline/changes/$CHANGE/tasks.md"
  if [ -f "$tasks_file" ]; then
    local testable_true_count
    testable_true_count=$(grep -c '\*\*Testable\*\*:.*true' "$tasks_file" || echo "0")

    if [ "$testable_true_count" -gt 0 ]; then
      echo "正在检查 $testable_true_count 个 Testable=true 任务的单元测试文件..."

      local missing_files=""
      local syntax_errors=""

      while IFS='|' read -r task_id file_path; do
        if [ -z "$file_path" ]; then
          missing_files="${missing_files}
  任务 $task_id: 未在 Files 列表中声明测试文件（支持 tests/unit/、tests/models/、*_test.go、*.test.ts 等）"
          continue
        fi

        if [ ! -f "$PROJECT_ROOT/$file_path" ]; then
          missing_files="${missing_files}
  任务 $task_id: $file_path"
          continue
        fi

        case "$file_path" in
          *.py)
            if ! python3 -m py_compile "$PROJECT_ROOT/$file_path" 2>&1; then
              syntax_errors="${syntax_errors}
  任务 $task_id: $file_path (Python 语法错误)"
            fi
            ;;
          *.ts|*.tsx)
            if ! npx tsc --noEmit "$PROJECT_ROOT/$file_path" 2>&1; then
              syntax_errors="${syntax_errors}
  任务 $task_id: $file_path (TypeScript 语法错误)"
            fi
            ;;
        esac
      done < <(awk '
        /^## / {
          task_id = $2; gsub(/\..*/, "", task_id)
          testable = ""; files_line = ""
        }
        /\*\*Testable\*\*:.*true/ { testable = "true" }
        /\*\*Files\*\*:/ {
          if (testable == "true") {
            files_line = $0
            gsub(/.*\*\*Files\*\*:[ \t]*/, "", files_line)
            split(files_line, paths, /,[ \t]*/)
            has_test = 0
            for (i in paths) {
              gsub(/^[ \t]+|[ \t]+$/, "", paths[i])
              if (paths[i] ~ /^tests\/(unit|models)\// ||
                  paths[i] ~ /_test\.go$/ ||
                  paths[i] ~ /\.test\.(ts|tsx|js|jsx)$/ ||
                  paths[i] ~ /\.spec\.(ts|tsx|js|jsx)$/ ||
                  paths[i] ~ /^src\/.*\/tests\.rs$/) {
                print task_id "|" paths[i]
                has_test = 1
              }
            }
            if (has_test == 0) {
              print task_id "|"
            }
          }
        }
      ' "$tasks_file")

      if [ -n "$missing_files" ]; then
        fail "单元测试文件缺失:${missing_files}"
      fi

      if [ -n "$syntax_errors" ]; then
        fail "单元测试文件语法错误:${syntax_errors}"
      fi

      pass "单元测试文件存在性检查通过"
    else
      echo "ℹ️  无 Testable=true 任务，跳过单元测试文件检查"
    fi
  fi

  write_gate_passed "phases.coding.gates.build_gate"
  pass "Build Gate 全部通过"
}

gate_lint() {
  load_project_config

  local module_count
  module_count=$(echo "$MODULES_JSON" | jq 'length')

  if [ "$module_count" -eq 0 ]; then
    echo "⚠️  未检测到项目模块，跳过 lint"
  else
    local i=0
    while [ "$i" -lt "$module_count" ]; do
      local path lang
      path=$(echo "$MODULES_JSON" | jq -r ".[$i].path")
      lang=$(echo "$MODULES_JSON" | jq -r ".[$i].language")
      lint_module "$path" "$lang"
      i=$((i + 1))
    done
    pass "模块 lint 检查通过 ($module_count 个模块)"
  fi

  # code-review.json error 计数（位于 change 的 .tmp/ 目录下）
  local review_file="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/code-review.json"
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
# 优先级：.pipeline-state.json > test-code-result.json > MODULES_JSON 推导 > 无兜底
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

  # 2. 从 test-code-result.json 读取
  if [ -z "$framework" ] && [ -n "$CHANGE" ]; then
    local test_result="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/test-code-result.json"
    if [ -f "$test_result" ]; then
      framework=$(jq -r '.test_framework // empty' "$test_result" 2>/dev/null)
      test_cmd=$(jq -r '.test_cmd // empty' "$test_result" 2>/dev/null)
    fi
  fi

  # 3. 从 MODULES_JSON 推导
  if [ -z "$framework" ]; then
    load_project_config
    local module_count
    module_count=$(echo "$MODULES_JSON" | jq 'length')
    if [ "$module_count" -gt 0 ]; then
      local lang
      lang=$(echo "$MODULES_JSON" | jq -r '.[0].language')
      case "$lang" in
        go) framework="go-test" ;;
        python) framework="pytest" ;;
        rust) framework="cargo-test" ;;
        java) framework="junit" ;;
        kotlin) framework="junit" ;;
        typescript|javascript)
          local mod_path
          mod_path=$(echo "$MODULES_JSON" | jq -r '.[0].path')
          local mod_dir
          mod_dir=$(module_absolute_path "$mod_path")
          if [ -f "$mod_dir/package.json" ]; then
            if grep -q '"vitest"' "$mod_dir/package.json" 2>/dev/null; then
              framework="vitest"
            elif grep -q '"jest"' "$mod_dir/package.json" 2>/dev/null; then
              framework="jest"
            elif grep -q '"mocha"' "$mod_dir/package.json" 2>/dev/null; then
              framework="mocha"
            fi
          fi
          ;;
      esac
    fi
  fi

  # 4. 无兜底 pytest — 检测失败时 framework 为空
  if [ -z "$framework" ]; then
    echo "⚠️  未检测到测试框架"
    return 0
  fi

  # 根据框架确定命令（test_cmd 可能已由 JSON 提供）
  if [ -z "$test_cmd" ]; then
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
        test_cmd="go test ./..."
        coverage_cmd="go test -cover ./..."
        ;;
      cargo-test)
        test_cmd="cargo test"
        coverage_cmd="cargo tarpaulin 2>/dev/null || cargo test"
        ;;
      junit)
        local mod_path mod_dir
        mod_path=$(echo "$MODULES_JSON" | jq -r '.[0].path // "."')
        mod_dir=$(module_absolute_path "$mod_path")
        if [ -f "$mod_dir/pom.xml" ]; then
          test_cmd="mvn test"
          coverage_cmd="mvn jacoco:report"
        else
          test_cmd="gradle test"
          coverage_cmd="gradle jacocoTestReport"
        fi
        ;;
      pytest)
        test_cmd="pytest"
        coverage_cmd="pytest --cov --cov-fail-under=80"
        ;;
      *)
        test_cmd=""
        coverage_cmd=""
        ;;
    esac
  fi

  if [ -n "$framework" ] && [ -n "$test_cmd" ]; then
    echo "检测到测试框架: $framework (命令: $test_cmd)"
  fi
}

gate_test_unit() {
  echo "正在执行单元测试..."
  load_project_config

  local test_result=""
  if [ -n "$CHANGE" ]; then
    test_result="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/test-code-result.json"
  fi

  if [ -n "$test_result" ] && [ -f "$test_result" ]; then
    local test_cmd
    test_cmd=$(jq -r '.test_cmd // empty' "$test_result" 2>/dev/null)

    verify_test_result_files "$test_result" "test_files"

    if [ -n "$test_cmd" ]; then
      echo "执行 Agent 声明的 test_cmd: $test_cmd"
      if ! (cd "$PROJECT_ROOT" && eval "$test_cmd"); then
        fail "单元测试失败"
      fi
    else
      echo "⚠️  test-code-result.json 无 test_cmd，回退到模块默认命令"
      run_tests_by_modules "unit"
    fi
  else
    local module_count
    module_count=$(echo "$MODULES_JSON" | jq 'length')
    if [ "$module_count" -eq 0 ]; then
      echo "⚠️  未检测到项目模块且无 test-code-result.json，跳过单元测试"
      write_gate_passed "phases.test.sub_phases.unit.gates.test_unit_gate"
      pass "单元测试已跳过"
      return 0
    fi
    run_tests_by_modules "unit"
  fi

  # 覆盖率检查（非阻塞）
  detect_test_framework
  if [ -n "${coverage_cmd:-}" ]; then
    echo "正在检查覆盖率..."
    if ! (cd "$PROJECT_ROOT" && eval "$coverage_cmd" 2>&1); then
      echo "⚠️  覆盖率检查未通过（不阻塞，由 test-runner agent 深入分析）"
    fi
  fi

  write_gate_passed "phases.test.sub_phases.unit.gates.test_unit_gate"
  pass "单元测试通过"
}

gate_test_integration() {
  echo "正在执行集成测试..."
  load_project_config

  local test_result=""
  if [ -n "$CHANGE" ]; then
    test_result="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/test-code-result.json"
  fi

  if [ -n "$test_result" ] && [ -f "$test_result" ]; then
    local test_cmd
    test_cmd=$(jq -r '.integration_test_cmd // empty' "$test_result" 2>/dev/null)

    if jq -e '.integration_test_files | length > 0' "$test_result" &>/dev/null; then
      verify_test_result_files "$test_result" "integration_test_files"
    fi

    if [ -n "$test_cmd" ]; then
      echo "执行 Agent 声明的 integration_test_cmd: $test_cmd"
      if ! (cd "$PROJECT_ROOT" && eval "$test_cmd"); then
        fail "集成测试失败"
      fi
    else
      run_tests_by_modules "integration"
    fi
  else
    local module_count
    module_count=$(echo "$MODULES_JSON" | jq 'length')
    if [ "$module_count" -eq 0 ]; then
      echo "⚠️  未检测到项目模块且无 test-code-result.json，跳过集成测试"
    else
      run_tests_by_modules "integration"
    fi
  fi

  write_gate_passed "phases.test.sub_phases.integration.gates.test_integration_gate"
  pass "集成测试通过"
}

gate_test_e2e() {
  echo "正在执行 E2E 测试..."
  load_project_config

  local test_result=""
  if [ -n "$CHANGE" ]; then
    test_result="$PROJECT_ROOT/specline/changes/$CHANGE/.tmp/test-code-result.json"
  fi

  if [ -n "$test_result" ] && [ -f "$test_result" ]; then
    local test_cmd
    test_cmd=$(jq -r '.e2e_test_cmd // empty' "$test_result" 2>/dev/null)

    if jq -e '.e2e_test_files | length > 0' "$test_result" &>/dev/null; then
      verify_test_result_files "$test_result" "e2e_test_files"
    fi

    if [ -n "$test_cmd" ]; then
      echo "执行 Agent 声明的 e2e_test_cmd: $test_cmd"
      if ! (cd "$PROJECT_ROOT" && eval "$test_cmd"); then
        fail "E2E 测试失败"
      fi
    else
      run_tests_by_modules "e2e"
    fi
  else
    local module_count
    module_count=$(echo "$MODULES_JSON" | jq 'length')
    if [ "$module_count" -eq 0 ]; then
      echo "⚠️  未检测到项目模块且无 test-code-result.json，跳过 E2E 测试"
    else
      run_tests_by_modules "e2e"
    fi
  fi

  write_gate_passed "phases.test.sub_phases.e2e.gates.test_e2e_gate"
  pass "E2E 测试通过"
}

gate_archive() {
  if [ -z "$CHANGE" ]; then
    fail "需要 --change <name>"
  fi

  # 如果传了 --execute，执行实际归档动作
  if [ -n "$EXECUTE_ARCHIVE" ]; then
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

    # 临时文件（.tmp/）随 change 目录一起归档，无需单独清理

    # 更新状态文件
    if [ -f "$dest/.pipeline-state.json" ]; then
      local now
      now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
      # macOS sed 兼容
      sed -i '' "s/\"current_phase\": \"[^\"]*\"/\"current_phase\": \"archived\"/g" "$dest/.pipeline-state.json" 2>/dev/null || true
    fi

    # 清理所有绑定到该 change 的 session
    local bindings_file="$PROJECT_ROOT/specline/.pipeline-sessions.json"
    if [ -f "$bindings_file" ]; then
      jq --arg change "$CHANGE" \
        'with_entries(select(.value.change != $change))' \
        "$bindings_file" > "${bindings_file}.tmp" && mv "${bindings_file}.tmp" "$bindings_file"
      echo "✅ 已清理 pipeline '$CHANGE' 的所有 session 绑定"
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

gate_bind() {
  local session_id="$1"
  local target_change="$2"

  if [ -z "$session_id" ] || [ -z "$target_change" ]; then
    fail "需要 <session_id> <change_name>"
  fi

  local state_file="$PROJECT_ROOT/specline/changes/$target_change/.pipeline-state.json"
  if [ ! -f "$state_file" ]; then
    fail "Change '$target_change' 不存在"
  fi

  local bindings_file="$PROJECT_ROOT/specline/.pipeline-sessions.json"
  [ ! -f "$bindings_file" ] && echo '{}' > "$bindings_file"

  local now
  now=$(now_iso8601)
  jq --arg sid "$session_id" --arg change "$target_change" --arg time "$now" \
    '.[$sid] = {"change": $change, "bound_at": $time}' \
    "$bindings_file" > "${bindings_file}.tmp" && mv "${bindings_file}.tmp" "$bindings_file"

  echo "✅ 已绑定 session '$session_id' → pipeline '$target_change'"
}

# ===== Semantic Gate — 跨文件语义检查 =====
gate_semantic() {
  if [ -z "$CHANGE" ]; then
    fail "需要 --change <name>"
  fi

  # 定位 spec.md 和 tasks.md
  local spec_file tasks_file
  spec_file=$(find_spec_file)
  tasks_file="$PROJECT_ROOT/specline/changes/$CHANGE/tasks.md"

  if [ ! -f "$spec_file" ] || [ ! -f "$tasks_file" ]; then
    fail "spec.md 或 tasks.md 不存在，无法执行语义检查"
  fi

  local checks_dir="$SCRIPT_DIR/pipeline-gate-checks"
  local common_sh="$checks_dir/common.sh"

  if [ ! -f "$common_sh" ]; then
    fail "common.sh 不存在: $common_sh"
  fi

  # source common.sh 初始化计数器
  source "$common_sh"

  # 设定文件路径环境变量，供各检查脚本使用
  export SPEC_FILE="$spec_file"
  export TASKS_FILE="$tasks_file"

  # 依次执行 6 项语义检查
  local check_scripts=(
    "a1-covers-ref.sh"
    "d1-cycle.sh"
    "c1-exception.sh"
    "c2-vague.sh"
    "a2-a3-reverse.sh"
    "d3-type-file.sh"
  )

  local check_functions=(
    "run_a1_covers_ref"
    "run_d1_cycle"
    "run_c1_exception"
    "run_c2_vague"
    "run_a2_a3_reverse"
    "run_d3_type_file"
  )

  local i=0
  for script in "${check_scripts[@]}"; do
    local script_path="$checks_dir/$script"
    if [ -f "$script_path" ]; then
      source "$script_path"
      if declare -f "${check_functions[$i]}" > /dev/null 2>&1; then
        "${check_functions[$i]}"
      fi
    else
      echo "⚠️  检查脚本不存在，跳过: $script"
    fi
    i=$((i + 1))
  done

  # 汇总结果
  local total_issues=$((SEMANTIC_ERRORS + SEMANTIC_WARNINGS + SEMANTIC_INFOS))

  echo ""
  echo "========== Semantic Gate 汇总 =========="
  echo "  ❌ 错误:   $SEMANTIC_ERRORS"
  echo "  ⚠️  警告:  $SEMANTIC_WARNINGS"
  echo "  ℹ️  信息:  $SEMANTIC_INFOS"
  echo "  总计:      $total_issues"
  echo "========================================="

  if [ "$SEMANTIC_ERRORS" -gt 0 ]; then
    echo ""
    echo "❌ Semantic Gate 未通过：发现 $SEMANTIC_ERRORS 个错误"
    exit 1
  fi

  write_gate_passed "phases.spec.gates.semantic_gate"
  pass "✅ Semantic Gate 全部通过"
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
  semantic)
    gate_semantic "$@"
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
  bind)
    gate_bind "${POSITIONAL_ARGS[0]:-}" "${POSITIONAL_ARGS[1]:-}"
    ;;
  detect-modules)
    load_project_config
    echo "$MODULES_JSON"
    ;;
  archive)
    gate_archive "$@"
    ;; 
  status)
    gate_status
    ;;
  *)
    echo "未知 phase: $PHASE"
    echo "可用: new | list | artifacts | spec | semantic | build | lint | test-unit | test-integration | test-e2e | detect-modules | bind | archive | status"
    exit 2
    ;;
esac

exit 0
