// Industrial Buddy — Rust industrial filter catalog bot (design 1b).
// Runs as an HTTP interactions endpoint on Cloudflare Workers: Discord POSTs
// every slash command / button click / select choice here, so no gateway
// connection or always-on process is needed.

import { CATEGORIES, FILTERS, filterById, slotCount, searchFilters } from "./filters.js";

// Discord interaction types / response types / component types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;

const PONG = { type: 1 };
const REPLY = 4; // CHANNEL_MESSAGE_WITH_SOURCE
const UPDATE_MESSAGE = 7;

const ROW = 1;
const BUTTON = 2;
const SELECT = 3;
const EPHEMERAL = 64;

const EMBED_COLOR = 0xe8a13a; // the amber from the design

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("⚙️ Industrial Buddy is running.", { status: 200 });
    }

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();
    if (!signature || !timestamp || !(await verifyRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body))) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === PING) return json(PONG);
    if (interaction.type === APPLICATION_COMMAND) return handleCommand(interaction);
    if (interaction.type === MESSAGE_COMPONENT) return handleComponent(interaction);
    return new Response("unhandled interaction type", { status: 400 });
  },
};

// ---------------------------------------------------------------- commands

function handleCommand(interaction) {
  const { name, options } = interaction.data;

  if (name === "catalog") {
    // Post the catalog publicly; a mod pins it afterwards.
    return json({ type: REPLY, data: catalogMessage("All") });
  }

  if (name === "filter") {
    const sub = options?.[0];
    if (sub?.name === "search") {
      const query = sub.options?.find((o) => o.name === "query")?.value ?? "";
      return json({ type: REPLY, data: searchReply(query) });
    }
  }

  return json({ type: REPLY, data: { content: "Unknown command.", flags: EPHEMERAL } });
}

// -------------------------------------------------------------- components

function handleComponent(interaction) {
  const id = interaction.data.custom_id;

  // Category tab clicked → re-render the catalog message in place.
  if (id.startsWith("cat:")) {
    return json({ type: UPDATE_MESSAGE, data: catalogMessage(id.slice(4)) });
  }

  // Filter picked from a copy select → ephemeral reply with the JSON.
  if (id === "copy") {
    const filter = filterById(interaction.data.values[0]);
    if (!filter) {
      return json({ type: REPLY, data: { content: "That filter no longer exists.", flags: EPHEMERAL } });
    }
    return json({ type: REPLY, data: copyReply(filter) });
  }

  return json({ type: REPLY, data: { content: "Unknown component.", flags: EPHEMERAL } });
}

// ----------------------------------------------------------- message builds

// The pinned catalog (design 1b): header embed, filter cards as inline fields,
// category tab buttons, and a select menu for one-click copy.
function catalogMessage(activeCategory) {
  const category = CATEGORIES.includes(activeCategory) ? activeCategory : "All";
  const visible = category === "All" ? FILTERS : FILTERS.filter((f) => f.category === category);

  const embed = {
    title: "🏭 Rust Industrial Filter Catalog",
    description: `${FILTERS.length} filters · updated weekly · pick one below to copy`,
    color: EMBED_COLOR,
    fields: visible.map((f) => ({
      name: `${f.emoji} ${f.name}`,
      value: `\`${f.items}\`\n${slotCount(f)} slots`,
      inline: true,
    })),
    footer: { text: '🔍 /filter search — e.g. "sulfur refinery"' },
  };

  return {
    embeds: [embed],
    components: [
      {
        type: ROW,
        components: CATEGORIES.map((c) => ({
          type: BUTTON,
          style: c === category ? 1 : 2, // primary (blurple) when active, grey otherwise
          label: c,
          custom_id: `cat:${c}`,
        })),
      },
      copySelectRow(visible),
    ],
  };
}

function copySelectRow(filters) {
  return {
    type: ROW,
    components: [
      {
        type: SELECT,
        custom_id: "copy",
        placeholder: "📋 Pick a filter to copy…",
        options: filters.slice(0, 25).map((f) => ({
          label: f.name,
          value: f.id,
          description: `${f.items} · ${slotCount(f)} slots`.slice(0, 100),
          emoji: { name: f.emoji },
        })),
      },
    ],
  };
}

// Ephemeral copy reply. Discord shows a one-click copy button on code blocks,
// so this is the closest a bot can get to "copy to clipboard" — and nobody
// else sees the JSON wall.
function copyReply(filter) {
  const header =
    `**${filter.emoji} ${filter.name}** — ${filter.blurb}\n` +
    `Paste in-game: hold **Shift** on an Industrial Conveyor → **Paste (JSON)**\n`;

  const blocks = (indent) =>
    filter.files
      .map((file) => {
        const label = filter.files.length > 1 ? `**${file.label}**\n` : "";
        return `${label}\`\`\`json\n${JSON.stringify(file.json, null, indent)}\n\`\`\``;
      })
      .join("\n");

  // Message content caps at 2000 chars; drop pretty-printing if needed
  // (the game doesn't care about whitespace).
  let content = header + blocks(2);
  if (content.length > 2000) content = header + blocks(0);

  return { content, flags: EPHEMERAL };
}

function searchReply(query) {
  const matches = searchFilters(query);
  if (matches.length === 0) {
    return {
      content: `No filters match **${query}**. Try an item shortname like \`sulfur.ore\` or a machine like \`refinery\`.`,
      flags: EPHEMERAL,
    };
  }

  const embed = {
    title: `🔍 ${matches.length} filter${matches.length === 1 ? "" : "s"} for “${query}”`,
    color: EMBED_COLOR,
    fields: matches.map((f) => ({
      name: `${f.emoji} ${f.name}`,
      value: `\`${f.items}\`\n${slotCount(f)} slots`,
      inline: true,
    })),
  };

  return { embeds: [embed], components: [copySelectRow(matches)], flags: EPHEMERAL };
}

// ------------------------------------------------------------------ helpers

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

// Ed25519 signature check via Web Crypto (native in the Workers runtime).
async function verifyRequest(publicKeyHex, signatureHex, timestamp, body) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
