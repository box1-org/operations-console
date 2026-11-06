# operations-console

The **box1 Operations** console: the operator-facing product for following orders from submission to shipment,
seeing ERP progress precisely, and finding diagnostic evidence without OpenShift access (box1-docs#18).

One Golden Path Quarkus service with two parts in one pod:

- **Front end:** React/TypeScript in `src/main/webui`, built by Maven from a pinned lockfile and served by Quarkus.
  Nothing loads from a CDN or external font service.
- **Console backend:** holds the Keycloak login session and calls the services on the operator's behalf. Access and
  refresh tokens never reach browser JavaScript or storage. It owns no business state.

Owner: `user:default/mike4263`. Quarkus 3.40.1.1, Java 21, Maven 3.9.16, Node 24.22.2 (downloaded and SHA-256-checked by the build).

## Pages and roles

Roles are client roles on the Keycloak client `operations-console`. The backend enforces every check, and the pages only reflect them.

| Page | Path | Needs |
|---|---|---|
| Overview (indicators, exception queue) | `/` | `console-viewer`, `-operator` or `-developer` |
| Orders (filter, sort, pages) | `/orders` | viewer |
| Place order | `/orders/new` | `console-operator` |
| Order detail (state, reservation, ERP progress, timeline, evidence) | `/orders/{id}` | viewer |
| Incidents and evidence | `/incidents` | viewer |
| Sites & assets | `/sites` | viewer |
| Delivery (deployed revisions) | `/delivery` | `console-developer` |
| Demo control (read-only until box1-docs#19) | `/demo` | viewer |

## Build and test

```sh
./mvnw verify -DskipITs=false        # Node install, npm ci, typecheck, Vite build, Java tests, Checkstyle, SpotBugs
```

- The console API contract is `src/main/resources/META-INF/openapi.yaml`. The front end generates its typed client from it at build time (`npm run gen:api`).
- `ContractDriftTest` keeps the Java resource and the contract in step.

Browser tests use Playwright with **Firefox only** (`src/test/e2e`). They run against a local stack: a Keycloak container, controllable upstream stubs and the built console.

```sh
./mvnw -DskipTests package
export RUN_DIR=$(mktemp -d)                 # private: holds per-run random test passwords
src/test/e2e/local-up.sh                     # console :18080, keycloak :18280, stubs :18081
(cd src/test/e2e && npm ci && npx playwright install firefox && npx playwright test)
src/test/e2e/local-down.sh
```

## Configuration

These settings are deployment environment variables. Defaults are in `application.properties`.

| Variable | Purpose | Default |
|---|---|---|
| `CONSOLE_OIDC_URL` | Keycloak realm URL | `https://keycloak.apps.ocp.box1.org/auth/realms/box1` |
| `CONSOLE_OIDC_CLIENT_ID` | Keycloak client | `operations-console` |
| `CONSOLE_PUBLIC_ORIGIN` | The console's public https origin (CORS and CSRF origin check) | `https://operations-console-dev.apps.ocp.box1.org` |
| `CONSOLE_SESSION_KEY` | Session-cookie encryption key, from a Secret. **Unset by default:** each pod generates one, so restarts sign users out and only one replica works | unset |
| `ORDER_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `FULFILLMENT_ADAPTER_URL`, `ASSET_SERVICE_URL`, `SCENARIO_CONTROLLER_URL` | In-cluster upstream base URLs. When one is empty, that source is reported "not connected" | unset |
| `CONSOLE_FULFILLMENT_LINK` | `derived` uses order-service's internal `ord_x → ful_x` convention to find ERP status; `none` shows "ERP detail unavailable" | `none` |
| `CONSOLE_FORWARD_USER_TOKEN` | Forward the user's access token to upstreams. Keep `false` with the public client: its tokens are obtainable by any realm user, so it carries no other service's audience | `false` |
| `CONSOLE_STUCK_THRESHOLD` | Time awaiting ERP acknowledgement before an order becomes an incident | `10m` |
| `CONSOLE_ENVIRONMENT`, `TELEMETRY_CONSOLE_URL` | Shown in the header, and the link target for telemetry | dev values |

The Golden Path endpoints `/api/greetings`, `/api/info`, `/q/health/*`, `/q/openapi` and `/q/metrics` stay public for the release smoke task. Swagger UI needs a console session. `.tekton/release.yaml` adds a read-only `console-smoke` step that checks the Keycloak redirect (client and PKCE), the login page, the API's 401, the CSP and the contract. `GREETING_PREFIX` must stay `Hello from box1`.

## Documentation

- [Architecture](docs/architecture.md)
- [Runbook](docs/runbook.md)
- [Demo walkthrough](docs/demo-walkthrough.md)

Developer Hub publishes `docs/` on the **Docs** tab.
