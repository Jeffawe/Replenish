# The dictionary

What receipt wordings mean, in one place. It turns `GV WHL MLK GL` into **Milk** by **Great Value**, knows that `slippers` are never used up, and learns from what you confirm. It lives in the database, so it grows, and a person or an agent can edit it at any time.

## What it is, and what it isn't

There are two layers of matching knowledge, and they are different on purpose:

| Layer | Says | Belongs to | Where |
|---|---|---|---|
| **Your wordings and codes** | "`GV WHL MLK GL` is *my* Milk product" | one user | `product_aliases` (learned when you save a receipt, moved when you merge products) |
| **The dictionary** | "`mlk` means the kind of thing *Milk*" | everyone | the `dictionary_*` tables, this document |

Matching tries your own layer first, then the dictionary. The dictionary never decides which of *your* products a line is; it only says what kind of thing the line is, and that helps find your product (or name a new one).

## What is in it

| Kind | Example | Used for |
|---|---|---|
| **Item** | `Milk`, category Groceries, counted in `gallon` | The name a new product gets, and its unit. A **durable** item (`Clothing`) is something that is never used up: lines for it start unticked. |
| **Term** | `"mlk"` means Milk | Recognising an item in a line. Matched as whole words, singular or plural (`egg` finds `EGGS`). The longest term wins (`almond milk` beats `milk`). |
| **Brand** | `Gain` (`gain`) makes Laundry Detergent | Pulling the brand out of the line. If a brand makes only one thing, the line is that thing even with no other word (`GAIN LFE`). |
| **Code** | Walmart `007874235186` means Milk | A store's own number for an item (a UPC, a Costco item number). The most reliable thing on a line. |

Every entry has:
- a **status**: `active` (used), `pending` (waiting), or `off` (never used, never re-learned);
- a **source**: `seed` (the starter list), `learned`, `manual` (a person or agent), or `lookup` (reserved for a UPC database);
- for learned entries, the receipts that confirmed it.

## How it grows

When you save a receipt, every line you saved teaches the dictionary what your choice showed. The rules are in [learn.ts](../src/modules/dictionary/learn.ts), all in one place:

- **A new wording for an item the dictionary already knows** (you matched `MOOMOO NECTAR` to Milk) is added as a **pending** term. It becomes **active** once a *second, separate receipt* confirms it. Saving the same receipt twice counts once.
- **A wording confirmed for two different items** (`CHS` for cheese and for chips) is flagged as a conflict and **stays pending until a person decides**. It is never activated automatically.
- **A store's code** works the same way as a wording.
- **A thing the dictionary has never heard of**, when saving the line made a new product (`Blackberries`), is proposed as a new **item**. A new item **always waits for approval** by a person; nothing makes one active on its own. Approving an item also activates the wordings learned for it.
- **Something switched off stays off.** It is not re-learned.
- It only learns from products the dictionary has an item for, or new products created by the line. A custom product it can't place (`Zorbo`) is learned only in your own layer.

Matching only ever uses **active** entries. A pending entry has no effect.

## Two helpers for lines nothing else can place

After the user's own products and the dictionary have had their say, two helpers look at the lines that are still unplaced. **Both only suggest**: a product they lead to is shown as "Check match", and nothing they say is trusted until you confirm it (and the dictionary's own learning rules decide what to keep).

