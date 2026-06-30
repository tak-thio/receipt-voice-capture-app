#!/usr/bin/env bash
# Fetch the coraza base config + OWASP Core Rule Set into ../coraza so the
# Coraza WAF (see Caddyfile.prod) can Include them as real files. Re-runnable.
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)/coraza"
mkdir -p "$DEST/crs"

# coraza recommended base config (engine + request/response body access).
curl -fsSL https://raw.githubusercontent.com/corazawaf/coraza/main/coraza.conf-recommended \
  -o "$DEST/coraza.conf"

# OWASP CRS — main branch tarball (no GitHub API; avoids unauth rate limits).
# Pin to a release tag here if you prefer: .../archive/refs/tags/vX.Y.Z.tar.gz
CRS_REF="${CRS_REF:-main}"
curl -fsSL "https://github.com/coreruleset/coreruleset/archive/refs/heads/${CRS_REF}.tar.gz" -o /tmp/crs.tgz
rm -rf /tmp/crs-extract && mkdir -p /tmp/crs-extract
tar xzf /tmp/crs.tgz -C /tmp/crs-extract
SRC="$(ls -d /tmp/crs-extract/coreruleset-*/)"
cp "${SRC}crs-setup.conf.example" "$DEST/crs/crs-setup.conf"
rm -rf "$DEST/crs/rules" && cp -r "${SRC}rules" "$DEST/crs/rules"
echo "CRS (${CRS_REF}) installed -> $DEST  (rule files: $(ls "$DEST"/crs/rules/*.conf | wc -l))"
