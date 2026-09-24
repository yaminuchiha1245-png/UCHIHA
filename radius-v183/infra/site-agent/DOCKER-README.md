# UCHIHA RADIUS Site Agent — Docker / VPN route

The same signed Site Agent runs on an always-on local computer using Docker on
Linux or Docker Desktop with an Ubuntu WSL2 filesystem. The Docker host must
have authorized network access to its own RouterOS devices, directly on LAN
or through a private VPN route. The public RADIUS server cannot route into
another person's private network without this local agent.

## Local setup (one deployment per site)

Download and verify the bundle's SHA-256 manifest. Unpack it inside a local
Linux filesystem (for Windows, an Ubuntu WSL2 home directory). From the
extracted `uchiha-site-agent` directory:

1. Install Docker Engine / Docker Desktop and Docker Compose v2 locally.
2. Run `mkdir -p config data && chmod 700 config data` and place your
   downloaded, site-specific `radius-agent.env.template` at
   `config/radius-agent.env` and `routers.json.template` at
   `config/routers.json`. The downloaded env must include the intended
   `RADIUS_AGENT_SITE_ID`. Repeat with a different site ID for each network
   when identical private IP addresses occur at multiple branches.
3. Edit the two PRIVATE local files with your dedicated one-time signing key,
   independent local cache/HTTP keys, RouterOS username/password and trusted
   CA certificate `config/router-ca.pem`. Keep them off GitHub/Telegram.
   Ensure all files are owned by the local UID 1000 and `chmod 600 config/*`.
4. The env file uses `RADIUS_ROUTERS_FILE=/etc/uchiha-radius/routers.json`,
   `RADIUS_AGENT_DB=/var/lib/uchiha-radius-agent/spool.sqlite`,
   `RADIUS_AGENT_HOST=127.0.0.1`, and the published HTTPS server URL.
   All registered devices must use their real local IP and trusted API-SSL port
   8729. Obtain the exact device IDs from the authenticated RADIUS page.
5. Execute `docker compose build`; test configuration and real authenticated
   TLS access using `docker compose run --rm agent node check-config.mjs --probe`.
   Then run `docker compose up -d` and check `docker compose logs agent`.
   The RADIUS dashboard marks only recent TLS-authenticated RouterOS probes
   as online. Startup validates all configured fields before running the agent.

No inbound ports are published by this package. It does not install or manage
FreeRADIUS; configure subscriber AAA / accounting separately. Docker Desktop
must be allowed to reach the management LAN/VPN; Windows filesystem mounts
without Unix mode 0600 are unsuitable for storing credentials. Run in WSL2's
Linux home instead.
