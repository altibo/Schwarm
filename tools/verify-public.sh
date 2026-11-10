#!/usr/bin/env bash
# Public check: every built asset is served (200, byte-identical), then the full Playwright suite runs against the live URL.
set -euo pipefail
B="${1:-https://altibo.github.io/Schwarm}"
cd "$(dirname "$0")/.." && npm run build >/dev/null
bad=0; n=0
while IFS= read -r f; do
  n=$((n+1)); c=$(curl -s -o /tmp/schwarm-asset -w '%{http_code}' "$B/$f")
  if [ "$c" != 200 ] || ! cmp -s /tmp/schwarm-asset "dist/$f"; then echo "BAD $c $f"; bad=$((bad+1)); fi
done < <(cd dist && find . -type f | sed 's|^\./||')
echo "assets: $n checked, $bad bad"; [ "$bad" = 0 ]
SCHWARM_URL="$B/" npx playwright test
