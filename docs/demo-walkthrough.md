# Demo walkthrough

All identities and data here are synthetic. Use only these identifiers in demos.

## Fixtures

| Kind | Values |
|---|---|
| Console users (Keycloak `box1` realm) | Any realm user given a console role. Local e2e users: `vera` (viewer), `otto` (operator and viewer), `dana` (developer), `nora` (no role) |
| Customers | `cust_demo_ada`, `cust_demo_lin`, `cust_demo_kai` |
| Sites and SKUs | Taken from the inventory service's seeded stock (Sites & assets page). Local stubs: `site_east` (`SKU-42`, `SKU-7`), `site_west` (`SKU-42`) |
| Idempotency keys for scripted demos | `demo-<scenario>-<yyyymmdd>-<n>`. Repeating a key replays the same order. |

**Reset:** order-service has no delete or cancel endpoint, so demo orders are never deleted. Start a new demo with a new key series. Nothing else is touched.

## Happy path with a held ERP request

The screenshots below are from the local e2e stack (real Keycloak login, stubbed upstreams driven through each adapter state) in Firefox. Cluster screenshots are added after live acceptance.

1. **Sign in.** Opening the console redirects to Keycloak. After login the overview shows indicators and the exception queue.
   ![Overview](screenshots/01-home.png)
2. **Place an order** (operator). One idempotency key is used per submission, so a retry cannot create a second order.
   ![Placed](screenshots/02-placed.png)
3. **Follow it.** The order goes Submitted → Stock reserved → **Awaiting ERP acknowledgement**. The ERP panel refines it: queued, uploaded (with outstanding attempts), accepted. Every timeline entry shows its trace ID, correlation ID and event.
   ![Awaiting ERP](screenshots/03-awaiting-erp.png)
4. **Hold in the ERP.** An ERP operator holds the request, and the console shows **Held by an ERP operator. Waiting, not a failure.**
   ![Held](screenshots/04-held.png)
5. **Recover.** The operator releases the hold and the ERP ships. The console shows "Shipped" from the adapter, but marks the order complete only after the order service reports it.
   ![Completed](screenshots/05-completed.png)

## Failure views

- When the fulfillment adapter is unreachable, the page shows **ERP detail unavailable** next to the order service's state.
  ![ERP unavailable](screenshots/06-erp-unavailable.png)
- When the asset service refuses the console's token (gap G-2), the Sites page names the refusal and still shows stock.
  ![Sites partial](screenshots/06-sites-partial.png)
- Forbidden state for a user without a console role, delivery view for a developer, incident evidence, sign-out and mobile width:
  ![Forbidden](screenshots/08-forbidden-no-role.png) ![Delivery](screenshots/07-delivery.png)
  ![Incident](screenshots/10-incident-evidence.png) ![Signed out](screenshots/09-signed-out.png) ![Mobile](screenshots/11-mobile-orders.png)
