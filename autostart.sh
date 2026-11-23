#!/bin/sh
# Registers the bridge server as a macOS LaunchAgent so it starts at login and restarts if it crashes.
# Usage: ./autostart.sh            install (re-run after moving the folder or changing PERMISSION_MODE)
#        ./autostart.sh uninstall  remove
set -e

LABEL=com.claude-web-bridge
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/claude-web-bridge.log"
PROJECT_DIR=$(cd "$(dirname "$0")" && pwd)

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

if [ "$1" = "uninstall" ]; then
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

NODE_BIN=$(command -v node)
CLAUDE_BIN=$(command -v claude)
# launchd starts with a minimal PATH, so bake in where node and claude live.
SERVICE_PATH="$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROJECT_DIR/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$SERVICE_PATH</string>
    <key>PERMISSION_MODE</key><string>${PERMISSION_MODE:-acceptEdits}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL (log: $LOG)"
