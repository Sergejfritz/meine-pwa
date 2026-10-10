#!/usr/bin/env bash
# Baut die signierte Lotto-App und legt sie unter downloads/lotto.apk ab
# (von dort lädt man sie aufs Handy: https://sergejfritz.github.io/meine-pwa/downloads/lotto.apk).
#
#   LOTTO_KEY_PASSWORD=… scripts/lotto-apk.sh
#
# Voraussetzungen: JDK 17+, Android-SDK (ANDROID_HOME oder android/local.properties).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${LOTTO_KEY_PASSWORD:-}" ]; then
  echo "LOTTO_KEY_PASSWORD fehlt (Passwort des Schlüssels android/lotto-app.p12)." >&2
  exit 1
fi
(cd android && ./gradlew --no-daemon -q assembleRelease)
mkdir -p downloads
cp android/app/build/outputs/apk/release/app-release.apk downloads/lotto.apk
echo "✓ downloads/lotto.apk ($(du -h downloads/lotto.apk | cut -f1))"
