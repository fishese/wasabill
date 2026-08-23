# Wasabill Saved & Shareable Menus — Implementation Plan

Status: design handoff only. No app code changes are included in this branch.

## Goal

Add a reusable menu layer to Wasabill so a user can:

- save a restaurant menu for later use;
- save a seasonal/specials-only set;
- load a saved menu into an offline bill;
- select a saved menu while creating a shared room;
- share a menu with another person without requiring accounts;
- import a shared menu without silently overwriting the current bill.

The feature should reuse Wasabill's existing `settings.standard` / `settings.seasonal` shape and current Supabase room/menu infrastructure rather than redesigning tallying or realtime sync.

---

## Existing architecture to preserve

Current offline state:

- `settings.standard[]`
- `settings.seasonal[]`
- `settings.serviceCharge`
- `settings.rounding`
- `settings.discount`
- `tally.people[]`
- settings/tally persisted in `localStorage`

Current shared-room state:

- bill settings stored in `bills`;
- menu rows stored in `menu_items`;
- tallying stored as append-only `plate_events`;
- room creation currently seeds the six `DEFAULT_STANDARD` dishes followed by any seasonal dishes entered in the room-creation panel;
- `applySnapshot()` converts remote `menu_items` back into the same client `settings.standard` / `settings.seasonal` arrays used by the rest of the UI.

This means the saved-menu feature should remain a source for populating menu state. Once a bill is active, existing tally/render/realtime code should not care whether the menu came from defaults, manual entry, or a saved preset.

---

# 1. Core concept: Saved Menu

Use one saved-menu model with two modes.

### Full menu

Represents a restaurant/menu configuration.

Examples:

- `Sushiro HK`
- `Kura Sushi`
- `Sushiro — Summer 2026`

A full menu contains standard-dish price overrides plus seasonal/special dishes.

Applying it replaces the current menu configuration.

### Seasonal set

Represents additions only.

Examples:

- `Summer 2026 Specials`
- `Uni Fair`

A seasonal set contains seasonal/special items only.

Applying it adds/updates those dishes without changing standard plate prices.

---

# 2. Proposed persisted format

Use a versioned, self-contained schema from day one.

```js
{
  wasabillMenu: 1,
  id: "menu_<local-generated-id>",
  type: "full",                 // "full" | "seasonal"
  name: "Sushiro — Summer 2026",
  restaurant: "Sushiro",       // optional
  createdAt: "2026-08-23T...Z",
  updatedAt: "2026-08-23T...Z",

  standard: [
    { id: "red", price: 12 },
    { id: "silver", price: 17 },
    { id: "gold", price: 22 },
    { id: "black", price: 27 },
    { id: "sundae", price: 27 },
    { id: "discount", price: 10 }
  ],

  seasonal: [
    { name: "Special Uni", price: 32 },
    { name: "Fatty Tuna", price: 27 }
  ]
}
```

For a `seasonal` preset, `standard` should be omitted or empty.

## Why standard entries should only store ID + price

Do not duplicate built-in icon/color/topping/translated-name metadata into saved presets.

The app already knows what canonical IDs such as `red`, `silver`, `gold`, etc. represent through `DEFAULT_STANDARD` and i18n. A preset should only supply the values that differ between menus.

Benefits:

- much smaller shared payloads;
- built-in translations continue to work;
- future icon/art updates apply automatically;
- avoids stale duplicated metadata.

## Seasonal item IDs

Do not preserve runtime seasonal `dish_key` values in the portable format.

Portable seasonal entries should store only user-facing data such as `name` + `price` for v1. Generate fresh `seas_...` dish keys when applying/seeding them into an active bill.

This avoids collisions with existing runtime dish IDs.

---

# 3. Local storage

Add a dedicated localStorage key, for example:

```js
const LS_MENUS = 'kaiten_menus_v1';
```

Stored value:

```js
[
  { /* SavedMenu */ },
  { /* SavedMenu */ }
]
```

No IndexedDB is necessary for v1. These records are very small and Wasabill already uses localStorage for local persistent state.

Suggested helpers:

```js
loadSavedMenus()
saveSavedMenus(menus)
createSavedMenuFromCurrent(...)
updateSavedMenu(id, ...)
deleteSavedMenu(id)
findSavedMenu(id)
```

Keep saved menu persistence independent from `saveSettings()` and `saveTally()`.

---

# 4. Snapshot behaviour

Saved menus should be snapshots, not live-linked objects.

Loading a saved menu and then changing a price during dinner must NOT silently modify the saved menu.

