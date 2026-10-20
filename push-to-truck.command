#!/bin/bash
# ============================================================================
#  push-to-truck.command  —  build the standalone (release) APK and install it
#  on the Tacoma head unit. Double-click in Finder, or run from a terminal.
#
#  What it does:
#    1. Builds a RELEASE apk (JS bundled in — runs with NO laptop/Metro).
#    2. Finds the head unit, collapsing the duplicate transport listing
#       (the unit shows up twice: TCP + TLS) down to one physical device.
#    3. adb install -r  (keeps app data; same debug-key signing).
#    4. Relaunches the app.
#
#  Flags:
#    --install-only   skip the build, just reinstall the last-built APK (fast)
#    --no-launch      don't relaunch the app after installing
# ============================================================================

set -u
PROJ="/Users/benjaminweininger/Desktop/2TR-FE/2TR-FE"
PKG="com.benji.tacomadash"
APK="$PROJ/android/app/build/outputs/apk/release/app-release.apk"

export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"

BUILD=1
LAUNCH=1
for a in "$@"; do
  case "$a" in
    --install-only) BUILD=0 ;;
    --no-launch)    LAUNCH=0 ;;
  esac
done

bar() { printf '\n\033[1;33m== %s ==\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; echo; echo "Press any key to close…"; read -n 1 -s; exit 1; }

cd "$PROJ" || die "Project not found: $PROJ"

# --- 1. build ----------------------------------------------------------------
if [ "$BUILD" = "1" ]; then
  bar "Building release APK (this takes a few minutes)"
  ( cd "$PROJ/android" && ./gradlew assembleRelease --console=plain ) || die "Gradle build failed (see output above)."
else
  bar "Skipping build (--install-only)"
fi
[ -f "$APK" ] || die "APK not found: $APK"
printf '   APK: %s  (%s)\n' "$APK" "$(du -h "$APK" | cut -f1)"

# --- 2. pick the device, collapsing duplicate transports ---------------------
bar "Finding the head unit"
"$ADB" start-server >/dev/null 2>&1

# Optional: auto-(re)connect to a known wireless address. Set TRUCK_ADDR below
# (e.g. "192.168.0.50:5555") once you've given the unit a stable tcpip port, and
# the walk-up-to-the-house flow becomes truly one-click.
TRUCK_ADDR="${TRUCK_ADDR:-}"
[ -n "$TRUCK_ADDR" ] && "$ADB" connect "$TRUCK_ADDR" >/dev/null 2>&1

# Self-heal a stale adb server (the "No route to host while ping works" trap):
# if nothing's attached, restart the daemon and retry the connect once.
if [ -z "$("$ADB" devices | awk 'NR>1 && $2=="device"{print}')" ]; then
  echo "   no device yet — restarting adb server…"
  "$ADB" kill-server >/dev/null 2>&1; "$ADB" start-server >/dev/null 2>&1
  [ -n "$TRUCK_ADDR" ] && "$ADB" connect "$TRUCK_ADDR" >/dev/null 2>&1
fi

# Online devices (state == "device"), deduped by hardware serial (ro.serialno),
# so the unit's two transports (TCP + TLS mDNS) count as ONE physical device.
SEEN=""
IDS=()       # chosen transport id per physical device
LABELS=()    # human label per physical device
while read -r dev; do
  [ -z "$dev" ] && continue
  hw="$("$ADB" -s "$dev" shell getprop ro.serialno 2>/dev/null | tr -d '\r')"
  [ -z "$hw" ] && hw="$dev"          # fall back to transport id if no serial
  case " $SEEN " in *" $hw "*) continue ;; esac
  SEEN="$SEEN $hw"
  model="$("$ADB" -s "$dev" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
  IDS+=("$dev")
  LABELS+=("$dev  ($model, serial $hw)")
done < <("$ADB" devices | awk 'NR>1 && $2=="device"{print $1}')

N=${#IDS[@]}
if [ "$N" -eq 0 ]; then
  die "No device. On the unit: Factory Settings → type 'adbon' → enable USB debugging. Then plug in USB, or:  $ADB connect <unit-ip>:<port>"
elif [ "$N" -eq 1 ]; then
  TARGET="${IDS[0]}"
  echo "   ${LABELS[0]}"
else
  echo "   Multiple devices:"
  i=1; for l in "${LABELS[@]}"; do echo "     [$i] $l"; i=$((i+1)); done
  printf "   Select [1-%d]: " "$N"; read sel
  TARGET="${IDS[$((sel-1))]:-}"
  [ -z "$TARGET" ] && die "Invalid selection."
fi
echo "   → target: $TARGET"

# --- 3. install --------------------------------------------------------------
bar "Installing"
"$ADB" -s "$TARGET" install -r "$APK" || die "Install failed. If it mentions signatures:  $ADB -s $TARGET uninstall $PKG  then re-run."

# --- 3b. make it the HOME launcher (Phase A) ---------------------------------
# Idempotent: every "home" press + boot now lands on the dashboard. The stock
# launcher stays installed as a fallback; to revert, point set-home-activity back
# at it (com.telenav.scout.launcher on this unit).
bar "Setting as default HOME launcher"
"$ADB" -s "$TARGET" shell cmd package set-home-activity "$PKG/.MainActivity" 2>&1 | tail -1

# --- 4. launch ---------------------------------------------------------------
if [ "$LAUNCH" = "1" ]; then
  bar "Launching"
  "$ADB" -s "$TARGET" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

printf '\n\033[1;32m✓ Done — Tacoma Dash updated on the unit.\033[0m\n'
echo; echo "Press any key to close…"; read -n 1 -s