### Product-code lookup (Open Food Facts)
If a line prints a UPC, we ask [Open Food Facts](https://world.openfoodfacts.org) (a free, community product database) what it is, and read the answer through the dictionary: "Great Value Distilled water" becomes **Water**, brand Great Value. If the name doesn't help, its categories are tried, most specific first.

- **Only the code is sent**, never anything about the user. Each code is asked about once, ever: answers (and "unknown") are kept in `code_lookups`; an unknown code is asked again after 30 days.
- **Walmart prints its UPCs without the final check digit**, padded with a leading zero (`007874235191` is the barcode `078742351919`). The lookup adds the digit. A code that is already a valid UPC is tried as printed too.
- **Be polite.** Requests carry an identifying User-Agent, at most 12 new codes are asked per receipt (the rest wait for the next one), and on a "too many requests" answer it stops and leaves them alone for two minutes. Their data is open-licensed (ODbL), which asks for credit.
- **How well it works, on 52 Walmart-style codes from test receipts:** Open Food Facts knew 16 (about 31%). Of those, 11 mapped to the right item, 3 to a wrong one (a peanut-butter bar read as Chips, bacon-cheddar beef patties as Cheese, a Ritz sandwich cracker as Peanut Butter), and 3 named nothing the dictionary knows yet (tater tots, rolls). A product's main noun comes last ("cheese **pizza**"), so the lookup takes the item named last. Because the wrong ones are possible, it only ever suggests ("Check match"), and the dictionary's own reading of the line is used first.
- Costco's item numbers and supermarket scale codes are not UPCs, so nothing public knows them: only your own saved choices can.
- Set `LOOKUP=off` to turn it off.

### The text encoder
A small sentence model (all-MiniLM-L6-v2, about 23 MB, run inside the server) finds the confirmed wording a new line is closest to in meaning. "WHL MLK HALF GAL" lands near a wording you already put on Milk, even though the letters differ.

- **It compares only against wordings that already mean something:** the user's confirmed wordings (which point at their product) and the dictionary's multi-word phrases (which point at an item). Never against bare product names: an encoder doesn't know receipt abbreviations and picks the nearest *different* word (BLACKBERRIES for Blueberries).
- **So it needs the dictionary to grow.** With few confirmed wordings, most lines find nothing, which is safe: they stay new products. Every confirmed wording and learned phrase gives it more to compare against.
- **Settings** are in `ENCODER_CONFIG` ([similar-wordings.ts](../src/modules/ingestion/receipt/similar-wordings.ts)): a line must be at least 0.75 alike, and beat the next-best product by 0.05, or nothing is suggested. In testing, 0.7 was right about 84% of the time and 0.8 right every time (a small sample), so recheck these numbers on real use.
- **First use downloads the model.** Run `npm run encoder -- warm` once on a new machine (set `ENCODER_CACHE_DIR` to choose where it's kept). If it can't run (offline on first use, no disk), it is skipped with a logged message and matching carries on without it.
- `npm run encoder -- try "SOME LINE"` shows what it would suggest. Set `ENCODER=off` to turn it off.

## Looking at it and editing it

From the project folder (`npm run dictionary -- <command>`):

```bash
# what is waiting for a decision (the review queue)
npm run dictionary -- list --pending

# look things up
npm run dictionary -- list --find gain
npm run dictionary -- list --kind brand

# add things (they are active at once)
npm run dictionary -- add-item "Blackberries" --category Groceries --unit carton
npm run dictionary -- add-term "blkbry" --item "Blackberries"
npm run dictionary -- add-brand "Gain" --terms "gain" --item "Laundry Detergent"
npm run dictionary -- add-code --store Walmart --code 007874235186 --item Milk
npm run dictionary -- add-item "Slippers" --category "Clothing" --durable

# decide on pending entries (ids are the first 8 characters shown by `list`)
npm run dictionary -- approve item "Blackberries"
npm run dictionary -- approve term 3f2a9c1b
npm run dictionary -- off term 3f2a9c1b          # a bad entry; never used or re-learned
npm run dictionary -- on term 3f2a9c1b

# back up, or edit many entries at once
npm run dictionary -- export dictionary.json
npm run dictionary -- import dictionary.json     # adds what is missing, keeps what is there
```

Changes apply within about 30 seconds in a running app (the dictionary is kept briefly in memory), and at once after a restart.

### Adding well

- **Prefer specific terms.** A short abbreviation can mislead (`chs` could be cheese or chips; `ks` is Kirkland). If a wording is ambiguous, add the longer form, or leave it to the user's own layer.
- **Name an item the way someone would track it.** `Milk`, not `Great Value Whole Milk`; the brand is stored per purchase.
- **Give a brand its item only if it makes one thing.** `Charmin` makes toilet paper; `Kraft` makes many things, so it has no item.
- **Durables** are for things that are never used up. Their name is their category.
- A term longer than the item's name wins over a shorter one, so a specific term can override a general one.

## For agents

- To see what needs attention: `list --pending`. Look at the `detail` text: a `CONFLICT` entry needs a human-style decision about which item the wording really means; a learned item needs checking that it's a real, trackable thing and named well.
- Don't approve a term you haven't checked against the receipts it came from. If unsure, leave it pending.
- After adding entries, run the receipt tests (`npm run receipt -- <photo>`; see AGENTS.md) to confirm nothing regressed.
- The starter list lives in [seed.ts](../src/modules/dictionary/seed.ts). It only initialises an empty table (`seed`) and is what the tests use, so edit the live dictionary with the commands above, not the file.

## How it is built

[src/modules/dictionary/](../src/modules/dictionary/) has two doors, like ingestion and questions:

| Door | For | Gives |
|---|---|---|
| `@/modules/dictionary` | server code | load the live dictionary, learn from a save, edit, list, export/import |
| `@/modules/dictionary/client` | pure code (receipt reading, tests) | the matcher (`createIdentifier`), the data shapes, the starter list. No database. |

| File | Job |
|---|---|
| `engine.ts` | The matcher: builds an identifier from dictionary data. Pure. |
| `learn.ts` | The learning rules above. Pure, with every number in one config. |
| `seed.ts` | The starter list, as text tables. |
| `store.ts` | The only file with SQL. |
| `index.ts` | Loads (and briefly keeps) the dictionary, applies learning, and the edits. |

The command line is [scripts/dictionary.ts](../scripts/dictionary.ts). It and a future admin page both call the same functions in `index.ts`.

Receipt reading loads the live dictionary once per photo (`loadDictionary`), and falls back to the starter list if the table is empty. The lookup is `lookup.ts` (and `lookup-item.ts`, which is pure); the encoder is in `src/modules/ingestion/receipt/` (`similar-wordings.ts` is pure and tested with a fake model, `encoder-model.ts` runs the real one).