If the user wants to preserve the latest values, expose an explicit action:

- `Update saved menu from current menu`

This avoids surprising persistent changes and makes duplicate/variant menus straightforward.

---

# 5. What belongs to a menu vs a bill

A saved menu should contain:

- standard dish prices;
- seasonal/special dish names + prices;
- optional menu metadata such as restaurant/name.

A saved menu should NOT contain:

- diners;
- tallies/counts;
- current room code;
- service-charge toggle;
- discount settings;
- rounding setting;
- language;
- history.

Those remain bill/session/device settings.

Reason: the same restaurant menu may be used for different groups and different bill conditions.

---

# 6. Settings UI

Add a compact menu-management section in Settings.

Suggested concept:

```text
Menu
Current: Sushiro — Summer 2026
[ Save menu ] [ My menus ]
```

`My menus` opens a modal/panel with saved presets.

Suggested rows:

```text
Sushiro — Regular
6 plates + 3 specials
[Use] [Share] [⋯]

Summer Specials
7 specials
[Add] [Share] [⋯]
```

For the `⋯` menu:

- Rename
- Duplicate
- Update from current menu
- Export file
- Delete

For a full menu, primary action is `Use`.

For a seasonal set, primary action is `Add`.

Keep the first implementation compact; no need for restaurant logos/images/categories in v1.

---

# 7. Save flow

`Save menu` should open a small dialog/panel.

Fields:

- Name — required
- Restaurant — optional
- Save as:
  - Full menu
  - Seasonal specials only

If saving a full menu:

- serialize current standard prices;
- serialize current seasonal dishes.

If saving seasonal-only:

- serialize only current seasonal dishes.

If there are no seasonal items and seasonal-only is selected, disable save or show a clear message.

---

# 8. Applying a full menu

A full preset should replace:

- standard dish prices;
- seasonal items.

It should preserve:

- diners;
- bill settings;
- language;
- local history.

## Critical safety rule: existing tallies

Do not allow a full-menu replacement to silently reinterpret an existing tally.

If any current person has non-zero counts, `Use menu` should prompt the user to start a new bill with that menu rather than mutating IDs underneath existing counts.

Recommended behaviour offline:

```text
This bill already has items tallied.
Start a new bill with “Sushiro — Summer 2026”?
```

On confirmation:

1. clear tally counts/new bill;
2. apply menu;
3. preserve bill settings unless the user separately changes them.

Avoid trying to remap existing counts across different menus in v1.

---

# 9. Applying a seasonal set

Seasonal presets can safely be additive.

Action label:

- `Add to current menu`

Rules:

1. Existing standard prices stay unchanged.
2. Each incoming seasonal dish is matched against an existing seasonal dish by normalized display name.
3. If no match exists, add it with a new generated seasonal ID.
4. If a match exists, update the existing dish price rather than creating an obvious duplicate.
5. Do not delete unrelated existing seasonal dishes.

Suggested normalization for duplicate detection:

- trim leading/trailing whitespace;
- collapse repeated spaces;
- compare case-insensitively for Latin text;
- otherwise retain/display original text.

Do NOT use fuzzy matching in v1. Exact normalized-name matching is predictable.

If an existing matched dish already has non-zero tally counts, updating its price is consistent with Wasabill's existing live-price model: totals recalculate against the live price.

---

# 10. New shared room integration

The room-creation flow is the cleanest integration point.

Current conceptual flow:

```text
Create bill
→ seed DEFAULT_STANDARD
→ add seasonal items entered in create panel
→ re-fetch room
→ enter room
```

Change it to:

```text
Choose menu source
→ Default menu OR Saved full menu
→ populate editable create-room preview
→ Create bill
→ seed selected standard prices
→ seed selected seasonal dishes
→ re-fetch room
→ enter room
```

## UI

At the top of `Start a new bill`, add:

```text
Menu
[ Default menu ▾ ]
```

Options:

- Default menu
- each saved full menu

When a saved menu is selected:

- populate the create panel's seasonal items from that preset;
- use its standard price overrides for room seeding;
- still allow one-off edits before creating the room.

Do not make the active shared room depend on the local preset after creation. Once seeded, the room menu is ordinary Supabase `menu_items` state.

## Seasonal saved sets in room creation

Optionally expose `Add saved specials` from the seasonal editor so a seasonal-only preset can be layered onto the selected full/default menu before room creation.

This can be phase 2 if keeping the first UI small is preferable.

---

# 11. Sharing design: no permanent server storage in v1

Do NOT add permanent shared-menu tables to Supabase for the first implementation.

