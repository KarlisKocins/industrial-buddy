// Filter library defaults + helpers.
//
// Filters live in Cloudflare KV once storage is set up (admins manage them
// in Discord via /admin add and /admin remove). The DEFAULT_FILTERS below
// are the seed library, used until the first KV write — and they're what
// the first admin edit starts from, so seeded entries can be deleted too.
//
// `files` holds the actual game JSON — one entry per conveyor, in the exact
// format Rust's "Paste (JSON)" button expects on an Industrial Conveyor.

// Shorthand for one conveyor filter slot.
const slot = (TargetItemName, MaxAmountInOutput = 0) => ({
  TargetCategory: null,
  MaxAmountInOutput,
  BufferAmount: 0,
  MinAmountInInput: 0,
  IsBlueprint: false,
  TargetItemName,
});

export const CATEGORIES = ["All", "Furnace", "Refinery", "Recycler"];

export const CATEGORY_EMOJI = {
  Furnace: "🔥",
  Refinery: "🛢️",
  Recycler: "♻️",
};

export const DEFAULT_FILTERS = [
  {
    id: "efurnace-1c",
    emoji: "🔥",
    name: "Electric Furnace · 1 Conv",
    category: "Furnace",
    items: "metal.ore · sulfur.ore · hq",
    blurb:
      "Smelting input filter — feeds ore into a single electric furnace and blocks refined output from looping back.",
    files: [
      {
        label: "Conveyor",
        json: [
          slot("metal.ore", 5),
          slot("metal.fragments"),
          slot("sulfur"),
          slot("sulfur.ore", 6),
          slot("hq.metal.ore", 4),
          slot("metal.refined"),
        ],
      },
    ],
  },
  {
    id: "efurnace-2c",
    emoji: "🔥",
    name: "Electric Furnace · 2 Conv (I/O)",
    category: "Furnace",
    items: "ore in · refined out",
    blurb:
      "Two-conveyor setup: conveyor 1 feeds ore in, conveyor 2 pulls refined output to storage.",
    files: [
      {
        label: "Conveyor 1 — ore in",
        json: [slot("metal.ore", 5), slot("sulfur.ore", 6), slot("hq.metal.ore", 4)],
      },
      {
        label: "Conveyor 2 — refined out",
        json: [slot("metal.fragments"), slot("sulfur"), slot("metal.refined")],
      },
    ],
  },
  {
    id: "furnace-1c",
    emoji: "🏔️",
    name: "Regular Furnace · 1/2 Conv",
    category: "Furnace",
    items: "metal.ore · sulfur.ore · wood",
    blurb: "Basic furnace feed — ore plus wood for fuel.",
    files: [
      {
        label: "Conveyor",
        json: [slot("metal.ore", 5), slot("sulfur.ore", 6), slot("wood", 10)],
      },
    ],
  },
  {
    id: "refinery-1c",
    emoji: "🛢️",
    name: "Oil Refinery · 1/2 Conv",
    category: "Refinery",
    items: "crude.oil · wood",
    blurb: "Feeds crude oil and wood fuel into the refinery.",
    files: [
      {
        label: "Conveyor",
        json: [slot("crude.oil", 6), slot("wood", 10)],
      },
    ],
  },
  {
    id: "lfurnace-1c",
    emoji: "🏭",
    name: "Large Furnace · 1/2 Conv",
    category: "Furnace",
    items: "metal.ore · hq.metal.ore · wood",
    blurb: "High-volume smelting feed for the large furnace.",
    files: [
      {
        label: "Conveyor",
        json: [slot("metal.ore", 15), slot("hq.metal.ore", 5), slot("wood", 30)],
      },
    ],
  },
  {
    id: "recycler-sort",
    emoji: "♻️",
    name: "Recycler · Scrap Sort",
    category: "Recycler",
    items: "components · scrap",
    blurb: "Routes common components into the recycler and scrap out to storage.",
    files: [
      {
        label: "Conveyor",
        json: [slot("gears", 5), slot("metalpipe", 5), slot("sheetmetal", 5), slot("metalspring", 5)],
      },
    ],
  },
];

export const findFilter = (filters, id) => filters.find((f) => f.id === id);

export const slotCount = (f) => f.files.reduce((n, file) => n + file.json.length, 0);

// Search across name, category, machine keywords, and item shortnames.
// All terms must match when possible; otherwise fall back to any-term match
// so broad queries like "sulfur refinery" still surface both machines.
export function searchFilters(filters, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (f) =>
    [
      f.name,
      f.category,
      f.items,
      f.blurb,
      ...f.files.flatMap((file) => file.json.map((s) => s.TargetItemName)),
    ]
      .join(" ")
      .toLowerCase();

  const all = filters.filter((f) => terms.every((t) => haystack(f).includes(t)));
  if (all.length > 0 || terms.length < 2) return all;
  return filters.filter((f) => terms.some((t) => haystack(f).includes(t)));
}

// --- Validation for admin-submitted filters -------------------------------

// Normalize one slot object from admin-pasted JSON; throws on bad shape.
export function normalizeSlot(raw, where) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: each slot must be an object`);
  }
  if (typeof raw.TargetItemName !== "string" || raw.TargetItemName.length === 0) {
    throw new Error(`${where}: missing "TargetItemName"`);
  }
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    TargetCategory: raw.TargetCategory ?? null,
    MaxAmountInOutput: num(raw.MaxAmountInOutput),
    BufferAmount: num(raw.BufferAmount),
    MinAmountInInput: num(raw.MinAmountInInput),
    IsBlueprint: raw.IsBlueprint === true,
    TargetItemName: raw.TargetItemName,
  };
}

// Parse admin-pasted JSON into `files`. Accepts either a plain array of
// slots (single conveyor), or an object mapping labels to slot arrays for
// multi-conveyor setups: {"Conveyor 1 — ore in": [...], "Conveyor 2": [...]}
export function parseFilterJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e.message}`);
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error("The filter array is empty.");
    return [{ label: "Conveyor", json: parsed.map((s, i) => normalizeSlot(s, `slot ${i + 1}`)) }];
  }

  if (typeof parsed === "object" && parsed !== null) {
    const entries = Object.entries(parsed);
    if (entries.length === 0) throw new Error("No conveyors found in the JSON object.");
    return entries.map(([label, arr]) => {
      if (!Array.isArray(arr)) throw new Error(`"${label}" must be an array of slots`);
      return { label, json: arr.map((s, i) => normalizeSlot(s, `"${label}" slot ${i + 1}`)) };
    });
  }

  throw new Error("Expected a JSON array of slots, or an object of labelled conveyor arrays.");
}

// Unique, URL-safe id from a filter name.
export function makeId(filters, name) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "filter";
  let id = base;
  for (let n = 2; findFilter(filters, id); n++) id = `${base}-${n}`;
  return id;
}
