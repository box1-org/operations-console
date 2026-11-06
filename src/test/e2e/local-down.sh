#!/bin/sh
# Stops only what local-up.sh started (by recorded PID and container name).
set -u
: "${RUN_DIR:?set RUN_DIR}"
for f in console stubs; do [ -f "$RUN_DIR/$f.pid" ] && kill "$(cat "$RUN_DIR/$f.pid")" 2>/dev/null; rm -f "$RUN_DIR/$f.pid"; done
podman rm -f run18-keycloak >/dev/null 2>&1 || true
echo "run18 local stack down"