Reasons:

- Wasabill has no account system;
- persistent public menu storage immediately creates ownership/deletion/cleanup questions;
- it creates abuse/spam/storage concerns unrelated to the current temporary-room model;
- the menu payload is small enough to be transported directly.

Use self-contained share links instead.

---

# 12. Shared-link format

Recommended URL shape:

```text
https://<wasabill-host>/#menu=<encoded-payload>
```

Use the URL fragment (`#...`) rather than query parameters.

Benefits:

- fragment contents are handled client-side;
- they are not normally sent to the web server in the HTTP request;
- works on static GitHub Pages hosting;
- no backend endpoint is required.

## Payload pipeline

Conceptually:

```text
SavedMenu portable object
→ JSON.stringify
→ compress
→ URL-safe encoding
→ #menu=...
```

Recommended implementation choices:

- use a small browser-compatible compression library already suitable for a static single-page app, OR
- initially use UTF-8 + URL-safe base64 if actual generated menu URLs remain acceptably short.

Measure realistic payloads before adding a library solely for compression.

Do not invent a hand-rolled compression format.

## Portable object

Strip local-only fields from the shared payload where appropriate.

For example, local `id`, `createdAt`, and `updatedAt` are not important to the recipient. A compact shared object could be:

```js
{
  wasabillMenu: 1,
  type: "full",
  name: "Sushiro — Summer 2026",
  restaurant: "Sushiro",
  standard: [...],
  seasonal: [...]
}
```

---

# 13. Share UI

From `My menus`, `Share` should build a link and provide:

- native Web Share API when available;
- Copy link fallback.

Suggested share text:

```text
🍣 Sushiro — Summer 2026
Open this menu in Wasabill
<link>
```

Do not require the recipient to install the PWA.

---

# 14. Incoming shared menu flow

Never immediately overwrite current state just because the page URL contains `#menu=`.

At startup:

1. detect shared-menu fragment;
2. decode;
3. validate schema/version/content;
4. show an import preview modal;
5. wait for explicit user action.

Example full-menu preview:

```text
Sushiro — Summer 2026
6 standard dishes · 8 seasonal specials

[ Use menu ]
[ Save to My Menus ]
[ Cancel ]
```

Example seasonal-set preview:

```text
Summer Specials
8 seasonal dishes

[ Add to current menu ]
[ Save to My Menus ]
[ Cancel ]
```

If current tallies exist and the incoming object is a full menu, apply the same safety rule as loading a local full preset: prompt to start a new bill rather than mutate a live tally.

After successful import, optionally remove the `#menu=...` fragment via `history.replaceState()` so reloading does not repeatedly reopen the import modal.

---

# 15. Validation requirements

Treat shared links/files as untrusted input.

Implement a single validator used by:

- shared URL import;
- JSON file import;
- saved local menu loading/migration where useful.

For version 1 validate at minimum:

- root is an object;
- `wasabillMenu === 1`;
- `type` is `full` or `seasonal`;
- name is a reasonably bounded string;
- restaurant, if supplied, is a bounded string;
- `standard` is an array when required;
- only recognized built-in standard IDs are accepted in v1;
- standard price is finite and `>= 0`;
- seasonal is an array;
- seasonal names are non-empty bounded strings;
- seasonal price is finite and `>= 0`;
- cap number of entries to a sane value;
- ignore/reject unexpected huge fields rather than rendering arbitrary content.

All display text must continue to be inserted safely using `textContent` or the existing escaping helpers, never raw imported HTML.

Suggested conservative caps for v1:

- menu name: 100 characters;
- restaurant: 100 characters;
- seasonal item name: 120 characters;
- seasonal items: 100 maximum.

These can be adjusted but there should be explicit limits.

---

# 16. File export/import fallback

Use the same portable schema for file sharing/backup.

Suggested extension:

```text
.wasabill-menu.json
```

Example filename:

```text
Sushiro-Summer-2026.wasabill-menu.json
```

Actions:

- Export menu
- Import menu file

File import should go through the same validation + preview flow as a shared link.

The URL format remains the primary convenient sharing mechanism; file import is a fallback for very large menus, archiving, or manual transfer.

---

# 17. Versioning and migrations

`wasabillMenu: 1` is mandatory.

Do not rely on `LS_MENUS` version alone because shared links/files need their own portable format version.

Future versions may add fields such as:

- currency;
- custom standard categories;
- custom colors/icons;
- tax/service models;
- notes;
- validity dates;
- categories;
- restaurant metadata.

