// Industrial Buddy — Rust industrial filter catalog bot (design 1b).
// Runs as an HTTP interactions endpoint on Cloudflare Workers: Discord POSTs
// every slash command / button click / select choice / form submit here, so
// no gateway connection or always-on process is needed.
//
// Filters are stored in Cloudflare KV (binding: FILTERS) so admins manage
// the library entirely from Discord: /admin add opens a form, /admin remove
// shows a picker. Until KV is configured, the seed library from filters.js
// is served read-only.

import {
  CATEGORIES,
  CATEGORY_EMOJI,
  DEFAULT_FILTERS,
  findFilter,
  slotCount,
  searchFilters,
  parseFilterJson,
  makeId,
} from "./filters.js";
import { registerCommands } from "./commands.js";

// Discord interaction types / response types / component types
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;

const PONG = { type: 1 };
const REPLY = 4; // CHANNEL_MESSAGE_WITH_SOURCE
const UPDATE_MESSAGE = 7;
const MODAL = 9;

const ROW = 1;
const BUTTON = 2;
const SELECT = 3;
const TEXT_INPUT = 4;
const EPHEMERAL = 64;

const EMBED_COLOR = 0xe8a13a; // the amber from the design

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    // One-time browser setup. /register registers the bot's slash commands
    // with Discord — either from stored secrets, or from a token pasted into
    // the form it serves (nothing is stored in that case). /status reports
    // which variables the running Worker can see.
    if (path === "/register") return await handleRegister(request, env);

    if (request.method !== "POST") {
      if (path === "/status") {
        return text(
          statusReport({
            appId: (env.DISCORD_APPLICATION_ID ?? "").trim(),
            token: (env.DISCORD_TOKEN ?? "").trim(),
            publicKey: (env.DISCORD_PUBLIC_KEY ?? "").trim(),
            kv: !!env.FILTERS,
          }),
        );
      }
      return text("⚙️ Industrial Buddy is running.\n\nSetup: /status · /register");
    }

    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();
    if (!signature || !timestamp || !(await verifyRequest(env.DISCORD_PUBLIC_KEY, signature, timestamp, body))) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    try {
      if (interaction.type === PING) return json(PONG);
      if (interaction.type === APPLICATION_COMMAND) return await handleCommand(interaction, env);
      if (interaction.type === MESSAGE_COMPONENT) return await handleComponent(interaction, env);
      if (interaction.type === MODAL_SUBMIT) return await handleModal(interaction, env);
    } catch (e) {
      return json({ type: REPLY, data: { content: `⚠️ ${e.message}`, flags: EPHEMERAL } });
    }
    return new Response("unhandled interaction type", { status: 400 });
  },
};

// ------------------------------------------------------------------ storage

async function loadFilters(env) {
  if (env.FILTERS) {
    const stored = await env.FILTERS.get("filters", "json");
    if (Array.isArray(stored)) return stored;
  }
  return DEFAULT_FILTERS;
}

async function saveFilters(env, filters) {
  if (!env.FILTERS) {
    throw new Error(
      "Storage isn't set up yet — create a KV namespace and bind it as FILTERS (see README).",
    );
  }
  await env.FILTERS.put("filters", JSON.stringify(filters));
}

// ---------------------------------------------------------------- commands

async function handleCommand(interaction, env) {
  const { name, options } = interaction.data;
  const sub = options?.[0];

  if (name === "catalog") {
    // Post the catalog publicly; a mod pins it afterwards.
    return json({ type: REPLY, data: catalogMessage(await loadFilters(env), "All") });
  }

  if (name === "filter" && sub?.name === "search") {
    const query = sub.options?.find((o) => o.name === "query")?.value ?? "";
    return json({ type: REPLY, data: searchReply(await loadFilters(env), query) });
  }

  if (name === "admin") {
    if (sub?.name === "add") return json(addFilterModal());
    if (sub?.name === "remove") return json({ type: REPLY, data: await removePicker(env) });
  }

  return json({ type: REPLY, data: { content: "Unknown command.", flags: EPHEMERAL } });
}

// -------------------------------------------------------------- components

