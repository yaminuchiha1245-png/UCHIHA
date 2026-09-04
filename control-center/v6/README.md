# UCHIHA Control Center v6 — Guarded Executor

UCHIHA v6 upgrades the real ChatGPT Bridge with an approval-gated project executor.

## What is real in v6

- Production owner authentication and secure sessions.
- Live project registry, approvals, execution history, and tamper-evident audit log.
- ChatGPT → GitHub issue command bus → UCHIHA VPS.
- `project.register`, `project.plan-deploy`, and approved `project.deploy`.
- Real project execution through GitHub Actions + SSH after owner approval.
- Automatic health verification and rollback to the previous container when a replacement fails.
- UI messages now report the actual server result instead of showing the same generic “request recorded” message.

## Guarded deployment contract

A project must contain `uchiha.deploy.json` at repository root:

```json
{
  "version": 1,
  "runtime": "dockerfile",
  "context": ".",
  "dockerfile": "Dockerfile",
  "containerPort": 3000,
  "healthPath": "/health",
  "timeoutSeconds": 60,
  "memoryMb": 512,
  "cpus": 1
}
```

The executor does not run project-provided host shell commands, does not use privileged containers, does not use host networking or host volumes, and never accepts secrets in ChatGPT/GitHub issue command payloads. Project secrets, when needed, stay server-side at `~/uchiha-control-center/shared/project-secrets/<slug>.env`.

## Deployment sequence

1. ChatGPT registers the project.
2. ChatGPT creates a deployment plan.
3. The owner approves it in Control Center.
4. ChatGPT sends `project.deploy`.
5. GitHub Actions validates the repository and manifest, uploads the source to the VPS, builds a scoped Docker image, starts it on a localhost-only port, checks health, and rolls back on failure.
6. The result is written back to the live project registry, execution history, and audit log.

Domain/DNS automation remains a separate guarded capability. The executor can deploy the application first without granting the project direct control over Nginx, Cloudflare, or host-level secrets.
