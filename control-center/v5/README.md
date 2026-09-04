# UCHIHA Control Center v5 — ChatGPT Bridge

This source tree replaces bootstrap/demo project data with a live registry and adds the first real ChatGPT-to-UCHIHA command transport.

## What is real in v5

- Production owner authentication and session security.
- Tamper-evident audit log and approval records.
- Live Control Center self-project instead of seeded client projects.
- ChatGPT Bridge status API.
- GitHub-issue command intake through a dedicated GitHub Actions workflow.
- Safe project registration from ChatGPT without placing secrets in command payloads.
- Deployment plans are approval-gated; infrastructure execution is intentionally still disabled in this milestone.

## Bridge command schema

Commands are JSON bodies in issues titled `[UCHIHA-CMD] ...` and authored by the configured owner.

```json
{
  "schema": "uchiha.command.v1",
  "action": "project.register",
  "project": {
    "name": "Example",
    "slug": "example",
    "repository": "https://github.com/OWNER/REPO",
    "branch": "main",
    "domain": "example.uchiha-builder.com"
  }
}
```

No passwords, tokens, API keys, or private keys are accepted in bridge commands.
