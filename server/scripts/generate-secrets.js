const crypto = require("crypto");

const secret = n => crypto.randomBytes(n).toString("base64url");
console.log("# Development helper only. Prefer deploy/generate-secrets.js for production.");
console.log("POSTGRES_PASSWORD="+secret(32));
console.log("INTERNAL_BOT_SECRET="+secret(32));
console.log("INTERNAL_BOT_ADMIN_SECRET="+secret(32));
console.log("ADMIN_PASSWORD="+secret(24));
console.log("ADMIN_SESSION_SECRET="+secret(48));
console.log("USER_SESSION_SECRET="+secret(48));
console.log("PROVIDER_WEBHOOK_SECRET="+secret(32));
console.log("PAYMENT_WEBHOOK_SECRET="+secret(32));
console.log("AUDIT_HMAC_KEY="+secret(48));
console.log("STATE_HMAC_KEY="+secret(48));
console.log("FINANCIAL_JOURNAL_HMAC_KEY="+secret(48));
console.log("WALLET_AUTHORITY_HMAC_KEY="+secret(48));
console.log("BUSINESS_AUTHORITY_HMAC_KEY="+secret(48));
console.log("INVENTORY_ENCRYPTION_KEY="+crypto.randomBytes(32).toString("base64"));
console.log("BACKUP_ENCRYPTION_KEY="+crypto.randomBytes(32).toString("base64"));
