process.env.NODE_ENV ||= "development";
process.env.DATABASE_MODE = "memory";
process.env.ALLOW_DEMO_BILLING = "true";
process.env.DEMO_SEED = "true";
process.env.TELEGRAM_MODE = "fake";
process.env.HOST ||= "127.0.0.1";
process.env.APP_BASE_URL ||= "http://localhost:4100";
await import("./server.mjs");
