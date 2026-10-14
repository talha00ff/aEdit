#!/bin/bash
# Downloads ffmpeg for macOS (Apple Silicon or Intel) into <dest>/bin/ffmpeg
DEST="${1:-$HOME/Library/Application Support/aEdit}"
mkdir -p "$DEST/bin"
case "$(uname -m)" in
  arm64) URLS=("https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip") ;;
  *)     URLS=("https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip"
               "https://evermeet.cx/ffmpeg/getrelease/zip") ;;
esac
TMP="$(mktemp -d)"
for U in "${URLS[@]}"; do
  echo "  Downloading ffmpeg from $U ..."
  if curl -fsSL "$U" -o "$TMP/ffmpeg.zip" && unzip -oq "$TMP/ffmpeg.zip" -d "$TMP/x"; then
    F="$(find "$TMP/x" -type f -name ffmpeg | head -1)"
    if [ -n "$F" ]; then
      cp "$F" "$DEST/bin/ffmpeg" && chmod +x "$DEST/bin/ffmpeg"
      xattr -d com.apple.quarantine "$DEST/bin/ffmpeg" 2>/dev/null
      rm -rf "$TMP"
      echo "  ffmpeg installed."
      exit 0
    fi
  fi
  echo "  Failed, trying next source..."
done
rm -rf "$TMP"
exit 1
