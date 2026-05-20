#!/usr/bin/env bash
set -euo pipefail
BUNDLE_ID="com.seedance.studio"
case "$(uname -s)" in
    Darwin*) DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE_ID" ;;
    Linux*)  DEST="$HOME/.adobe/CEP/extensions/$BUNDLE_ID" ;;
    *)       echo "Use uninstall.bat on Windows." >&2; exit 1 ;;
esac

echo "Removing $DEST ..."
if [ -d "$DEST" ]; then
    rm -rf "$DEST"
    echo "Done."
else
    echo "Nothing to remove — extension is not installed."
fi
