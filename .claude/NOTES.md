# booking — Design Decisions & Session Notes

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## Standing design decisions & constraints

- **Vulnerability/review threat model: externally-exploitable only.** Only count issues reachable
  from a downstream, untrusted HTTP client hitting a service built on this package (anonymous or
  low-privilege caller). Do NOT flag developer-only footguns or purely theoretical races with no
  concrete external trigger path.
- **Commit discipline.** Don't `git commit` unless explicitly asked for *that specific piece of
  work*. An autonomous-execution/"commit as you go" approval given for one approved plan (e.g. via
  plan mode) is scoped to that plan only — it does not carry forward to later, separate requests in
  the same session, even ones that look similar in kind (a follow-up review-and-fix pass, a
  refactor, a new feature), and even after a full review-and-fix cycle with passing tests. Default
  to leaving changes staged/unstaged and saying so; only commit automatically within the exact
  scope of a plan that was explicitly approved as autonomous. If unsure whether new work falls
  inside that scope, treat it as outside and ask.
- **Commit message style: a flat list of one-line, verb-led items — no summary/title line, no
  `-`/`*` bullet markers.** This isn't just a style preference — it's dictated by how `release`
  (`@rapidrest/cli`) actually builds `CHANGELOG.md`. `collectChangelogBullets`/
  `classifyChangelogLine` (that repo's `src/lib/release.ts`) parse `git log --pretty=format:%B` and
  treat **every non-blank line of a commit's full message as its own changelog bullet** — there is
  no subject/body distinction. A conventional "short imperative subject + blank line + prose body"
  commit therefore leaks one changelog bullet per body sentence, and a `-`/`*`-prefixed line breaks
  `classifyChangelogLine`'s verb detection (it reads the line's first whitespace-delimited word as
  the verb; a leading `-` defeats that lookup and the dash leaks into the changelog text as
  `"- - Added foo"`). Correct format:
  - No separate summary/title line — if a commit needs an overview, that overview is itself just
    one more flat line, not a heading distinct from the rest.
  - No bullet-marker prefix of any kind — write bare lines.
  - Lead each line with an imperative verb where it fits: `Add`/`Fix`/`Remove` (and `-ing` forms)
    are recognized and become `Added`/`Fixed`/`Removed` entries; `Configuring`/`Converting`/
    `Refactoring`/`Updating`/etc. become `Changed`. Anything else still works, defaulting to
    `Changed` verbatim — see `CHANGELOG_VERB_REWRITES` in that repo's `src/lib/release.ts` for the
    full map.
  - A blank line before a trailing git trailer (`Co-Authored-By:`, `Signed-off-by:`, etc.) is fine
    — trailers matching `CHANGELOG_NOISE_PATTERNS` are dropped from the changelog — but nothing
    else should follow the item list.
  This mirrors JP's standing convention across his other repos; copy this exact rule verbatim into
  each sibling repo's own NOTES.md rather than paraphrasing it, since the paraphrase is what caused
  this to be gotten wrong in the first place (see `@rapidrest/cli`'s own NOTES.md, 2026-09-07 entry,
  for the full incident writeup and the `CHANGELOG_NOISE_PATTERNS` fix that accompanied it).

- **Portal resolutions are development-only. TODO before the first publish:** `package.json` links
  `@rapidmx/restapi`, `@rapidmx/react-shared` and `@rapidmx/web-client` with `portal:../<repo>` in both
  `devDependencies` and `resolutions`, because the releases that remove booking from core aren't published yet. Replace
  them with the published versions (restapi >=0.12.0, react-shared >=0.6.0, web-client >=0.6.0), `yarn install`, rerun
  everything, then publish. A portal consumes the sibling's `dist`, so build it there first when it's missing.
- **Data compatibility is the contract.** Keep the model class names (`BookingTypeMongo`, `BookingMongo`,
  `BookingTypeSQL`, `BookingSQL`, which set the entity names), index names and the `BookingType`/`Booking` `@Protect`
  uids exactly as core had them. `test/plugin.test.ts` pins all three. Renaming any of them orphans existing deployments'
  data. **One deliberate exception (2026-09-20): `bookingtype_slug` (unique on `slug`) became
  `bookingtype_mailbox_slug` (unique on `mailboxUid`+`slug`)**, because slugs are per mailbox now. It is a new name on
  purpose: MongoDB refuses `createIndex` with an existing name and different keys, so keeping the name would have failed
  at startup. A SQL schema sync drops the old index; MongoDB keeps it (see the release notes for the manual drop).
- **Entry points export only what the server should load.** `./mongo` and `./sql` export the three models and three routes;
  anything else exported there would be registered (and a job started) by the server's plugin class loader.
- **Public booking links are `/book/<mailboxUid>/<slug>`**, and the public API is `/types/:mailboxUid/:slug...`. The
  mailbox uid is the mailbox's address, so `@` is kept unencoded in links (`encodeMailboxUid` in `bookingApi.ts`). The old
  `/book/<slug>` page is gone rather than redirected: with slugs per mailbox it can't name one booking type, and
  `ReactRoute` warns on a `[slug].tsx` file beside a `[mailboxUid]` directory. `manage/` stays a literal directory, which
  the router prefers over `[mailboxUid]`.
