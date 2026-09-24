# UCHIHA RADIUS V1-83 — on-site Linux installer

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
