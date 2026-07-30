// Optional CLI for registering slash commands. Most people don't need this —
// the deployed Worker registers its own commands when you visit
// https://<your-worker>.workers.dev/register in a browser (see README).
//
// Usage:
//   DISCORD_APPLICATION_ID=... DISCORD_TOKEN=... node scripts/register.js

import { registerCommands } from "../src/commands.js";

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APPLICATION_ID || !TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN environment variables first.");
  process.exit(1);
}

try {
  console.log("✅ Registered commands:", (await registerCommands(APPLICATION_ID, TOKEN)).join(", "));
} catch (e) {
  console.error("❌ Registration failed:", e.message);
  process.exit(1);
}
