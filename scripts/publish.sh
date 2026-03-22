#!/usr/bin/env bash
# publish.sh — publish both ClawVitals and SecurityVitals from a single source
#
# Usage:
#   ./scripts/publish.sh <version> "<changelog>"
#
# Both skills are built from skill/SKILL.md.
# Only the name, description, and tags differ in the published metadata.
# skill.json version is updated automatically.

set -e

VERSION=$1
CHANGELOG=$2

if [ -z "$VERSION" ] || [ -z "$CHANGELOG" ]; then
  echo "Usage: ./scripts/publish.sh <version> \"<changelog>\""
  exit 1
fi

SKILL_DIR="$(cd "$(dirname "$0")/.." SKILL_DIR="$(dirname "$0")/../skill"SKILL_DIR="$(dirname "$0")/../skill" pwd)/skill"

# Update skill.json version
python3 -c "
import json, sys
path = '$SKILL_DIR/skill.json'
with open(path) as f: s = json.load(f)
s['version'] = '$VERSION'
with open(path, 'w') as f: json.dump(s, f, indent=2)
print('Updated skill.json to v$VERSION')
"

# --- Publish ClawVitals ---
echo ""
echo "Publishing clawvitals@$VERSION..."
npx clawhub@latest publish "$SKILL_DIR" \
  --slug clawvitals \
  --name "ClawVitals" \
  --version "$VERSION" \
  --changelog "$CHANGELOG"

# --- Build SecurityVitals variant ---
# Create a temp dir with patched SKILL.md + skill.json
TMPDIR=$(mktemp -d)
cp -r "$SKILL_DIR"/* "$TMPDIR"/

# Patch SKILL.md frontmatter: name and description
python3 << EOF
import re

with open('$TMPDIR/SKILL.md') as f:
    md = f.read()

md = md.replace(
    'name: clawvitals',
    'name: securityvitals'
)
md = md.replace(
    'description: Security vitals checker for OpenClaw. Scans your installation, scores your setup, and shows you exactly what to fix. First scan in seconds.',
    'description: Security vitals checker, also known as ClawVitals. Scans your installation, scores your setup, and shows you exactly what to fix. First scan in seconds.'
)
md = md.replace(
    'homepage: https://clawvitals.io',
    'homepage: https://clawvitals.io'
)

with open('$TMPDIR/SKILL.md', 'w') as f:
    f.write(md)

print('Patched SKILL.md for securityvitals')
EOF

# Patch skill.json: name, description, tags
python3 << EOF
import json

with open('$TMPDIR/skill.json') as f: s = json.load(f)
s['name'] = 'securityvitals'
s['displayName'] = 'SecurityVitals'
s['description'] = 'Security vitals checker, also known as ClawVitals. Scans your installation, scores your setup, and shows you exactly what to fix. First scan in seconds.'
s['tags'] = ['security', 'audit', 'health-check', 'openclaw', 'monitoring', 'vitals', 'security-vitals']
with open('$TMPDIR/skill.json', 'w') as f: json.dump(s, f, indent=2)
print('Patched skill.json for securityvitals')
EOF

echo ""
echo "Publishing securityvitals@$VERSION..."
npx clawhub@latest publish "$TMPDIR" \
  --slug securityvitals \
  --name "SecurityVitals" \
  --version "$VERSION" \
  --fork-of "clawvitals" \
  --changelog "$CHANGELOG"

rm -rf "$TMPDIR"

echo ""
echo "✅ Published clawvitals@$VERSION and securityvitals@$VERSION"
