#!/usr/bin/env sh
# Replace the OWNER/REPO placeholder with the real GitHub repository, e.g.:
#   scripts/set-owner.sh sensorpro sensorpro-cursor-plugin
set -eu
if [ $# -ne 2 ]; then
  echo "usage: $0 <github-owner> <repo-name>" >&2
  exit 1
fi
owner=$1
repo=$2
case "$owner$repo" in
  *[!A-Za-z0-9._-]*) echo "owner and repo may only contain letters, digits, '.', '_' and '-'" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
files="mcp.json .cursor-plugin/plugin.json package.json server/package.json README.md server/README.md CHANGELOG.md"
for f in $files; do
  [ -f "$f" ] || continue
  sed "s#OWNER/REPO#$owner/$repo#g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
echo "Set repository to $owner/$repo in: $files"
if grep -rn "OWNER/REPO" $files 2>/dev/null; then
  echo "WARNING: placeholders remain (see above)" >&2
  exit 1
fi
