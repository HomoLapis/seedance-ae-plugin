#!/usr/bin/env bash
# Rebuild the React UI bundle into ../client/assets/.
# Run after editing anything in frontend-src/.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/../frontend-src"

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Building CEP bundle into ../client/assets/ ..."
BUILD_TARGET=cep npm run build:cep
echo "Done. Re-run install.sh to push to the AE extensions folder."
