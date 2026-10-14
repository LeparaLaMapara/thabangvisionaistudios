#!/usr/bin/env bash
# iOS simulator smoke test, run from mobile/ on a macOS runner after the
# simulator build. Boots an iPhone simulator, installs and launches the app,
# waits for the site to load, checks the app process is alive, and saves a
# screenshot and the app's log lines to smoke-ios/.
set -uo pipefail
APP_ID="${APP_ID:-com.thabangvision.app}"
OUT=smoke-ios
mkdir -p "$OUT"
APP=$(find ios/App/build/Build/Products/Debug-iphonesimulator -maxdepth 1 -name '*.app' | head -1)
if [ -z "$APP" ]; then echo "FAIL: no .app built"; exit 1; fi

DEVICE=$(xcrun simctl list devices available -j | python3 -c "
import json,sys
d=json.load(sys.stdin)['devices']
phones=[x for k,v in d.items() if 'iOS' in k for x in v if x['name'].startswith('iPhone')]
print(phones[-1]['udid'] if phones else '')")
if [ -z "$DEVICE" ]; then echo "FAIL: no iPhone simulator available"; exit 1; fi
xcrun simctl list devices | grep "$DEVICE" | tee "$OUT/device.txt"

xcrun simctl boot "$DEVICE" || true
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$APP"
xcrun simctl launch "$DEVICE" "$APP_ID" | tee "$OUT/launch.txt"
sleep 25

xcrun simctl io "$DEVICE" screenshot "$OUT/launch.png"
xcrun simctl spawn "$DEVICE" log show --last 2m --predicate "process == \"App\"" > "$OUT/app-log.txt" 2>/dev/null || true
RUNNING=$(xcrun simctl spawn "$DEVICE" launchctl list | grep -c "$APP_ID" || true)

echo "running: $RUNNING"
if [ "$RUNNING" = "0" ]; then echo "FAIL: app is not running after launch"; exit 1; fi
echo "PASS: installed, launched, still running"
