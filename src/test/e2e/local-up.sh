#!/bin/sh
# Starts the local e2e stack: Keycloak (container run18-keycloak), upstream stubs and the built console.
# Usage: RUN_DIR=<private dir> src/test/e2e/local-up.sh   (needs: podman, node 24, a built target/quarkus-app)
# Test passwords are random per run, written only to $RUN_DIR (mode 600), never to Git.
set -eu
: "${RUN_DIR:?set RUN_DIR to a private scratch directory}"
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
mkdir -p "$RUN_DIR/import"; umask 077
PASSWORD=$(openssl rand -hex 16); ADMIN=$(openssl rand -hex 16)
printf '%s' "$PASSWORD" > "$RUN_DIR/user-password"
sed "s/__PASSWORD__/$PASSWORD/g" "$HERE/keycloak/realm.template.json" > "$RUN_DIR/import/box1-realm.json"
chmod 644 "$RUN_DIR/import/box1-realm.json"
podman rm -f run18-keycloak >/dev/null 2>&1 || true
podman run -d --name run18-keycloak -p 127.0.0.1:18280:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD="$ADMIN" \
  -v "$RUN_DIR/import:/opt/keycloak/data/import:ro,Z" quay.io/keycloak/keycloak:26.4 start-dev --import-realm >/dev/null
node "$HERE/stubs.mjs" > "$RUN_DIR/stubs.log" 2>&1 & echo $! > "$RUN_DIR/stubs.pid"
for i in $(seq 1 90); do curl -sf http://localhost:18280/realms/box1/.well-known/openid-configuration >/dev/null && break; sleep 2; done
QUARKUS_HTTP_PORT=18080 CONSOLE_OIDC_URL=http://localhost:18280/realms/box1 \
QUARKUS_OIDC_AUTHENTICATION_FORCE_REDIRECT_HTTPS_SCHEME=false QUARKUS_OIDC_AUTHENTICATION_COOKIE_FORCE_SECURE=false \
CONSOLE_PUBLIC_ORIGIN=http://localhost:18080 CONSOLE_ENVIRONMENT=local-e2e CONSOLE_FULFILLMENT_LINK=derived CONSOLE_STUCK_THRESHOLD=1m \
ORDER_SERVICE_URL=http://127.0.0.1:18081/order INVENTORY_SERVICE_URL=http://127.0.0.1:18081/inventory \
FULFILLMENT_ADAPTER_URL=http://127.0.0.1:18081/fulfillment ASSET_SERVICE_URL=http://127.0.0.1:18081/asset \
QUARKUS_LOG_CONSOLE_JSON_ENABLED=true \
  java -jar "$ROOT/target/quarkus-app/quarkus-run.jar" > "$RUN_DIR/console.log" 2>&1 & echo $! > "$RUN_DIR/console.pid"
for i in $(seq 1 60); do curl -sf http://localhost:18080/q/health/ready >/dev/null && break; sleep 1; done
curl -sf http://localhost:18080/q/health/ready >/dev/null && echo "run18 local stack up: console :18080, keycloak :18280, stubs :18081"
