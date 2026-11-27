#!/usr/bin/env bash
# Builds Showtrove-Setup-<version>.exe on Linux (no Wine needed).
# Needs: makensis (apt install nsis) and the resedit tool in ../rtool (npm i resedit pe-library).
# On Windows, just run: npm run dist
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
rm -rf dist
npx electron-builder --win dir --x64 -c.win.signAndEditExecutable=false
python3 -c "from PIL import Image; Image.open('build/icon.png').save('build/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
node "${RESEDIT_TOOL:-../rtool/seticon.mjs}" dist/win-unpacked/Showtrove.exe build/icon.ico "$VERSION"
makensis -V2 -DVERSION="$VERSION" -DSRC="$PWD/dist/win-unpacked" -DOUT="$PWD/dist/Showtrove-Setup-$VERSION.exe" build/installer.nsi
echo "Built dist/Showtrove-Setup-$VERSION.exe"