Importer strategy:

```js
switch (obj.wasabillMenu) {
  case 1:
    return validateAndNormalizeMenuV1(obj);
  default:
    throw UnsupportedMenuVersion;
}
```

Keep normalization separate from rendering/applying.

---

# 18. Custom restaurant plate schemes — intentionally out of scope for v1

Wasabill currently has six canonical built-in standard items:

- red
- silver
- gold
- black
- sundae
- discount

The first saved-menu implementation should support:

> same built-in Wasabill standard item types + different prices + different specials

Do NOT turn v1 into a redesign supporting arbitrary standard plate/category structures.

However, avoid designing the portable schema in a way that makes future custom categories impossible.

For example, keeping `standard` as an array of objects rather than six fixed top-level properties leaves room for a later schema version with custom IDs/types.

Future feature, separate project:

- restaurant-specific plate colors/categories;
- arbitrary standard menu items;
- icon configuration;
- non-kaiten restaurants.

---

# 19. Suggested implementation phases

## Phase 1 — data model + local management

1. Add `LS_MENUS`.
2. Add SavedMenu v1 serializer/validator/normalizer.
3. Add save/load/update/delete local helpers.
4. Add Settings `Save menu` and `My menus` UI.
5. Implement full-menu apply with tally safety check.
6. Implement seasonal-set additive merge.

Acceptance criteria:

- user can save multiple named full menus;
- user can save seasonal-only sets;
- reload/PWA restart preserves them;
- loading a full menu with no tally correctly updates menu/prices;
- an existing tally cannot be silently reinterpreted;
- seasonal presets merge predictably.

## Phase 2 — shared room creation

1. Add menu selector to new-room panel.
2. Seed standard items from selected menu rather than unconditional `DEFAULT_STANDARD` price values.
3. Seed seasonal items from the editable selected-menu snapshot.
4. Ensure room state after creation remains ordinary `menu_items` state.

Acceptance criteria:

- two devices joining a room see identical selected saved-menu prices/items;
- local preset is not required after room creation;
- realtime behaviour is unchanged.

## Phase 3 — URL sharing

1. Add portable shared serialization.
2. Add `#menu=` generation.
3. Add Web Share + Copy Link.
4. Add startup fragment decoding.
5. Add validated import preview.
6. Remove fragment after accepted/cancelled import as appropriate.

Acceptance criteria:

- share link works in another browser/device;
- recipient can preview before applying;
- recipient can save without applying;
- malformed payload fails safely;
- unsupported versions fail clearly;
- no server-side menu storage is required.

## Phase 4 — file import/export

1. Export portable JSON.
2. Import `.wasabill-menu.json` / JSON.
3. Reuse same validation + preview pipeline.

---

# 20. Functions/modules suggested for the current single-file structure

Wasabill is currently a single-file vanilla JS app, so keep the implementation organized with clearly marked sections even if it remains in `index.html`.

Suggested function families:

```js
/* ── saved menus: persistence ── */
loadSavedMenus()
saveSavedMenus()
generateMenuLocalId()

/* ── saved menus: schema ── */
serializeCurrentMenu(type, metadata)
normalizeMenuV1(obj)
validateMenuV1(obj)
createPortableMenu(menu)

/* ── saved menus: application ── */
hasAnyTallies()
applyFullMenu(menu)
applySeasonalSet(menu)
mergeSeasonalItems(existing, incoming)

/* ── saved menus: sharing ── */
encodeSharedMenu(menu)
decodeSharedMenu(encoded)
buildMenuShareUrl(menu)
handleIncomingMenuFragment()

/* ── saved menus: UI ── */
openSaveMenuPanel()
openSavedMenusPanel()
renderSavedMenus()
openMenuImportPreview(menu, source)
```

Avoid mixing serialization logic directly into DOM handlers.

---

# 21. Interaction with existing online mode

Important distinction:

### Before room creation

Saved menus are local presets and may be selected as the source for a new room.

### After entering a shared room

Supabase `menu_items` is the live source of truth.

Do not attempt to keep a saved local menu synchronized with the active room.

If later adding `Save this room's menu`, create a snapshot from current `settings` and store it locally, exactly like saving any current menu.

This is a useful optional button but does not need to be part of the first implementation.

---

# 22. PWA/offline considerations

The local menu-management feature must work completely offline.

Shared links can be decoded offline if the Wasabill PWA is already installed/cached and opened with the fragment.

File import/export should also work offline.

Room creation still requires network/Supabase as it does today.

