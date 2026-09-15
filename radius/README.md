# UCHIHA RADIUS Production

Production target: VPS deployment only. Railway is not part of this deployment path.

Current release baseline:
- UI: v101
- Backend: v37
- Database schema: 30
- Domain target: `radius.uchiha-builder.com`

## Deployment model

GitHub (`radius-production` branch) -> GitHub Actions -> VPS -> `/opt/uchiha-radius/current`

Secrets stay on the VPS or in GitHub Actions secrets. Do not commit production passwords, RADIUS shared secrets, MikroTik tokens, SSH private keys, or bootstrap owner passwords.

Expected repository layout under this directory:

- `RADIUS-A-Master-v101.html`
- `RADIUS-A-Connector-Backend-v37.py`
- `UCHIHA-RADIUS-v101-Backend-v37-vps-bootstrap.sh`
- `UCHIHA-RADIUS-v101-Backend-v37-production-launch.py`
- `UCHIHA-RADIUS-v101-Backend-v37-launch-evidence.py`
- release verifier / manifest and the remaining v101/v37 production-kit files

The VPS keeps the runtime environment in `/etc/uchiha-radius/connector.env` and persistent data/backups under `/var/lib/uchiha-radius`.

## Required GitHub Actions secrets

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` (optional; defaults to 22 in the workflow)
- `RADIUS_DOMAIN` (expected value: `radius.uchiha-builder.com`)

## First deployment

1. Put the exact tested v101 / Backend v37 Production Kit in this directory.
2. Configure the GitHub Actions secrets above.
3. On the VPS, configure `/etc/uchiha-radius/connector.env` with the real production values.
4. Point DNS for `radius.uchiha-builder.com` to the VPS and install valid TLS.
5. Run the `Deploy UCHIHA RADIUS to VPS` workflow.
6. Accept production only when the real VPS reaches `READY_TO_SERVE`, score `100`, blockers `[]`, and launch evidence reports `ok=true`.
