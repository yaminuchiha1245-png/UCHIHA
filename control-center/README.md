# UCHIHA Control Center

Production Core v4 for the new UCHIHA Control Center.

This branch intentionally keeps Control Center isolated from the existing bot files.

## Production package
The source archive is stored as six small verified chunks under `control-center/package/` because the repository connector cannot reliably transfer the archive as one binary payload.

Reconstruct it with:

```bash
cat control-center/package/part-* > UCHIHA-Control-Center-PRODUCTION-v4-CLEAN.zip
```

Expected SHA-256:

```text
4ec9cd3660a64e356d191836751aabe945f677a0aa5c8b320fcfba4450bdcb0e
```

`control-center/package/SHA256SUMS` contains the checksum for every part and the reconstructed archive. GitHub Actions reconstructs and verifies the package on every relevant pull request change.

The archive contains:
- final mobile-first UI
- Node.js backend API
- Owner session authentication
- Policy Engine and approval gates
- tamper-evident audit log
- connector registry for GitHub / Server / DNS / Vault
- Dockerfile and Docker Compose
- PWA/offline shell
- Caddy/Nginx/systemd deployment examples
- persistent data and backup tooling

## Production deployment
`.github/workflows/uchiha-control-center-deploy.yml` is manual only. It will not deploy automatically.

A production run requires entering `DEPLOY` and requires these GitHub production secrets:
- `UCHIHA_VPS_HOST`
- `UCHIHA_VPS_USER`
- `UCHIHA_VPS_SSH_KEY`
- `UCHIHA_VPS_KNOWN_HOSTS`
- `UCHIHA_ENV_FILE`

The deployment workflow:
1. reconstructs and verifies the package checksum;
2. uses strict SSH host-key verification;
3. installs the protected server environment file without committing it;
4. preserves the previous application release;
5. deploys with Docker Compose;
6. runs the backend health check;
7. rolls back to the previous release if deployment or health verification fails.

No production secret is stored in this repository. `OWNER_PASSWORD_HASH` and connector credentials belong only in the protected server environment.

High-impact operations remain disabled or approval-gated until the real infrastructure connectors are configured.