If a compression dependency is added for shared URLs, ensure it is available offline through the existing service-worker caching strategy rather than becoming a new network-only runtime dependency.

Prefer either:

- bundled/inlined tiny code; or
- explicitly cached static dependency.

Do not introduce a share-link feature that breaks when CDN access is unavailable after PWA installation.

---

# 23. Testing checklist

## Local persistence

- save full menu;
- save seasonal set;
- reload browser;
- reopen installed PWA;
- rename preset;
- duplicate preset;
- update preset;
- delete preset;
- malformed localStorage does not break startup.

## Full-menu application

- apply with zero tallies;
- correct standard prices;
- correct seasonal dishes;
- old seasonal dishes replaced;
- bill settings remain unchanged;
- existing non-zero tally triggers safety flow;
- no stale count keys remain after explicit new-bill/menu change.

## Seasonal-set application

- add to empty seasonal list;
- add alongside unrelated existing dishes;
- matching normalized name updates price;
- duplicate obvious names not produced;
- unrelated existing items stay;
- tallied existing seasonal item keeps count when its price changes.

## Room creation

- default menu remains identical to current behaviour;
- saved full menu seeds all correct prices;
- saved seasonal items appear on every device;
- room refresh/rejoin reconstructs menu correctly;
- price edits still realtime-sync;
- menu preset is not referenced after creation.

## Shared URLs

- English names;
- Traditional Chinese names;
- Japanese names;
- emoji/unicode names;
- spaces and punctuation;
- empty optional restaurant field;
- malformed encoding;
- invalid JSON;
- unsupported version;
- invalid/negative/NaN price;
- excessive item counts/field lengths;
- opening a full menu while a tally exists;
- save imported menu without applying;
- apply imported menu without saving.

## File import/export

- round-trip exported menu;
- file from another device;
- malformed JSON;
- valid JSON that is not a Wasabill menu;
- unsupported future version.

## PWA

- existing service worker upgrade;
- offline menu list;
- offline save/load;
- offline export/import;
- cached decoder/compression dependency if used.

---

# 24. Non-goals for this project

Do not include unless separately requested:

- accounts/login;
- cloud synchronization of a user's saved-menu library;
- public menu directory;
- server-side permanent menu hosting;
- ratings/comments/community menus;
- restaurant-logo/image storage;
- arbitrary custom standard item types;
- automatic web scraping of restaurant menus;
- fuzzy duplicate detection;
- collaborative editing of a saved preset itself.

---

# 25. Recommended build order for Codex

Start here when implementing:

1. Read current `index.html`, especially:
   - `DEFAULT_STANDARD`;
   - `loadSettings()` / `saveSettings()`;
   - `renderSettings()`;
   - seasonal add/edit/delete handlers;
   - create-room panel state and `submitCreatePanel()`;
   - `applySnapshot()`;
   - service worker caching.
2. Implement pure schema/normalization helpers first.
3. Add local SavedMenu persistence.
4. Add UI only after the data helpers have unit-testable behaviour.
5. Implement menu application with the `hasAnyTallies()` guard.
6. Integrate the saved full-menu snapshot into room creation without changing active-room semantics.
7. Add sharing last, reusing the exact same portable validator used by file import.
8. Test existing offline and multiplayer paths for regressions before merging.

Important implementation constraint:

> Keep the existing canonical bill/tally/realtime data shapes intact. Saved menus are presets/snapshots that populate those shapes; they are not a new live state system.

---

# 26. Suggested first implementation branch

When coding begins, create a new implementation branch from the latest default branch rather than building directly on this documentation branch if the doc PR has already been merged.

Suggested name:

```text
feature/saved-shareable-menus
```

If this documentation branch is not yet merged, either merge it first or branch implementation from it so this handoff remains available in-tree.

---

## Final design decisions captured here

- One `SavedMenu` concept with `full` and `seasonal` types.
- Saved menus are local snapshots, not live-linked state.
- Use localStorage for the saved library in v1.
- Full menus replace menu configuration but do not silently mutate an active tally.
- Seasonal sets merge additively by normalized exact name.
- Bill settings are not stored in menus.
- Saved full menus can seed shared-room creation.
- Once the room exists, Supabase `menu_items` remains the only live menu source.
- Sharing uses self-contained URL fragments first, not permanent Supabase menu storage.
- Incoming links always show a validated preview before applying.
- JSON file export/import uses the same portable schema as URL sharing.
- Portable format starts versioned at `wasabillMenu: 1`.
- Arbitrary custom restaurant plate schemes are explicitly deferred to a future schema/version.
