// One-time (re-run after changes) registration of the bot's slash commands.
// Usage:
//   DISCORD_APPLICATION_ID=... DISCORD_TOKEN=... node scripts/register.js
//
// The bot token is ONLY needed here — the Worker itself never uses it.

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APPLICATION_ID || !TOKEN) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN environment variables first.");
  process.exit(1);
}

const commands = [
  {
    name: "catalog",
    description: "Post the filter catalog message (pin it afterwards)",
    // Restricted to members with Manage Messages so random users can't spam it.
    default_member_permissions: "8192",
  },
  {
    name: "filter",
    description: "Rust industrial filter tools",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: "search",
        description: "Find a filter by item or machine",
        options: [
          {
            type: 3, // STRING
            name: "query",
            description: 'e.g. "sulfur refinery" or "metal.ore"',
            required: true,
          },
        ],
      },
    ],
  },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (res.ok) {
  console.log("✅ Registered commands:", (await res.json()).map((c) => `/${c.name}`).join(", "));
} else {
  console.error("❌ Registration failed:", res.status, await res.text());
  process.exit(1);
}
