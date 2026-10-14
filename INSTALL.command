#!/bin/bash
# aEdit by talha0ff - macOS installer
cd "$(dirname "$0")"
echo ""
echo " aEdit by talha0ff - installer (macOS)"
echo " -------------------------------------"
echo " Quit Premiere Pro before continuing."
read -p " Press Return to continue..."

# allow unsigned CEP panels (Premiere 2020 - 2026)
for v in 9 10 11 12 13 14; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/aEdit"
USERDIR="$HOME/Library/Application Support/aEdit"
echo " Copying files..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R aEdit/ "$DEST/" || { echo " ERROR: copy failed."; read -p " Press Return to close..."; exit 1; }
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null

# ffmpeg: keep an existing one (Homebrew or earlier install), otherwise download it
if [ -x "$USERDIR/bin/ffmpeg" ] || [ -x /opt/homebrew/bin/ffmpeg ] || [ -x /usr/local/bin/ffmpeg ]; then
  echo " ffmpeg found."
else
  echo " Downloading ffmpeg (needed for Pose Cut, Beat Marker, Beat Edit)..."
  bash "$DEST/bin/get-ffmpeg.sh" "$USERDIR" || echo " WARNING: ffmpeg could not be downloaded. The panel will offer to download it again."
fi

echo ""
echo " Done! Open Premiere Pro, then: Window > Extensions > aEdit"
read -p " Press Return to close..."
