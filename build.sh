#!/usr/bin/env bash
# One-command build + test of every deliverable.
set -euo pipefail
cd "$(dirname "$0")"
python3 src/generate_data.py
node src/build_engine.js
node tests/test_engine.js
node src/build_section.js
node tests/test_powerquery.js
python3 src/build_workbook.py
python3 "${RECALC:-/root/.claude/skills/synced/e2bc7bf3-9e73-419a-b580-77f13cb4df9f_dd645976-27d6-45b5-9fc7-b25f0020f627/xlsx/scripts/recalc.py}" build/MasterDataQuality.xlsx 180
python3 src/inject_powerquery.py
node tests/test_workbook_package.js
node src/build_office_script.js
npx tsc --noEmit --strict --target es2017 --lib es2017 tests/excelscript.d.ts automation/RunQualityChecks.ts
node tests/test_office_script.js
node src/build_flow.js
node tests/test_flow.js
node src/build_web.js
node tests/test_web.js
echo "ALL BUILDS AND TESTS PASSED"
