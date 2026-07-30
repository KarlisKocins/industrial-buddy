// Slash-command definitions, shared by the Worker's /register endpoint and
// the optional scripts/register.js CLI.

export const COMMANDS = [
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
  {
    name: "admin",
    description: "Manage the filter library (mods only)",
    // Only members with Manage Messages see/use this; server owners can
    // adjust who exactly in Server Settings → Integrations → Industrial Buddy.
    default_member_permissions: "8192",
    options: [
      {
        type: 1, // SUB_COMMAND
        name: "add",
        description: "Add a filter to the catalog via a form",
      },
      {
        type: 1, // SUB_COMMAND
        name: "remove",
        description: "Remove a filter from the catalog",
      },
    ],
  },
];

// PUT the command set to Discord (idempotent — safe to re-run).
export async function registerCommands(applicationId, token) {
  const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(COMMANDS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${text}`);
  return JSON.parse(text).map((c) => `/${c.name}`);
}
