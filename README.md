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

### 4. Register the slash commands (in the browser)

Visit `https://<your-worker>.workers.dev/register` and paste your Application
ID and bot token into the form. You should get:
`✅ Registered commands: /catalog /filter /admin`

The token is used for that single call to Discord and is **not stored**. If you
prefer, store `DISCORD_APPLICATION_ID` / `DISCORD_TOKEN` as secrets instead and
`/register` will use them without asking; a CLI equivalent also exists
(`DISCORD_APPLICATION_ID=... DISCORD_TOKEN=... npm run register`).

Re-run `/register` after upgrading the bot if the command list changes.

### Troubleshooting: `/status`

Visit `https://<your-worker>.workers.dev/status` for a setup check — it reports
which variables the running Worker can actually see (lengths and shape only,
never values) and whether KV storage is bound. If a secret you added shows as
`NOT VISIBLE`, it was added under Settings → **Build** (build-time only)
instead of Settings → **Variables and Secrets** (runtime), or the Worker hasn't
redeployed since.

### 5. Post & pin the catalog

In #industrial-paste run `/catalog`, then right-click the bot's message →
**Pin Message**. Done — the tabs and picker on the pinned message keep
working indefinitely.

## Managing filters from Discord (no PC needed)

Admins with **Manage Messages** manage the library entirely in Discord:

- **`/admin add`** — opens a form: name, category (Furnace / Refinery /
  Recycler), items summary, description, and the filter JSON pasted straight
  from the game (Industrial Conveyor → **Copy (JSON)**). The JSON is
  validated before saving — a broken paste is rejected with the reason.
  For two-conveyor setups, paste an object of labelled arrays instead:
  `{"Conveyor 1 — ore in": [...], "Conveyor 2 — refined out": [...]}`
- **`/admin remove`** — pick a filter from a dropdown to delete it.

Changes show up on the pinned catalog the next time someone clicks a tab —
no redeploy, no re-posting, no re-pinning.

### One-time storage setup (required for /admin)

Filters are stored in Cloudflare KV (free tier included). Until this is done
the bot serves the built-in seed library and `/admin` explains it needs setup.

1. Cloudflare dashboard → **Storage & Databases → KV** → **Create a
   namespace** → name it `industrial-buddy-filters` → copy its **ID**.
2. In `wrangler.toml`, uncomment the `[[kv_namespaces]]` block and paste the ID.
3. Commit/push (auto-deploys), or `npx wrangler deploy`.

The seed library in [`src/filters.js`](src/filters.js) (`DEFAULT_FILTERS`) is
what the catalog shows before the first `/admin` edit; the **Electric
Furnace · 1 Conv** JSON is the real one from the channel, the other five are
placeholders — easiest is to just `/admin remove` them and `/admin add` your
tested versions once storage is live.

## Limits worth knowing

- A select menu holds max **25 options**; per-category views keep you under it.
- Ephemeral replies cap at 2000 chars; the bot auto-compacts JSON if a
  filter's pretty-printed form would exceed that.
- Bots can't write to the clipboard — the code-block copy button is the
  Discord-native equivalent.
