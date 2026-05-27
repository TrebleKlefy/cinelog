#!/usr/bin/env bash
# Generate Vitest coverage for backend + UI and copy HTML reports into submission/coverage-reports/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/submission/coverage-reports"
STAMP="$(date -u +"%Y-%m-%dT%H%M%SZ")"

echo "==> Backend coverage"
(cd "$ROOT/backend" && npm run test:coverage)

echo "==> UI coverage"
(cd "$ROOT/ui" && npm run test:coverage)

rm -rf "$OUT"
mkdir -p "$OUT/backend" "$OUT/ui"

cp -R "$ROOT/backend/coverage/." "$OUT/backend/"
cp -R "$ROOT/ui/coverage/." "$OUT/ui/"

cat > "$OUT/README.txt" <<EOF
cineLog coverage reports (generated ${STAMP} UTC)

Open in a browser:
  - backend/index.html  — API / services coverage (full src/**/*.ts scope)
  - ui/index.html       — UI coverage (movieDisplay + ConfirmDialog scoped slice)

Regenerate:
  bash scripts/package-coverage-reports.sh

Source folders (gitignored):
  - backend/coverage/
  - ui/coverage/
EOF

echo ""
echo "Done. Submission-ready reports:"
echo "  $OUT/backend/index.html"
echo "  $OUT/ui/index.html"
echo "  $OUT/README.txt"
