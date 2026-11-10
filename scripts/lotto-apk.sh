#!/usr/bin/env bash
# Baut die signierte Lotto-App nach build/lotto.apk (nicht im Repo – die App ist
# privat und wird nur als Datei weitergegeben, nirgends zum Download angeboten).
#
#   LOTTO_KEY_PASSWORD=… scripts/lotto-apk.sh [Zieldatei]
#
# Voraussetzungen: JDK 17+, Android-SDK (ANDROID_HOME oder android/local.properties).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${LOTTO_KEY_PASSWORD:-}" ]; then
  echo "LOTTO_KEY_PASSWORD fehlt (Passwort des Schlüssels android/lotto-app.p12)." >&2
  exit 1
fi
ziel="${1:-build/lotto.apk}"
(cd android && ./gradlew --no-daemon -q assembleRelease)
mkdir -p "$(dirname "$ziel")"
cp android/app/build/outputs/apk/release/app-release.apk "$ziel"
node -e '
const m = require("./android/app/build/outputs/apk/release/output-metadata.json").elements[0];
console.log("✓ Version " + m.versionName + " (" + m.versionCode + ")");
'
echo "✓ $ziel ($(du -h "$ziel" | cut -f1))"
