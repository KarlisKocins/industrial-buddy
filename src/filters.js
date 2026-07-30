// The filter library. Each filter renders as a card in the pinned catalog and
// can be copied via the select menu (ephemeral reply with the JSON code block).
//
// `files` holds the actual game JSON — one entry per conveyor, in the exact
// format Rust's "Paste (JSON)" button expects on an Industrial Conveyor.
// The "Electric Furnace · 1 Conveyor" JSON is the real one from #industrial-paste;
// the rest are seeded placeholders — replace them with your tested versions.

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

export const FILTERS = [
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

export const filterById = (id) => FILTERS.find((f) => f.id === id);

export const slotCount = (f) => f.files.reduce((n, file) => n + file.json.length, 0);

// Search across name, category, machine keywords, and item shortnames.
// All terms must match when possible; otherwise fall back to any-term match
// so broad queries like "sulfur refinery" still surface both machines.
export function searchFilters(query) {
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

  const all = FILTERS.filter((f) => terms.every((t) => haystack(f).includes(t)));
  if (all.length > 0 || terms.length < 2) return all;
  return FILTERS.filter((f) => terms.some((t) => haystack(f).includes(t)));
}
