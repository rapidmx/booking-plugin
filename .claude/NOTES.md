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
- **A booking type moves between mailboxes only while it has no bookings** (`requireNoBookings`): each `Booking` keeps a
  denormalized `mailboxUid` and its event lives in the old mailbox's calendar, and the manage page resolves the mailbox
  from the booking.
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
