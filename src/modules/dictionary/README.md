# Dictionary

What receipt wordings mean (`mlk` is Milk, `Gain` is laundry detergent, `slippers` are never used up), in a database table that grows from what users confirm and that a person or an agent can edit. **Read [docs/dictionary.md](../../../docs/dictionary.md)**: it explains what is in it, how it learns, and how to add to it.

## The boundary

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | ingestion, `scripts/dictionary.ts` | `loadDictionary`, `learnFromSave`, `addItem/Term/Brand/Code`, `setEntryStatus`, `listEntries`, `exportDictionary`, `importDictionary`, `seedDictionary` |
| [`client.ts`](client.ts) (pure, no database) | receipt reading, tests | `createIdentifier` (the matcher), the data shapes, the starter list |

ESLint fails if code outside this folder imports anything deeper. Only [`store.ts`](store.ts) has SQL.

## Map

| File | Job |
|---|---|
| [`engine.ts`](engine.ts) | The matcher over dictionary data. Pure |
| [`learn.ts`](learn.ts) | What a saved line teaches, and when a learned entry becomes active. Pure |
| [`seed.ts`](seed.ts) | The starter list. Initialises an empty table; tests use it |
| [`store.ts`](store.ts) | Reads and writes the `dictionary_*` tables |
| [`index.ts`](index.ts) | Loads (and briefly keeps) the live dictionary, applies learning, the edits |
| [`types.ts`](types.ts) | `DictionaryData`, `CatalogItem`, `Identified` |
