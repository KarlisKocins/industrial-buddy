# ⚙️ Industrial Buddy

Discord bot for **#industrial-paste** — a pinned, browsable catalog of Rust
industrial-conveyor filters with one-click copy (design 1b). No more JSON
walls in chat.

- **`/catalog`** (mods only) posts the catalog message: category tabs
  (All / Furnace / Refinery / Recycler) + a picker. Pin it once and it works forever.
- Picking a filter sends an **ephemeral** reply (only you see it) with the
  JSON in a code block — Discord shows a copy button on code blocks, so it's
  one click to clipboard, then in-game: hold **Shift** on an Industrial
  Conveyor → **Paste (JSON)**.
- **`/filter search sulfur refinery`** finds filters by item or machine, ephemerally.

Hosting is **free** on Cloudflare Workers: the bot is a webhook endpoint
(Discord POSTs each interaction to it), so there's no server to keep alive
and the free tier (100k requests/day) is orders of magnitude more than needed.

## Setup (~10 minutes, no credit card)

### 1. Create the Discord app

1. Go to https://discord.com/developers/applications → **New Application** → name it `Industrial Buddy`.
2. On **General Information**, note the **Application ID** and **Public Key**.
3. On **Bot**, click **Reset Token** and note the **token** (used only for command registration, never stored in the Worker).
4. Invite it to your server: **OAuth2 → URL Generator**, check the `applications.commands` scope, open the generated URL, pick your server.

### 2. Deploy the Worker

```sh
git clone https://github.com/KarlisKocins/industrial-buddy
cd industrial-buddy
npm install
npx wrangler login          # opens browser — free Cloudflare account is enough
npx wrangler deploy         # prints your Worker URL, e.g. https://industrial-buddy.<you>.workers.dev
npx wrangler secret put DISCORD_PUBLIC_KEY   # paste the Public Key from step 1.2
```

### 3. Wire Discord to the Worker

Back on the app's **General Information** page, set
**Interactions Endpoint URL** to your Worker URL and save. Discord sends a
test ping — if the save succeeds, the signature check is working.

### 4. Register the slash commands

```sh
DISCORD_APPLICATION_ID=<app id> DISCORD_TOKEN=<bot token> npm run register
```

### 5. Post & pin the catalog

In #industrial-paste run `/catalog`, then right-click the bot's message →
**Pin Message**. Done — the tabs and picker on the pinned message keep
working indefinitely.

## Editing the filter library

All filters live in [`src/filters.js`](src/filters.js). Each entry has a
name, emoji, category, item summary, and the actual game JSON (one `files`
entry per conveyor — two-conveyor in/out setups get two labelled code blocks
in the copy reply).

The **Electric Furnace · 1 Conv** JSON is the real one from the channel; the
other five are seeded placeholders in the correct format — **replace them
with your tested versions**. After editing, redeploy:

```sh
npx wrangler deploy
```

The pinned message re-renders from current data on every tab click, so new
filters appear without re-posting it. (If you add a category, also nothing
else to do — tabs come from `CATEGORIES`.)

## Limits worth knowing

- A select menu holds max **25 options**; per-category views keep you under it.
- Ephemeral replies cap at 2000 chars; the bot auto-compacts JSON if a
  filter's pretty-printed form would exceed that.
- Bots can't write to the clipboard — the code-block copy button is the
  Discord-native equivalent.