async function handleComponent(interaction, env) {
  const id = interaction.data.custom_id;

  // Category tab clicked → re-render the catalog message in place.
  if (id.startsWith("cat:")) {
    return json({ type: UPDATE_MESSAGE, data: catalogMessage(await loadFilters(env), id.slice(4)) });
  }

  // Filter picked from a copy select → ephemeral reply with the JSON.
  if (id === "copy") {
    const filters = await loadFilters(env);
    const filter = findFilter(filters, interaction.data.values[0]);
    if (!filter) {
      return json({ type: REPLY, data: { content: "That filter no longer exists.", flags: EPHEMERAL } });
    }
    return json({ type: REPLY, data: copyReply(filter) });
  }

  // Admin picked a filter to delete → remove it and update the picker message.
  if (id === "remove") {
    const filters = await loadFilters(env);
    const filter = findFilter(filters, interaction.data.values[0]);
    if (!filter) {
      return json({ type: UPDATE_MESSAGE, data: { content: "That filter no longer exists.", components: [] } });
    }
    await saveFilters(env, filters.filter((f) => f.id !== filter.id));
    return json({
      type: UPDATE_MESSAGE,
      data: {
        content: `🗑️ Removed **${filter.name}**. The pinned catalog updates on its next tab click.`,
        components: [],
      },
    });
  }

  return json({ type: REPLY, data: { content: "Unknown component.", flags: EPHEMERAL } });
}

// ------------------------------------------------------------ admin: add

// /admin add → a Discord form (modal). Category is typed rather than picked
// because modals only support text inputs.
function addFilterModal() {
  const input = (custom_id, label, opts = {}) => ({
    type: ROW,
    components: [{ type: TEXT_INPUT, custom_id, label, style: opts.paragraph ? 2 : 1, ...opts.props }],
  });

  return {
    type: MODAL,
    data: {
      custom_id: "add-filter",
      title: "Add a filter to the catalog",
      components: [
        input("name", "Name", { props: { max_length: 80, placeholder: "Electric Furnace · 1 Conv" } }),
        input("category", "Category (Furnace / Refinery / Recycler)", {
          props: { max_length: 20, placeholder: "Furnace" },
        }),
        input("items", "Items summary (shown on the card)", {
          props: { max_length: 60, placeholder: "metal.ore · sulfur.ore · hq" },
        }),
        input("blurb", "Description", {
          props: { max_length: 200, required: false, placeholder: "What this filter is for" },
        }),
        input("json", "Filter JSON (copy from in-game)", {
          paragraph: true,
          props: { max_length: 4000, placeholder: '[ { "TargetItemName": "metal.ore", ... } ]' },
        }),
      ],
    },
  };
}

async function handleModal(interaction, env) {
  if (interaction.data.custom_id !== "add-filter") {
    return json({ type: REPLY, data: { content: "Unknown form.", flags: EPHEMERAL } });
  }

  // Flatten modal rows into {custom_id: value}
  const values = {};
  for (const row of interaction.data.components) {
    for (const c of row.components) values[c.custom_id] = (c.value ?? "").trim();
  }

  const category = CATEGORIES.find(
    (c) => c !== "All" && c.toLowerCase() === values.category.toLowerCase(),
  );
  if (!category) {
    throw new Error(
      `Category must be one of: ${CATEGORIES.filter((c) => c !== "All").join(", ")} (got "${values.category}").`,
    );
  }

  const files = parseFilterJson(values.json); // throws a readable error on bad JSON

  const filters = await loadFilters(env);
  const filter = {
    id: makeId(filters, values.name),
    emoji: CATEGORY_EMOJI[category] ?? "⚙️",
    name: values.name,
    category,
    items: values.items,
    blurb: values.blurb || "",
    files,
  };
  await saveFilters(env, [...filters, filter]);

  return json({
    type: REPLY,
    data: {
      content:
        `✅ Added **${filter.emoji} ${filter.name}** (${category}, ${slotCount(filter)} slots). ` +
        `It appears in the pinned catalog on its next tab click.`,
      flags: EPHEMERAL,
    },
  });
}

// ---------------------------------------------------------- admin: remove

async function removePicker(env) {
  const filters = await loadFilters(env);
  if (filters.length === 0) {
    return { content: "The library is empty — nothing to remove.", flags: EPHEMERAL };
  }
  return {
    content: "Pick a filter to **permanently remove** from the catalog:",
    flags: EPHEMERAL,
    components: [
      {
        type: ROW,
        components: [
          {
            type: SELECT,
            custom_id: "remove",
            placeholder: "🗑️ Pick a filter to remove…",
            options: filters.slice(0, 25).map((f) => ({
              label: f.name,
              value: f.id,
              description: `${f.category} · ${slotCount(f)} slots`,
              emoji: { name: f.emoji },
            })),
          },
        ],
      },
    ],
  };
}

