# UCHIHA RADIUS V1-83 — on-site Linux or Docker installer

Three supported local Site Agent deployment paths share the same authenticated
RouterOS TLS agent: **Linux systemd inside the LAN**, **Docker on an always-on
local machine** (see DOCKER-README.md), or **either method on an authorized
computer with a private VPN route into the router's LAN**. The Mini App also
offers direct management over a separately authorized, routable, trusted
API-SSL or RouterOS v7 REST HTTPS endpoint. Direct connectivity requires
actual network routing and certificate verification; registering an IP address
does not make a private router accessible to the central VPS. Prefer the
local Site Agent or a controlled private VPN instead of exposing RouterOS
management to the public Internet.

Each independent location uses a separate RADIUS site and its own agent
configuration with `RADIUS_AGENT_SITE_ID` set to that site. Routers at different
sites may have identical IP addresses without being conflated by the server.


Download the public, **secret-free** Site Agent bundle from your authenticated
RADIUS screen. Install on a **Linux computer or VM on the provider's own LAN**
which can reach the registered MikroTik management interface. Do not install a
shared agent for unrelated providers, and do not expose port 8790 publicly.

1. Install Node.js 24 and npm on that local computer.
2. Save the `.tar.gz` file and its `.sha256` checksum in one folder. Run:
   ```bash
   sha256sum --check uchiha-site-agent-v183.tar.gz.sha256
   tar -xzf uchiha-site-agent-v183.tar.gz
   cd uchiha-site-agent
   bash install.sh --check
   ```
3. Run `sudo bash install.sh` to install a dedicated locked-down systemd service.
   The installer does not start the service or replace existing private settings.
4. In your signed-in network account, open **RADIUS → Site Agent → Generate
   configuration for my routers**. Download the two tenant-specific templates.
5. On the local computer, put the tenant values and one-time signing key into
   `/etc/uchiha-radius/radius-agent.env`. Generate independent local secrets with
   `openssl rand -hex 32`, and put your own MikroTik username/password and
   trusted CA certificate into `/etc/uchiha-radius/routers.json` and
   `/etc/uchiha-radius/router-ca.pem`. Restrict files to the service user (0600).
6. Update legacy device management ports to trusted RouterOS **API-SSL 8729**
   inside your RADIUS account. Local `routers.json` IDs, host and port MUST
   exactly match the registered device; otherwise the server ignores the probe.
7. Run `sudo bash /opt/uchiha-radius-agent/check-and-start.sh` to validate
   configuration and start the service; return to the live **RADIUS status**
   screen. A signed, authenticated TLS identity probe is required for Online.

This bundle installs only the on-site agent. To authenticate subscribers and
receive real RADIUS accounting, deploy/configure **FreeRADIUS 3** separately
using the included `infra/freeradius` snippets, its own RADIUS shared secret,
and UDP 1812/1813 on the authorized network. Never expose the local agent's HTTP
endpoint or reuse the central signing key as a MikroTik password.

If no reachable always-on local Linux machine exists, the agent cannot run
from the public VPS against a private 192.168.x.x address without a separately
authorized secure network route. The VPS alone cannot make an offline router
online.

## Single primary ISP router pairing

If an earlier failed attempt created two records for one physical MikroTik,
select **Connect this main router** beside one original record. Download its
device-specific Site Agent settings; do NOT create two sites for one router.
The other saved record remains for later audit. Each successful signed probe
reports exactly the selected device ID and keeps duplicate registrations offline.

Run `node check-config.mjs --probe` locally (or `docker compose run --rm
agent node check-config.mjs --probe`). Safe failure codes mean:

- `DNS_LOOKUP_FAILED`: the device hostname is not resolving locally.
- `API_SSL_UNAVAILABLE`: the recorded API-SSL service/port is unreachable
  or refused inside the authorized LAN/VPN.
- `CONNECT_TIMEOUT`: the chosen management address or network route did
  not answer within the timeout.
- `TLS_CERTIFICATE_FAILED`: the configured CA or certificate hostname
  cannot validate RouterOS; never bypass TLS verification.
- `TLS_HANDSHAKE_FAILED`: the connection closed or did not speak TLS.
- `ROUTEROS_LOGIN_OR_PERMISSION`: the local RouterOS account could not
  authenticate or lacks permission for the identity probe.
- `ROUTER_IDENTITY_FAILED`: an authenticated identity was not returned.
- `ROUTER_UNREACHABLE`: no more precise safe category is available.

The current legacy record uses `11.5.50.0:8728`; first verify that
`11.5.50.0` really is the router's manageable host address (some network
masks make a dotted-.0 address a network address) and set the encrypted API-SSL
service to the port recorded in RADIUS (normally 8729). A browser cannot
reach private RouterOS merely because the record was saved in the database.
