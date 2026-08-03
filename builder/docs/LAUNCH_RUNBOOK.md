# UCHIHA Builder — Launch Runbook

Do not announce the public launch until `scripts/launch-audit.sh` ends with `LAUNCH READY`.

## Deploy the validated branch

```bash
cd /opt/uchiha-builder/repo
git switch builder/v1-platform
bash builder/scripts/update-vps.sh
bash builder/scripts/launch-audit.sh
```

The updater must finish successfully and preserve PostgreSQL volumes and backups.

## Configure the product being sold

Open `/platform-admin` and sign in as the platform administrator.

In **Subscriptions**:

- Set the plan name, price, renewal price, currency and duration.
- Enable sale only after confirming the values.
- One approved subscription creates one store.

In **Payment Methods**:

- Add a verified destination/account, currency, network, minimum/maximum and instructions.
- Keep the method disabled until the destination is verified.
- Never place passwords, API secrets or tokens in public instructions.

## Test one complete sale before accepting customers

1. Open `/create-store` in an incognito browser.
2. Register a new test customer.
3. Select the configured payment method and submit an agreed harmless test reference.
4. Open `/platform-admin` → **Subscriptions**.
5. Verify the reference and approve the request.
6. Confirm the customer page unlocks the store wizard automatically.
7. Create a uniquely named test store.
8. Open the owner dashboard and `/store/<slug>`.
9. Confirm the subscription is consumed and cannot create a second store.
10. Reject the test request instead when no verified transfer exists.

## Mandatory launch conditions

- Root domain and wildcard `demo.<base-domain>` resolve publicly to the VPS.
- HTTPS, HSTS, CSP and `nosniff` are active.
- Registration, login, payment request, admin approval, store creation, dashboard and storefront complete end-to-end.
- Demo has no active real payment methods and rejects real orders.
- PostgreSQL, API, Worker and Caddy are healthy.
- Daily backup timer is active and a current dump exists.
- No failed provisioning jobs remain unexplained.
- VPS branch is `builder/v1-platform` and its SHA matches origin.

## First 20 stores

- Verify amount, currency/network and transaction reference before every approval.
- Use a separate customer account for every owner.
- Never reuse a subscription for two stores.
- Review failed provisioning jobs before accepting more payments.
- Record the latest deployment log and backup path after every release.
- Keep the draft PR unmerged and do not deploy `main` during this launch.