// ----------------------------------------------------------- message builds

// The pinned catalog (design 1b): header embed, filter cards as inline fields,
// category tab buttons, and a select menu for one-click copy.
function catalogMessage(filters, activeCategory) {
  const category = CATEGORIES.includes(activeCategory) ? activeCategory : "All";
  const visible = category === "All" ? filters : filters.filter((f) => f.category === category);

  const embed = {
    title: "🏭 Rust Industrial Filter Catalog",
    description: `${filters.length} filters · pick one below to copy`,
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
      ...(visible.length > 0 ? [copySelectRow(visible)] : []),
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
    `**${filter.emoji} ${filter.name}**${filter.blurb ? ` — ${filter.blurb}` : ""}\n` +
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
  if (content.length > 2000) content = header + "⚠️ This filter is too large to display in one message.";

  return { content, flags: EPHEMERAL };
}

function searchReply(filters, query) {
  const matches = searchFilters(filters, query);
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

// ------------------------------------------------------------ setup: register

// GET  /register → register from secrets if both are stored; otherwise serve a
//                  form to paste the missing values.
// POST /register → register using the pasted values. Nothing is persisted:
//                  the bot token is used for this one Discord call and dropped.
//
// No extra auth is needed on the POST: a valid bot token IS the credential, and
// Discord rejects anything else.
async function handleRegister(request, env) {
  const storedAppId = (env.DISCORD_APPLICATION_ID ?? "").trim();
  const storedToken = (env.DISCORD_TOKEN ?? "").trim();

  let appId = storedAppId;
  let token = storedToken;

  if (request.method === "POST") {
    const form = await request.formData();
    appId = (form.get("application_id") ?? storedAppId).toString().trim();
    token = (form.get("token") ?? "").toString().trim();
    // Tolerate a pasted "Bot <token>" prefix.
    token = token.replace(/^Bot\s+/i, "");
    if (!appId || !token) {
      return html(registerForm({ appId, error: "Both fields are required." }), { status: 400 });
    }
  } else if (!token) {
    // Token isn't stored — ask for it rather than failing.
    return html(registerForm({ appId }));
  }

  try {
    const names = await registerCommands(appId, token);
    return html(
      registerDone(names, { kv: !!env.FILTERS, storedToken: !!storedToken }),
    );
  } catch (e) {
    return html(registerForm({ appId, error: e.message }), { status: 502 });
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const PAGE_CSS = `
  :root { color-scheme: dark light }
  body { font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; max-width: 34rem;
         margin: 3rem auto; padding: 0 1.25rem; background: #1a1b1e; color: #e6e6e8 }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem }
  p.sub { color: #a0a0a8; margin: 0 0 1.5rem }
  label { display: block; font-weight: 600; margin: 1rem 0 .35rem }
  input { width: 100%; padding: .6rem .7rem; border-radius: 6px; border: 1px solid #3a3b40;
          background: #232428; color: inherit; font: inherit }
  small { display: block; color: #a0a0a8; margin-top: .35rem }
  button { margin-top: 1.5rem; padding: .65rem 1.1rem; border: 0; border-radius: 6px;
           background: #e8a13a; color: #1a1b1e; font: inherit; font-weight: 700; cursor: pointer }
  .err { background: #40201f; border: 1px solid #7a3a36; padding: .7rem .9rem;
         border-radius: 6px; margin-bottom: 1rem; white-space: pre-wrap }
  .ok { background: #1f3a26; border: 1px solid #37693f; padding: .7rem .9rem; border-radius: 6px }
  code { background: #232428; padding: .1rem .35rem; border-radius: 4px }
  @media (prefers-color-scheme: light) {
    body { background: #fff; color: #1a1b1e }
    input { background: #fff; border-color: #ccc }
    p.sub, small { color: #5a5a62 }
    .err { background: #fdeceb; border-color: #f0b4b0 }
    .ok { background: #eaf6ec; border-color: #b6dcbe }
    code { background: #f1f1f3 }
  }`;

function registerForm({ appId = "", error = "" } = {}) {
  return `<style>${PAGE_CSS}</style>
<h1>⚙️ Register slash commands</h1>
<p class="sub">One-time setup. Your bot token is used for a single call to Discord and is <strong>not stored</strong>.</p>
${error ? `<div class="err">❌ ${escapeHtml(error)}</div>` : ""}
<form method="POST">
  <label for="application_id">Application ID</label>
  <input id="application_id" name="application_id" value="${escapeHtml(appId)}"
         inputmode="numeric" autocomplete="off" required>
  <small>Discord developer portal → your app → General Information.</small>

  <label for="token">Bot token</label>
  <input id="token" name="token" type="password" autocomplete="off" required
         placeholder="paste the token from the Bot page">
  <small>Bot page → Reset Token. Treat it like a password — don't share it.</small>

  <button type="submit">Register commands</button>
</form>`;
}

function registerDone(names, { kv, storedToken }) {
  return `<style>${PAGE_CSS}</style>
<h1>⚙️ Industrial Buddy</h1>
<div class="ok">✅ Registered commands: ${names.map((n) => `<code>${escapeHtml(n)}</code>`).join(" ")}</div>
<p>Next: run <code>/catalog</code> in your channel and pin the bot's message.
Commands can take a few minutes to appear in Discord the first time.</p>
${
  kv
    ? "<p>Storage is bound, so <code>/admin add</code> and <code>/admin remove</code> are ready.</p>"
    : "<p>⚠️ KV storage isn't bound yet, so <code>/admin</code> can't save changes. " +
      "Create a KV namespace and bind it as <code>FILTERS</code> (see the README).</p>"
}
${storedToken ? "<p>You can now delete the <code>DISCORD_TOKEN</code> secret — it isn't needed again.</p>" : ""}`;
}

// -------------------------------------------------------------- diagnostics

// Human-readable setup check. Reports only presence, length, and shape —
// never the values themselves.
function statusReport({ appId, token, publicKey, kv }) {
  const hex64 = /^[0-9a-f]{64}$/i;
  const digits = /^\d{15,25}$/;

  const line = (name, value, ok, expected) => {
    if (!value) return `  ✗ ${name} — NOT VISIBLE to the Worker`;
    const shape = ok ? "looks right" : `set, but doesn't look like ${expected}`;
    return `  ${ok ? "✓" : "!"} ${name} — ${value.length} chars, ${shape}`;
  };

  const checks = [
    ["DISCORD_PUBLIC_KEY", publicKey, hex64.test(publicKey), "64 hex characters"],
    ["DISCORD_APPLICATION_ID", appId, digits.test(appId), "a numeric application ID"],
    ["DISCORD_TOKEN", token, token.split(".").length === 3, "a bot token"],
  ];

  const lines = [
    "Industrial Buddy — setup status",
    "",
    ...checks.map((c) => line(...c)),
    `  ${kv ? "✓" : "✗"} FILTERS (KV storage) — ${kv ? "bound" : "not bound; /admin will be disabled"}`,
    "",
  ];

  if (!appId || !token) {
    lines.push(
      !appId
        ? "/register will ask for the missing values in a form — nothing needs to be stored."
        : "DISCORD_TOKEN isn't needed as a secret: /register will ask you to paste it.",
      "",
      "If you'd rather store it, missing variables are almost always one of these:",
      "",
      "1. Added under the wrong section. They must be at",
      "   Worker → Settings → Variables and Secrets (runtime).",
      "   Build variables (Settings → Build) are NOT visible at runtime.",
      "2. Not deployed yet. After adding secrets, the Worker must redeploy —",
      "   click Deploy on the Worker, or push a commit to trigger a build.",
      "3. Name typo or wrong Worker/environment. Names are case-sensitive:",
      "   DISCORD_APPLICATION_ID, DISCORD_TOKEN.",
      "",
      "Fix, then reload /register.",
    );
  } else if (checks.some(([, value, ok]) => value && !ok)) {
    lines.push(
      "Everything is visible, but a value above looks wrong — check you didn't",
      "paste the Application ID into the token field (or vice versa).",
      "",
      "Visit /register to try anyway; Discord will report the exact problem.",
    );
  } else {
    lines.push("All set — visit /register to register the slash commands.");
  }

  return lines.join("\n");
}

// ------------------------------------------------------------------ helpers

// Plain-text response, never cached (so a reload always re-checks).
function text(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

// Setup page. Never cached, never indexed — these pages take a bot token.
function html(body, init = {}) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex"><title>Industrial Buddy setup</title>${body}`,
    {
      status: init.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

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