- **A booking type may be moved to another mailbox, or deleted (singly or in bulk), only while it has no bookings** -
  all three go through `requireNoBookings()` (`update()`'s own guard, `delete()`'s since 2026-09-22, and
  `truncate()`'s since 2026-09-23 - see that date's own entry for why the bulk endpoint needed its own override
  rather than inheriting `delete()`'s fix for free). A move would strand a booking's calendar event in the old
  mailbox's calendar (the manage page resolves the mailbox from the booking, not the booking type). A delete is
  worse: it leaves the booking's `bookingTypeUid` naming nothing, and every one of `BaseBookingRoute`'s per-booking
  endpoints (`manage()`/`cancel()`/`reschedule()`/`hostListBookings()`/`setBookingLocationVideoUrl()`) re-resolves
  the booking type by that uid and 404s the instant it's gone - so a booker permanently loses the ability to view,
  cancel or reschedule a booking that is still live on the host's calendar. `truncate()` refuses the WHOLE bulk call
  (409) if ANY matched booking type has a booking, rather than silently skipping just the offending rows - a
  partial truncate would be a surprising result for a bulk "delete everything matching this filter" request.
  Disable a booking type (`enabled: false`) instead of deleting it to stop new bookings without losing this.
- **Every mailbox-scoped permission check in this package's own routes must strip trusted roles first**
  (`stripTrustedRoles()`, `src/util/RouteAccessUtils.ts`) before calling `ACLUtils.hasPermission()` - that method
  treats a trusted (`admin`) role as always-permitted, which must never apply to someone else's mailbox (see
  2026-09-23's entry). This package can't import `@rapidmx/restapi`'s own equivalent fix (`MailAccessUtils.ts`) -
  it isn't in the `@rapidmx/restapi` version this package is actually pinned to (`yarn.lock`: `0.12.0`) - so, like
  `@rapidmx/meet-plugin`, it keeps a small local copy instead. Any NEW hand-rolled mailbox-permission check added to
  this package must go through it too.
- **The booking page's avatar and banner are `BookingProfile` rows (`uid` = `mailboxUid`) plus `BlobStore` blobs**, the same
  way `Branding`'s logo is stored: raw-body upload, fixed image type list (no SVG), public GET with nosniff and a CSP
  sandbox. The public projections carry only a `version` (the blob key's random part), never a URL or key; the client builds
  the URL with `apiUrl()`. Known gap: `@MailboxScopedData()` purges the row on mailbox erasure but the host has no hook to
  delete a plugin row's blobs, so they are orphaned.
- **Uploaded images are cropped and scaled in the browser** (`apps/shared/imageResize.ts`: avatar 512x512 PNG, banner
  1600x400 JPEG), so a phone photo fits the server's 2 MiB / 5 MiB limits. The banner is cropped to 4:1 centred.
- **Every UI app directory needs its own `_layout.tsx`** (`@rapidrest/react` requires one per app dir).
  `apps/settings-booking-types/_layout.tsx` is a copy of web-client's `apps/www/_layout.tsx`, not an import of it,
  because web-client's layouts aren't part of its documented plugin UI surface.
- **No stylesheet import in the pages.** The server's plugin UI build injects a stylesheet into every plugin app's client
  entry (web-client's `app.css` plus an `@source` of the plugin package, so this package's Tailwind classes are
  generated). Importing web-client's `app.css` directly would add a second copy without the plugin's classes.
- **`BookingType.meetingTypes`/each meeting type's `locationOptions` carry server-assigned `uid`s, never
  client-chosen ones.** `BaseBookingTypeRoute.normalizeMeetingTypeUids()` mints one (`crypto.randomUUID()`) for any
  entry the caller sends without one, on both create and update, and leaves an existing uid alone so an edit-in-place
  keeps its identity. A `Booking` snapshots the meeting type's/location option's name/type/label (and, for video, the
  URL) onto itself at booking time rather than re-resolving them later, so editing or deleting a meeting type or
  location option never changes what an existing booking shows.
- **`BaseBookingRoute` has one authenticated surface: `/host...`.** Everything else on that class is deliberately
  anonymous (see its own doc comment). The two `/host` endpoints (list a booking type's bookings; set/clear a
  booking's video URL) exist only because there was no other way for a host to see or touch an individual `Booking`
  at all, and are checked against the *booking's own mailbox* ACL (`ACLUtils.hasPermission`), the same pattern
  `BaseBookingProfileRoute` uses - not against `Booking`'s own deny-all class ACL, which stays deny-all.

## Session Log

### 2026-09-15 — Created the plugin from core's booking feature

- **Source commits copied** (with `git show <commit>:<path>`, since the originals were being deleted concurrently):
  - restapi `319623229ade781575d83cb17a8561a3645f7a79`: the booking types from `src/models/types.ts`, the four models,
    `BaseBookingRoute`/`BaseBookingTypeRoute` and the Mongo/SQL routes, `BookingUtils`, and the tests
    (`bookingSecuritySuite`, `bookingTypeFolderSuite`, the four route test files, the test server routes,
    `BookingUtils.test.ts`, and the Booking cases of `test/models/{mongo,sql}.test.ts`), plus the raised `rateLimit`
    and `mail.booking.public_url` test config.
  - server `a59b6f2`: `apps/book/**` and `test/apps/book/**`, `test/apps/{setup,testUtils}.ts`. `BookRoute` stays
    the server's (its phase 3 generates plugin page routes from the manifest), so it's not copied.
  - react-shared `c215cf4`: `src/booking/bookingApi.ts` and its test.
  - web-client `efe108c`: `AvailabilityEditor.tsx`, `apps/www/settings/booking-types/**`, their tests, and
    `apps/www/_layout.tsx` with its test (for the settings app's own layout).
- **Imports rewritten:** core utils and types from `@rapidmx/restapi` (restapi `31007c9` exports them:
  `coerceCalendarEventDates`, `resolveClientIp`, `rateLimitKeyForIp`, `asEntity`, `findOrCreateWellKnownFolder`,
  `computeBusyWindows`, `buildEventIcs`, `convertLocalToUtc`, `safeDisplayName`, `MailTransport`,
  `BaseScopedChildRoute`, `MailboxScopedData`, the calendar/folder/mailbox types); `CalendarEvent`/`Folder`/`Mailbox`
  Mongo/SQL classes from `@rapidmx/restapi/{mongo,sql}`; `bookingApi` from `apps/shared/bookingApi.js` (relative);
  `SettingsShell` from `@rapidmx/web-client/shared/components/settings/layout/SettingsShell.js`.
- **Routes:** the concrete routes carry `@ApiRoute("mail/booking-types")`/`@ApiRoute("mail/bookings")` themselves (the
  server used to add them in its own subclasses), like activesync's `DeviceSyncStateRoute*`. Test server subclasses
  override them with `@Route("/mongo/...")`/`@Route("/sql/...")`.
- **Models** gained `@MailboxScopedData()`; nothing else changed.
- **Tests:** one vitest config for backend and UI. swc transforms TS and TSX (React automatic runtime); the environment
  is `node`, and page tests opt into `jsdom` by docblock (added to the web-client tests, which relied on a jsdom
  default). `resolve.dedupe` covers React and `@rapidrest/core`/`service-core`/`typeorm`/`mongodb`/`reflect-metadata`,
  and `ssr.noExternal` inlines the portal-linked packages, so their own node_modules copies never load. The test
  servers only load the booking routes plus restapi's `CalendarEvent`/`Folder`/`Mailbox` models, so `testDoubles.ts`
  only registers `RecordingMailTransport`. Server port 3848; Mongo on 9999 behind the shared
  `D:/github/rapidmx/restapi/.vitest-lock`. Added `test/plugin.test.ts` (entry point exports, entity names, index names,
  ACL uids, `parsePluginManifest` including `ui` and settings) and a `@MailboxScopedData` case per backend.
- **Results:** 23 files, 341 tests; coverage 100 / 98.19 / 100 / 100 (gates 100/95/100/100, activesync's). The only
  uncovered branches are in the two base routes (`@Inject`/`@Config` metadata arms and defensive fallbacks, as in
  restapi).

### 2026-09-20 — Booking link fixes from the first real test on powerlevel.gg

Seven requests: copy-link button on the list, mailbox selector on new/edit, mailbox-scoped public URLs, per-mailbox avatar
and banner, and a redesigned public page (no repeated logo, host name/avatar/banner up front, wide layout).

- **Where the changes are:** `BaseBookingRoute` (mailbox-scoped paths, `mailboxUid`/`avatarVersion`/`bannerVersion` in the
  public projections), `BaseBookingTypeRoute` (per-mailbox slug check, move-to-mailbox rules), new `BaseBookingProfileRoute`
  and `BookingProfile` models, `apps/book/[mailboxUid]/[slug].tsx` with `_BookingChrome.tsx`, and the settings pages.
- **The redundant header** was the page's own `<img src={logoSrc}>` on top of the branding header's logo. The page also had
  `min-h-screen` around content that sits between the branding header and footer, which pushed the footer off screen; the
  shell is now a `min-h-screen` flex column with a growing `<main>`.
- **Not done, on purpose:** a `/book/<mailboxUid>` landing page listing a mailbox's links (it currently 404s); redirecting
  old `/book/<slug>` links.

### 2026-09-21 (P1) - `./purge`: uninstalling with data deletes the profile images

The server's "uninstall with data" (server NOTES, same date) finds this plugin's three collections/tables from its models but can't find its `BlobStore` images (no listing; the keys are only in `BookingProfile.avatarBlobKey`/`bannerBlobKey`). `src/purge.ts` exports `onPurge(ctx)` (package `exports["./purge"]`): reads the keys from the profile collection/table the server names in `ctx.models` (MongoDB `connection.db`, SQL via the driver's own quoting and `hasTable`) and deletes each with `ctx.blobStore.delete`; any failure, or images with no BlobStore, throws an error named `AbortPurgeError` so the server stops before the rows (the only record of the keys) are deleted and the purge can be retried. The context and the error are declared locally (a plugin imports nothing from the server; the server recognises the error by name). Bookings' calendar events are the mailbox owners' `CalendarEvent`s and are deliberately left. Tests: `test/purge.test.ts` (8). Verified in a real run against the server (see its NOTES): the image file was gone after the purge.

### 2026-09-22 — Multiple meeting types + configurable locations per booking link

Two requests: a booking link should offer several meeting types (own duration each, shared availability), and a
booker should pick a location (Phone/Video/Other) the host pre-configures per meeting type.

- **Design decisions made up front (asked, not assumed):** location options live per meeting type, not shared
  across the whole link; no back-compat/migration for the `durationMinutes` → `meetingTypes` change (there was no
  deployed data to preserve, so this is a clean breaking change to the plugin's own schema - see the README's Data
  section); a video location's URL is optional at setup and can be set/changed per booking afterward, which is why
  the new `/host` endpoints (see standing decisions) exist at all.
- **`durationMinutes` is gone from `BookingType`**, replaced by `meetingTypes: BookingMeetingType[]` (min 1,
  validated by a new `validateMeetingTypes()` inside `BookingUtils.ts`). `generateCandidateSlots()` takes
  `durationMinutes` as an explicit parameter instead of reading the booking type, since it's now per meeting type -
  callers pass the selected meeting type's duration for a new booking, or the existing booking's own
  `endDate - startDate` for a reschedule (deliberately not re-looked-up from `meetingTypes`, so editing/removing a
  meeting type can never silently change an existing booking's length).
- **`Booking` snapshots meeting-type/location fields at booking time** (`meetingTypeUid/Name`, `locationType`,
  `locationLabel`, `bookerPhone`/`locationVideoUrl`/`bookerLocationInstructions` depending on the location's type) -
  see the standing decision on why, and on the new `/host` endpoints this required.
- **Public projection omits a location option's `videoUrl` before booking** (`PublicBookingType`/
  `PublicMeetingType`/`PublicLocationOption` in `BaseBookingRoute.ts`) - a meeting link is shown to the person who
  booked it (`PublicBooking.locationVideoUrl`), not browsable by anyone with the public link before they've booked.
- **UI:** new `MeetingTypesEditor` (`apps/shared/components`) replaces the single duration field on the booking
  link forms - note its per-meeting-type name field is labelled "Meeting type name", not "Name", specifically to
  avoid colliding with the booking link's own "Name" field once both are on the same form (this bit real tests
  during the session - `getByLabelText("Name")` became ambiguous). Same reasoning gave the "Remove meeting type"/
  "Remove location option" buttons distinct `aria-label`s instead of both saying bare "Remove", and the detail
  page's per-booking "Save video URL" button its own `aria-label` distinct from the form's own "Save" button.
- **Tests:** ~200 test changes/additions across `test/util/BookingUtils.test.ts`, `test/models/{mongo,sql}.test.ts`,
  all four `BookingTypeRoute`/`BookingRoute` route test files plus `bookingSecuritySuite.ts`/`bookingMailboxSuite.ts`
  (split off to a background agent once the pattern was proven on `BookingTypeRoute.test.ts`'s single shared `body()`
  fixture - fixtures that write directly to a repo, bypassing the route, need explicit fixed `uid`s for their meeting
  types/location options since only the route mints them), and every UI test under `test/apps/settings-booking-types`
  and `test/apps/book`. `test/plugin.test.ts`'s pinned root-export list grew by `BookingLocationType`,
  `MAX_MEETING_TYPES`, `MAX_LOCATION_OPTIONS`. Full suite: 32 files, 722 tests, lint and both `tsc` builds clean.

### 2026-09-22 - A video location option mints its own link when `@rapidmx/meet-plugin` is active

`BaseBookingRoute.book()` resolves a video location's `videoUrl` before `persistBooking()`'s own transaction, not
inside it - a video-integration failure can never touch the booking's atomic write. When the chosen location is
Video and has no preset `videoUrl`, `maybeCreateVideoMeetingJoinUrl()` checks `PluginRegistry.isActive("@rapidmx/
videoconf-plugin")` first (zero import attempted for a deployment that never installed it - the common case),
then has each concrete route (`BookingRouteMongo`/`BookingRouteSQL`) resolve its own backend via a new abstract
`importVideoconfBackend()` (`await import("@rapidmx/meet-plugin/mongo"|"/sql")`, its own try/catch), and
calls the plugin's exported `createSingleInviteeVideoMeeting()` (an in-process function call, not an HTTP
round-trip to its own mounted route - both plugins run in the same server process). Any failure anywhere in this
chain - the package genuinely missing despite `isActive()` saying yes, the call itself throwing - is logged and
`locationVideoUrl` stays unset, exactly like "the host hasn't set one yet" today; a booking is never blocked by a
video-conferencing failure.

`package.json` gained `@rapidmx/meet-plugin` as an `optionalDependencies` entry (a real version range, not
`rapidmx.plugin.requires` - that's a hard install-time dependency this integration deliberately avoids) and as a
`devDependency` for local type resolution. **Known, unavoidable right now**: `@rapidmx/meet-plugin` has never
been published, so `yarn install` here genuinely 404s on it today - resolves itself the moment it's released;
verified the wiring anyway by building it and placing a real, untracked copy into `node_modules` for testing,
removed afterward.

New shared cross-backend suite `bookingVideoconfIntegrationSuite.ts` (video + no preset URL + plugin active → a
real link and a real `VideoMeeting`/`VideoMeetingInvitee` row; preset URL → integration never invoked; plugin
inactive → unset, no error; phone/other untouched). Two more scenario files per backend (`...ImportFailure`/
`...CallFailure`) simulate the dynamic import itself failing despite `isActive()` reporting true, via `vi.mock()`
on the exact module specifier in dedicated files with their own minimal server fixtures (a shared fixture whose
`models/index.ts` already re-exports the real plugin's models would make the mock's throwing factory evaluate
eagerly at server startup instead, crashing every test in the file - no existing precedent for this shape of test
anywhere in the family, so this is the new one).

**Pre-existing, unrelated:** `yarn test:prod`'s coverage gate is already red before this change (97.96%/94.65%/
98.03%/97.93% against 100/95/100/100 - confirmed via `git stash` against the working tree before this integration
touched anything), entirely in files this change never touches (`BookingUtils.ts`, several pages/components,
three untested branches already in `BaseBookingRoute.ts` itself, none related to video) - left alone as out of
scope; every line this integration added is itself 100% covered. **Closed 2026-09-22, see that date's own entry
below** - this was the same gap the "Adversarial review fixes" entry re-confirmed still open a few hours later.

Files: `package.json`; changed `src/routes/BaseBookingRoute.ts`, `src/routes/mongo/BookingRouteMongo.ts`,
`src/routes/sql/BookingRouteSQL.ts`, `test/config-defaults.ts`, `test/routes/{mongo,sql}/BookingRoute.test.ts`,
`test/server-{mongo,sql}/models/index.ts`; new `test/routes/bookingVideoconfIntegrationSuite.ts`,
`test/routes/{mongo,sql}/BookingRouteVideoconf{ImportFailure,CallFailure}.test.ts`,
`test/server-{mongo,sql}-import-failure/`. Full suite: 36 files, 734 tests, all passing.

### 2026-09-22 — Adversarial review fixes: deleting a booking type with bookings, and a truncation-prone SQL column

A hardening review (externally-exploitable-only threat model, see standing decision above) found two issues, both fixed:

- **`BaseBookingTypeRoute.delete()` had no `requireNoBookings()` guard**, unlike `update()`'s mailbox-move path -
  see the standing decision above (updated in place) for why an orphaned booking's booker and host both silently
  lose the ability to manage it via `BaseBookingRoute`'s per-booking endpoints. Fixed by giving `requireNoBookings()`
  a second `action` parameter (`"moved to another mailbox"` | `"deleted"`, worded into the `409` message) and adding
  a `delete()` override that calls it before `super.delete()`. Matches `update()`'s existing pattern: `@Param`/
  `@Query`/`@Request`/`@AuthUser` re-declared on the override (framework resolves the HTTP verb/path from the
  inherited method name, not a re-applied `@Delete` decorator) - note `delete()`'s `req` stays *non-optional*
  there (`BaseScopedChildRoute.delete()`'s own signature, unlike its `update()` which takes `req?`), caught by
  `tsc`, not by any test.
- **`BookingSQL.locationVideoUrl` gained `type: "text"`** - was a bare `@Column({ nullable: true })` despite being
  validated up to 2000 characters (`MAX_VIDEO_URL_LENGTH` in both `BookingUtils.ts` and `BaseBookingRoute.ts`),
  unlike every other >255-char field in the same file. Not reachable today (only `pg`/`better-sqlite3` are wired up
  as SQL drivers anywhere in this ecosystem, and both treat this as unbounded) but a real gap against this
  package's own convention (confirmed against `restapi`'s `SqlDriverColumnTypes.ts` and its own NOTES.md: "long SQL
  strings are `type: \"text\"`") that would silently truncate on a MySQL/MariaDB deployment. No behavioral test
  needed - `test/models/sql.test.ts` already round-trips this field on `better-sqlite3`, which doesn't distinguish
  the two column types either way.
- **New tests**: `test/routes/bookingTypeMailboxSuite.ts` gained a `describe("deleting a booking type")` block
  (refuses with a booking, 409, leaves it in place; only counts its own bookings, 204 when it has none; 403 for a
  caller without DELETE on the mailbox) - reuses the existing `ctx.createBooking` fixture already used by the
  move-mailbox tests. Full suite: 36 files, 740 tests, all passing; `yarn lint` and both `tsc` builds clean.
- **Full-suite flakiness observed, unrelated to this change**: three consecutive `vitest run --coverage` passes
  each failed a different, unrelated test (two `maxPerDay`/cancel assertions returning `500`, then seven unrelated
  `BookingTypeRoute` mongo tests returning wrong statuses, then one `MongoNetworkError: ECONNRESET` in a videoconf
  test) - always a different set, never the tests this session touched, and every implicated file passes cleanly
  in isolation. A fourth run was fully green (740/740). Looks like local Mongo test-instance contention on this
  machine, not a real regression - not investigated further since it isn't this session's change, but worth knowing
  if a future run flakes here too. Coverage gate is still the same pre-existing red the "video location option"
  entry above already documented (97.96%/94.7%/98.06%/97.96%, essentially unchanged) - left alone as out of scope,
  same as that entry. **Closed 2026-09-22, see that date's own "independent coverage audit" entry below.**

### 2026-09-22 — Independent coverage audit: closed the pre-existing gate gap

Verified the gap the two entries above flagged as "out of scope" (97.96%/94.7%/98.06%/97.96% against this repo's
own 100/95/100/100 gate) still held with a fresh, from-scratch `vitest run --coverage`, then closed it with
targeted tests rather than leaving it flagged again. `reportOnFailure` isn't set in `vitest.config.ts`, so
`@vitest/coverage-v8` prints no coverage table at all on a run with any failing test - the same local Mongo
test-instance contention the "Adversarial review fixes" entry above already documented (a different random subset
of `BookingRoute.test.ts` mongo tests failing with `500`s each attempt) hit on the first two attempts here too,
each with zero coverage output as a result; a clean, fully-green run was needed to get real numbers at all.

**Before:** 97.96%/94.7%/98.06%/97.96% (statements/branches/functions/lines), 740 tests. **After:**
100%/98.69%/100%/100%, 784 tests, all passing - the gate now passes outright (`vitest run --coverage` exits 0,
no threshold errors). Went through every uncovered file/line from a real `coverage-final.json` (not the
terminal table's truncated line-number column) and judged each genuine-gap-vs-defensible-boilerplate before
writing anything:

- **Genuine gaps, now tested:** `BookingUtils.ts`'s `validateMeetingTypes()` rejecting an invalid (empty/
  non-string) meeting-type or location-option uid, an over-long location label, or an over-long `videoUrl`;
  `BaseBookingTypeRoute.normalizeMeetingTypeUids()` actually preserving an edited-in-place meeting type's and
  location option's existing uid (only ever exercised before with a brand-new one, minting fresh); `BaseBookingRoute`'s
  `bookerPhone`/`bookerLocationInstructions` length/type validation (`validateBook()` checks both unconditionally,
  whatever location the caller picks - untested regardless of location type); the `/host` endpoints'
  400/404 paths (`GET /host` with no or an unknown `bookingTypeUid`; `POST /host/:uid/location` on an unknown
  booking, an over-long `locationVideoUrl`, a booking whose own booking type was deleted, and clearing a
  previously-set URL back to unset - the `videoUrl ?? null` arm); `manageUrl()` omitting the cancel/reschedule
  line when no `mail:booking:public_url` is configured; `checkBookingRateLimit()` falling back to an `"unknown"`
  address bucket when called with no `HttpRequest` at all (a direct/internal caller HTTP can't produce, same
  category as the pre-existing "params that are not text" cases in `bookingMailboxSuite.ts` - added right next to
  them via `ctx.route()`); the public booking page's phone/other location submission actually completing (typing
  into the phone number / instructions fields, not just the validation-error path already covered); its error
  message when reloading slots for a newly-chosen meeting type fails; the booking-type detail page's bookings list
  load failure/its own API error message, the "Loading…" state (needed a manually-deferred fetch response - the
  detail page's own load and the bookings list's both start on mount and normally settle in the same tick), saving
  a video URL's own failure path, clearing a video URL from the field, and one booking's save leaving a sibling
  booking in the list untouched; `MeetingTypesEditor`'s actually-reachable "remove a location option when more
  than one exists" success path (only the refusal was tested), editing a label/video URL field including back to
  unset, and editing one meeting type/location option without touching its sibling (the untouched-sibling arm of
  each `.map()`); `_locationSummary.ts`'s phone and "other" cases (only video was exercised, via the pages) - new
  `test/apps/book/_locationSummary.test.ts`; the new-booking-type page's "every meeting type needs a name" guard.
- **Defensible to skip, left alone, don't block the gate (branches sit at 98.69%, comfortably over the 95% floor):**
  four `?? []` fallbacks in `BaseBookingRoute.ts` (`requireMeetingType()`/`requireLocationOption()`/
  `toPublicMeetingTypes()`) and one in `BaseBookingTypeRoute.normalizeMeetingTypeUids()`, guarding
  `meetingTypes`/`locationOptions` being `undefined` - both are server-validated to have at least one entry before
  they're ever stored, so this only guards already-written data from a version predating that validation, or a
  direct DB write bypassing the route entirely; a bare optional-chaining artifact on `meetingType?.uid` in
  `BookingUtils.validateMeetingTypes()` (`meetingType` is always a real array element here, never nullish); an
  `if (event)` guard in `book()` right after `persistBooking()` re-reads the very row it just wrote in the same
  request - only false on a same-request race no test can force without mocking the repo mid-request. **Genuinely
  dead, not just defensive - flagged for the maintainer, not silently left:** `sendBookingMail()`'s entire
  `cancelled: true` branch (the "has been cancelled" message, its `icalEvent` CANCEL method/content, skipping the
  location/approval/manage-link lines) is unreachable via any current caller - `cancel()` deliberately never calls
  `sendBookingMail()` at all (its own comment: `MeetingSchedulingJob.sendCancellations()` mails the iTIP CANCEL
  instead), and the only two callers left (`book()`, `reschedule()`) both pass `false`. Left untouched rather than
  forced with a reflection-style direct call to a private method, since that would test code proven to never run
  today rather than real behavior - worth a follow-up to either wire cancellation through this path too or delete
  the dead half of the function and drop the `cancelled` parameter.
- **Two `/* v8 ignore next N -- ... */` comments added** (this repo's existing convention - see
  `BookingUtils.ts`'s pre-existing one), both in `apps/book/[mailboxUid]/[slug].tsx`: `handleLoadMore()`'s
  `!selectedMeetingTypeUid` guard (its own doc comment already says it's only reachable from a button that renders
  only once a meeting type's slots already loaded successfully) and `handleSubmit()`'s `!selectedLocationOption`
  guard (a `useEffect` keyed on `selectedMeetingType` always resets `selectedLocationOptionUid` to a real option's
  uid before any later user action can run against a stale pair, since `locationOptions` is server-guaranteed
  non-empty). These were the only two remaining statement-level gaps once the reachable one in the same file
  (`handleSelectMeetingType()`'s own catch block) got a real test instead.
- **Files touched (tests only, plus the two ignore comments above - no other production-code changes):**
  `test/util/BookingUtils.test.ts`, `test/routes/{mongo,sql}/BookingTypeRoute.test.ts`,
  `test/routes/bookingSecuritySuite.ts`, `test/routes/{mongo,sql}/BookingRoute.test.ts`,
  `test/routes/bookingMailboxSuite.ts`, `test/apps/book/[mailboxUid]/[slug].test.tsx`, new
  `test/apps/book/_locationSummary.test.ts`, `test/apps/settings-booking-types/[uid].test.tsx`,
  `test/apps/settings-booking-types/new/index.test.tsx`, `test/apps/shared/components/MeetingTypesEditor.test.tsx`,
  `apps/book/[mailboxUid]/[slug].tsx`.

### 2026-09-23 — Round-3 adversarial review: truncate() bypassed the bookings guard, a trusted-role ACL bypass, and a DST maxPerDay bug

A further hardening review found three more issues (same externally-exploitable-only threat model as the
2026-09-22 entry above), all fixed in one pass:

- **`BaseScopedChildRoute.truncate()` (the bulk `DELETE /api/mail/booking-types?mailboxUid=...` endpoint, no `/:id`)
  was completely unguarded** - `BaseBookingTypeRoute` overrode `create()`/`update()`/`delete()` but not `truncate()`,
  so the `requireNoBookings()` guard the 2026-09-22 entry above added to `delete()` was trivially bypassable via
  this second, unaudited route: `ACLAction.TRUNCATE` is included in the `ACLAction.FULL` grant a mailbox owner
  holds by default, so an ordinary host could hard-delete every booking type in their own mailbox - active bookings
  included - in one request. Fixed by overriding `truncate()`: it pages through every `BookingType` the truncate
  filter is about to match (`findAllMatchingTruncate()` - `BaseScopedChildRoute`'s own equivalent helpers
  (`scopedFilter()`/`findAllForTruncate()`) are `private`, so this duplicates the small, already-precedented
  `stripUnsafeQueryKeys()` pattern other restapi route files use, rather than reimplementing the rest of the base
  class's permission/legal-hold machinery), checks each via `requireNoBookings()`, and refuses the WHOLE call
  (409) if any has a booking - deliberately not a partial truncate of just the bookingless rows, so a bulk "delete
  everything matching this filter" request never produces a surprising partial result. Tests:
  `test/routes/bookingTypeMailboxSuite.ts`'s new `describe("truncating...")` block (refuses the whole call and
  leaves every matched row in place; still succeeds when none have bookings; only counts each row's own mailbox's
  bookings; refuses without TRUNCATE) plus a direct unit test of `stripUnsafeTruncateQueryKeys()` for the one branch
  HTTP can't reach (a client-sent `shareToken`/`scope`/dotted-`$` key).
- **Three of this package's own hand-rolled mailbox-permission checks called `ACLUtils.hasPermission()` with the
  caller as given** - `BaseBookingProfileRoute.requireMailboxPermission()`, `BaseBookingRoute.
  requireMailboxPermission()` (the `/host` endpoints) and `BaseBookingTypeRoute.requireBookableFolder()`. That
  method answers `true` for any trusted-role (`admin`) caller regardless of grant - the right behavior for
  administering the platform, the wrong one for someone else's mailbox. Same bug class already fixed in
  `@rapidmx/restapi` itself and in `activesync` this session; **this package can't import `@rapidmx/restapi`'s own
  `stripTrustedRoles()`/`hasMailAccess()` fix** - confirmed via `node_modules/@rapidmx/restapi`'s actually-resolved
  version (`yarn.lock` pins `0.12.0`, published well before that fix existed - `dist/lib/util/` there has no
  `MailAccessUtils.js` at all, unlike `activesync`'s freshly-rebuilt `node_modules` copy from today's other session
  work) - so this repeats `@rapidmx/meet-plugin`'s own precedent: a small, self-contained local copy, new
  `src/util/RouteAccessUtils.ts` (`stripTrustedRoles()`), applied at all three call sites via a new `private
  trustedRoles: string[] = ["admin"]` field on each route (`BaseBookingTypeRoute` already inherits one for free from
  `ModelRoute`, so only the other two needed it). **Revealed an existing test fixture that had been unknowingly
  exploiting this exact bug**: `bookingProfileSuite.ts`'s `adminToken` fixture was documented as "passes every
  mailbox permission check - even for a mailbox that doesn't exist" and a test used that bypass to observe the
  404-vs-403 branch on a nonexistent mailbox uid. Both were rewritten: the doc comment now says what's actually
  true post-fix, and the 404-observation test uses a new `deleteMailboxRow()` fixture (deletes just the mailbox row,
  keeping its `AccessControlList` so a REAL grant, not a bypass, is what lets `ownerToken` see the 404) instead of
  the no-longer-bypassing `adminToken`. New regression tests at all three call sites prove an admin-role caller with
  no explicit grant is refused (403) exactly like a stranger, plus a unit test file for `stripTrustedRoles()` itself
  (`test/util/RouteAccessUtils.test.ts`, mirrors `meet-plugin`'s own).
- **`countBookingsOnDay()`'s day-boundary math broke on a DST transition day.** `dayEnd` was `dayStart + 24h - 1ms`
  - correct on an ordinary day, wrong on the two days a year it isn't 24 real hours. Spring-forward (23h): the
  window overshot into the next day's first ~59 minutes, so an existing booking made just after local midnight on
  the FOLLOWING day got double-counted against the PREVIOUS day's `maxPerDay`, wrongly refusing ("That day is fully
  booked.") a legitimate booking on a day that in fact had none yet. Fall-back (25h): the window fell short of the
  following real local midnight by the same ~59 minutes, so an existing booking made in the last local hour of the
  day was silently excluded from its own day's count, letting a caller exceed `maxPerDay`. Fixed by resolving
  `dayEnd` the same way `dayStart` already was - `convertLocalToUtc()` on the NEXT calendar day's Y/M/D (stepped via
  `Date.UTC()`, pure calendar arithmetic, never an instant - the exact pattern `generateCandidateSlots()` already
  uses to cross days) - instead of a fixed millisecond offset. Tests: `describe("maxPerDay across a DST transition
  (America/New_York)"` in both `BookingRoute.test.ts` files, using the real 2026-projected US DST dates for 2099
  (2099-03-08 spring-forward, 2099-11-01 fall-back, found by probing `Intl.DateTimeFormat`'s `timeZoneName` day by
  day rather than hand-computing "second Sunday in March"/"first Sunday in November") - one proves both the
  previous and the transition day's own booking succeed (the wrongly-refused case), the other proves a second
  booking on the transition day is still refused once `maxPerDay` is reached even when the first booking sits in
  the last real local hour (the wrongly-allowed case).
- **Full suite: 812 tests, 38 files, all green on a clean run** (`vitest run --coverage`: 100%/98.62%/100%/100%
  statements/branches/functions/lines - gate is 100/95/100/100, passes outright); `yarn lint` and `tsc --noEmit`
  clean. **Same pre-existing local-Mongo-contention flakiness the 2026-09-22 entries above already documented**:
  `BookingRouteVideoconfImportFailure.test.ts` (mongo) failed once with an unrelated `500` in two of four full-suite
  attempts this session, always passing cleanly alone and in every other full run - not a regression from this
  session's changes (confirmed by running it in isolation, and by two other fully-green full-suite runs).
- **Not acted on, out of scope per the review**: the `ErasureExecutionJob` cross-entity-type non-atomicity finding
  (structural, restapi-level, not fixable in this repo) and the dead `sendBookingMail()` `cancelled: true` branch
  (already flagged as a known follow-up by the 2026-09-22 "Independent coverage audit" entry above - still
  unreached, still left alone).
- Files touched: `src/routes/BaseBookingTypeRoute.ts`, `src/routes/BaseBookingRoute.ts`,
  `src/routes/BaseBookingProfileRoute.ts`; new `src/util/RouteAccessUtils.ts`; tests in
  `test/routes/bookingTypeMailboxSuite.ts`, `test/routes/bookingTypeFolderSuite.ts`, `test/routes/bookingProfileSuite.ts`,
  `test/routes/{mongo,sql}/BookingTypeRoute.test.ts`, `test/routes/{mongo,sql}/BookingProfileRoute.test.ts`,
  `test/routes/{mongo,sql}/BookingRoute.test.ts`; new `test/util/RouteAccessUtils.test.ts`.

### 2026-09-25 - A booking's event carries its location and details, a 15 minute reminder, and the host is mailed

From the first real test on powerlevel.gg: the invite showed "Add a room", the host's event popover had no link/phone/notes/notification, nothing in the inbox said a booking was made, and deleting a meeting with guests took minutes to notify them.

- **Event fields.** `persistBooking()` builds one `BookingEventDetails` and uses it for both the `Booking` row and the event: `location` (video URL / `Phone: <n>` / other instructions collapsed to one line, <= 200; none for a video call with no link yet), `description` + `descriptionHtml` (who booked, the location line, the notes; HTML built from escaped text and run through restapi's `sanitizeEventDescriptionHtml()`, link clickable), `reminderMinutesBeforeStart: 15`. The manage link is deliberately NOT in the description (the event is readable by whoever the calendar is shared with). The booker's name is collapsed to one line there, so a name with line breaks can't write lines of its own. **The helpers live in `src/util/BookingEventUtils.ts`, not `BookingUtils.ts`**: `index.ts` does `export *` from `BookingUtils` and `test/plugin.test.ts` pins the root exports, so anything added there becomes public API.
- **`setBookingLocationVideoUrl()`** now also updates the event (location, description, `sequence + 1`) and mails the booker the updated invitation. A deleted or cancelled event is skipped.
- **Host notification** (`fileHostNotification()`): filed directly as an unread Inbox message (blob put under `booking-notifications/<uid>`, `Message` row, `NotificationUtils.sendMessage()`, `refreshFolderCounts()` - the same steps as restapi's `fileDeliveryFailureNotice()`, which is failure-notice specific so it is mirrored, not called), from `bookings@<domain>`, Reply-To the booker, best-effort, new bookings only. It replaced an earlier version that mailed the host's own address through `MailTransport` (2026-09-25, same day): that would have come back in through Postfix/ingest from the mailbox's own address, exposing it to SPF/DMARC and the scan pipeline. **Needs `messageClass`** (`MessageSQL`/`MessageMongo`, abstract on `BaseBookingRoute`) and `BlobStore`/`NotificationUtils` injected; the test servers' `models/index.ts` re-export `Message*` so the ClassLoader registers the entity. A failed message write deletes the stored body (best-effort). **No `text/calendar` part**, or ScanQueueJob would make a second event. Not verified on a real deployment.
- **Reminder for the booker: `withReminderAlarm()`** (in `BookingEventUtils.ts`) adds a `VALARM` (`TRIGGER:-PT15M`) to the REQUEST that `sendBookingMail()` mails, taken from the event's `reminderMinutesBeforeStart`; it is done here because restapi's `buildEventIcs()` never emits one (and changing it would put the organizer's reminder in every invitation the server sends), and it leaves an ICS that already has an alarm alone, so it is harmless if restapi ever adds one. `MeetingSchedulingJob`'s own invites therefore have no alarm, which is why `setBookingLocationVideoUrl()` now sends the updated invitation itself via `sendBookingMail()` and stamps `inviteSequenceSent` (like `reschedule()`), unless the mailbox row is gone.
- **Cancel delay** was `MeetingSchedulingJob`'s 5 minute default schedule (deleting only marks the event; that job mails the CANCEL). Fixed in restapi's default (`*/10 * * * * *`, unreleased) and set explicitly in the server's config so it applies before restapi is republished.
- Tests: both route suites (they now also hold a `MessageSQL`/`MessageMongo` repo and the `InMemoryBlobStore`; "Provisions the calendar folder" expects the Inbox too), new `test/util/BookingEventUtils.test.ts`. Full suite 854 tests green, coverage gate passes.

