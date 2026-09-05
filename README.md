# Wasabill

A bilingual (Cantonese/English) sushi bill splitter with offline bills, shared
Supabase rooms, and saved/shareable menus.

Live site: [wasabill.fishese.cc](https://wasabill.fishese.cc/).

## Saved menus

- **Full menu:** the standard plate prices plus seasonal items. Select it when
  starting a new bill, or apply it offline (clearing existing counts after confirmation).
  Replacing a full menu in an active shared room is deliberately blocked.
- **Seasonal set:** additional special dishes. In **Start New Bill**, use
  **Add saved specials**, beside the full-menu selector. Select the full menu
  first, then layer on one or more seasonal sets. Selecting a different full menu
  resets the seasonal list to that menu's contents.
- Reapplying a seasonal set updates prices for matching names (ignoring case and
  repeated whitespace) rather than adding duplicates. Other dishes remain unchanged.
  The saved preset itself is not modified.
- Completed name/item drafts are captured when leaving their fields; the Add
  buttons remain available to commit a draft and focus the next blank input.
- Saved menus are local to this browser/device. Share links embed a menu snapshot
  in the URL fragment; JSON import/export provides a portable backup. Neither
  contains diner identities, bill counts, or runtime room IDs.
- Applying seasonal sets inside a shared room waits for server acknowledgements.
  A multi-item apply is **not a database transaction**: if a later item fails,
  earlier acknowledged changes remain. Same-device applications are serialized;
  simultaneous applications from different devices are not globally serialized.

## Development and checks

`index.html` contains the client, including CSS and JavaScript. There is no build
step or dependency installation required for the regression suite. Use Node.js
22 or later:

```sh
node --test tests/regressions.test.cjs
git diff --check
```

The tests execute the actual inline application functions with controlled DOM,
storage, network, and service-worker doubles. They also parse the entire inline
script, including event wiring. They do not replace browser rendering or live
Supabase multi-device tests. See [the September review](docs/review-2026-09-05.md)
for covered cases, open risks, and a manual test checklist.

Serve the repository with a local static HTTP server for browser testing; use
localhost or HTTPS for service-worker/clipboard support. GitHub Pages serves
`master` from the repository root. Bump `CACHE` in `sw.js` when changing shipped
client assets; the current version is `sushi-split-v18`.

## Backend and privacy

The SQL setup files are in `supabase/`, numbered in execution order. This release
does not change the database schema or RPC contracts. Saved menus do not require
a backend migration.

**The existing backend is not private storage.** The checked-in RLS policies allow
anonymous reads of all four tables, not just the room identified by a link. The
public RPCs also do not establish authenticated membership. Do not enter sensitive
personal information. Private rooms require a separate authorization design and
database migration, not just a harder-to-guess room code.

The original architecture is documented in
[the database plan](kaiten_sushi_database_plan_v11.md). For current validation
results and limitations, use the September review linked above.
