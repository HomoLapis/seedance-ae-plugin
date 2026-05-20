#!/usr/bin/env bash
# Seedance Studio — AE Plugin Installer (macOS / Linux dev)
#
# Installs the CEP extension into the per-user Adobe extensions folder
# and enables PlayerDebugMode on CSXS 8–12 (required for unsigned panels).
#
# macOS:   ~/Library/Application Support/Adobe/CEP/extensions/com.seedance.studio
# Linux:   used only for local dev/inspection; AE doesn't run on Linux.

set -euo pipefail

BUNDLE_ID="com.seedance.studio"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "============================================"
echo "  Seedance Studio - AE Plugin Installer"
echo "  $(uname -s)"
echo "============================================"
echo

# --- [1/3] Resolve install path & enable CEP debug mode ----------------------
case "$(uname -s)" in
    Darwin*)
        DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE_ID"
        echo "[1/3] Enabling CEP debug mode (CSXS 8-12)..."
        for v in 8 9 10 11 12; do
            defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 >/dev/null 2>&1 || true
        done
        echo "      Debug mode enabled."
        ;;
    Linux*)
        DEST="$HOME/.adobe/CEP/extensions/$BUNDLE_ID"
        echo "[1/3] Linux detected — AE doesn't run here, but copying files anyway"
        echo "      (useful for inspecting the bundle from a dev box)."
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "  Detected Windows-like shell. Please run install.bat instead." >&2
        exit 1
        ;;
    *)
        echo "  Unsupported OS: $(uname -s)" >&2
        exit 1
        ;;
esac

# --- [2/3] Copy bundle -------------------------------------------------------
echo
echo "[2/3] Installing extension..."
if [ -d "$DEST" ]; then
    echo "      Removing previous installation..."
    rm -rf "$DEST"
fi
mkdir -p "$DEST"
cp -R "$SCRIPT_DIR/CSXS"                "$DEST/"
cp -R "$SCRIPT_DIR/client"              "$DEST/"
cp -R "$SCRIPT_DIR/client-storyboarder" "$DEST/"
cp -R "$SCRIPT_DIR/host"                "$DEST/"
echo "      Extension installed to:"
echo "      $DEST"

# --- [3/3] Sanity-check ------------------------------------------------------
echo
echo "[3/3] Verifying installation..."
ok=1
for f in \
    "$DEST/CSXS/manifest.xml" \
    "$DEST/client/index.html" \
    "$DEST/client/assets/index.js" \
    "$DEST/host/index.jsx"
do
    if [ ! -f "$f" ]; then
        echo "      MISSING: $f"
        ok=0
    fi
done

if [ "$ok" -eq 0 ]; then
    echo
    echo "  Installation INCOMPLETE - see missing files above."
    exit 1
fi
echo "      All required files present."

cat <<'EOF'

============================================
  Done.

  1. Open or restart After Effects
  2. Window > Extensions > Seedance Studio
                        > Storyboarder
  3. Click Settings, paste your API keys
     (BytePlus ARK + optional Z.AI/FAL/Alibaba)

  No backend, no Python. Just keys.
============================================
EOF
