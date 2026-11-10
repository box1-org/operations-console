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
2. **Place an order** (operator).
   - **Site** and **SKU** are dropdowns filled from the inventory service. Each SKU shows its available, on-hand and reserved stock, and choosing a different site resets the SKU.
   - **Customer** is a dropdown of the demo customers, with an *Other…* option for a typed `cust_…` ID.
   - A quantity above what is available shows a warning but can still be submitted: inventory decides, and a rejection is a valid demo path.
   - If the inventory service does not answer, the page says so and falls back to typed site and SKU.
   - One idempotency key is used per submission, so a retry cannot create a second order.
   ![Place order dropdowns](screenshots/02a-place-order-dropdowns.png)
   ![Placed](screenshots/02-placed.png)
3. **Follow it.** The order goes Submitted → Stock reserved → **Awaiting ERP acknowledgement**. The ERP panel refines it: queued, uploaded (with outstanding attempts), accepted. Every timeline entry shows its trace ID, correlation ID and event.
   ![Awaiting ERP](screenshots/03-awaiting-erp.png)
4. **Hold in the ERP.** An ERP operator holds the request, and the console shows **Held by an ERP operator. Waiting, not a failure.**
   ![Held](screenshots/04-held.png)
5. **Recover.** The operator releases the hold and the ERP ships. The console shows "Shipped" from the adapter, but marks the order complete only after the order service reports it.
   ![Completed](screenshots/05-completed.png)

## Ask the assistant

Open **Assistant** and ask in plain words, for example "Why is ord_… not shipping?". The assistant reads box1 through read-only tools with your own roles, and shows each read as it goes. Its answer is model text: check the **Sources consulted** list. Type `/help` for commands.

![Assistant chat](screenshots/22-assistant-chat.png)

### Incident analyses

The Assistant (box1-docs#101) needs `aiops-analyst` on agentic-operations. Use it with an active incident, for example one from `erp-delayed-processing`.

1. Open the incident and choose **Ask the assistant to analyze this incident**, or open **Assistant** and type `/incidents`, then **Analyze**.
2. The analysis is queued and then running. When it completes, the Assistant shows the summary, findings with their cited evidence (`ev_N`), what is not known, and the evidence list with each source's retrieval status.
3. Suggested actions appear under **Proposed only — never executed**. Nothing on the page can carry them out.
   ![Assistant](screenshots/20-assistant-analysis.png)

## Edge sites (box1-docs#130)

**Sites & assets** shows each site on a schematic map and in a status table. `site_ds9` (VM `site-west`) is on the west
side and `site_spacedock` (VM `site-east`) on the east; other places come from `CONSOLE_SITE_MAP`, and sites without one
are listed beside the map. Each state has a word and a shape: circle with a tick **Online**, triangle **Degraded**, square
with a cross **Offline**, dashed diamond for no status. Tab reaches each map marker; Enter moves to its row, which shows
the reasons, last seen, buffer depth and site-event backlog, booted image digest (open it for the full digest),
greenboot and active alerts. The page refreshes every 15 s.

![Sites map](screenshots/12-sites-map.png)

Local e2e stubs: `site_ds9` online, `site_spacedock` degraded (buffer depth 240), `site_utopia_planitia` offline,
`site_east` and `site_west` with stock but no status. If asset-service does not serve site status yet, the page says
**Site status unavailable** and still lists the inventory sites:

![Site status unavailable](screenshots/13-sites-status-unavailable.png)

## Failure views

- When the fulfillment adapter is unreachable, the page shows **ERP detail unavailable** next to the order service's state.
  ![ERP unavailable](screenshots/06-erp-unavailable.png)
- When the asset service refuses the console's token (gap G-2), the Sites page names the refusal and still shows stock.
  ![Sites partial](screenshots/06-sites-partial.png)
- Forbidden state for a user without a console role, delivery view for a developer, incident evidence, sign-out and mobile width:
  ![Forbidden](screenshots/08-forbidden-no-role.png) ![Delivery](screenshots/07-delivery.png)
  ![Incident](screenshots/10-incident-evidence.png) ![Signed out](screenshots/09-signed-out.png) ![Mobile](screenshots/11-mobile-orders.png)
