# Release Notes

## Unreleased

### Changed

- Raise the `@rapidmx/restapi` peer floor to `>=0.21.1`, `@rapidmx/react-shared` to `>=0.16.0` and `@rapidmx/web-client` to `>=0.15.1`, with the development dependencies and `resolutions` at the same versions, and the optional `@rapidmx/meet-plugin` to `^0.4.1`, so the plugin is built and tested against the current packages (its route tests register a `SearchProvider` double, which `@rapidmx/restapi` now injects into every scoped route).

## v0.5.0

### Fixes

- **Bulk-deleting (truncating) a mailbox's booking types no longer bypasses the same-mailbox bookings guard.**
  `BaseBookingTypeRoute` overrode `create()`/`update()`/`delete()`, but `BaseScopedChildRoute` also exposes a fourth,
  genuinely permanent bulk-delete endpoint - `truncate()` (`DELETE /api/mail/booking-types?mailboxUid=...`, no
  `/:id`) - gated only by `ACLAction.TRUNCATE` on the mailbox, which a mailbox owner holds by default. Left
  unoverridden, an ordinary host could hard-delete every booking type in their own mailbox, including ones with
  active bookings, in one request that never touched the `requireNoBookings()` guard `delete()` already had -
  orphaning every booking under every purged type exactly like the unguarded `delete()` used to. `truncate()` is now
  overridden the same way: every booking type the truncate filter matches is checked first, and the WHOLE call is
  refused (409) if any of them has a booking, leaving every matched booking type in place - not just the offending
  one - so a bulk "delete everything matching this filter" request never produces a surprising partial result.
- **Three mailbox-permission checks in this package's own routes no longer treat a trusted `admin` role as
  always-permitted on a mailbox it holds no grant on.** `BaseBookingProfileRoute.requireMailboxPermission()`,
  `BaseBookingRoute.requireMailboxPermission()` (the host-only `/host` endpoints) and
  `BaseBookingTypeRoute.requireBookableFolder()` each called `ACLUtils.hasPermission()` with the caller as given;
  that method answers `true` for any trusted-role caller regardless of grant, which is the right behavior for
  administering the platform and the wrong one for someone else's mailbox, avatar/banner, private bookings, or
  calendar. An admin-role caller with no explicit grant could therefore read or change another mailbox's booking
  profile, manage its private bookings, or point a booking type's `calendarFolderUid` at a calendar folder in a
  mailbox they don't own - leaking its free/busy through the public slots endpoint and planting events in it. All
  three now strip trusted roles first (new `stripTrustedRoles()` in `src/util/RouteAccessUtils.ts`, a small
  self-contained copy of `@rapidmx/restapi`'s own fix for the identical issue - not importable here since this
  package is pinned to a `@rapidmx/restapi` version that predates it), so a trusted role is refused exactly like a
  stranger unless it also holds a real grant.
- **`maxPerDay` was wrongly enforced (or wrongly bypassed) on a DST transition day.** `countBookingsOnDay()` derived
  a local calendar day's end by adding a flat 24 hours to its start instead of resolving the following local
  midnight - correct on an ordinary day, but a spring-forward day is only 23 real hours (the window overshot into
  the next day's first hour, double-counting a booking made just after midnight and sometimes wrongly refusing a
  valid booking with "That day is fully booked") and a fall-back day is 25 real hours (the window fell short of
  real midnight, undercounting a booking made in the last local hour and letting a caller exceed `maxPerDay`). Both
  were reachable by any anonymous booker, twice a year per host timezone. Fixed by resolving the day's end the same
  way its start already was - via the timezone-aware local-to-UTC conversion `generateCandidateSlots()` also uses -
  instead of a fixed millisecond offset.
- **Deleting a booking type that still has bookings is refused (409), instead of orphaning them.** `BaseBookingTypeRoute`
  had a `requireNoBookings()` guard on `update()` (moving a booking type to another mailbox), but nothing stopped
  `delete()` outright removing a booking type with active or pending bookings. Every one of `BaseBookingRoute`'s
  per-booking endpoints (`manage()`/`cancel()`/`reschedule()`/`hostListBookings()`/`setBookingLocationVideoUrl()`)
  re-resolves the booking type by `bookingTypeUid`, so an orphaned booking's booker permanently lost the ability to
  view, cancel or reschedule it, and the host lost the ability to manage its video URL - even though the booking
  itself was still live on the host's calendar. `delete()` now reuses the same guard; disable a booking type
  (`enabled: false`) instead of deleting it to stop new bookings without losing this.
- **`Booking.locationVideoUrl`'s SQL column is now `type: "text"`**, matching every other field in `BookingSQL` that
  can hold more than ~255 characters (`bookerLocationInstructions`, `bookerNotes`). The column had no explicit type
  or length despite being validated up to 2000 characters, which would silently truncate or fail on a MySQL/MariaDB
  deployment (not reachable today - only Postgres and SQLite drivers are wired up - but a real gap against this
  package's own SQL conventions).

### Tests

- **Closed the test coverage gate's pre-existing gap** (97.96%/94.7%/98.06%/97.96% statements/branches/functions/lines
  against this package's own 100/95/100/100 gate, flagged as out of scope by the two most recent sessions above) with
  targeted tests for real, previously-untested behavior - no production code changed, other than two `/* v8 ignore */`
  comments on two genuinely unreachable UI guards in `apps/book/[mailboxUid]/[slug].tsx`. Now 100%/98.69%/100%/100%;
  `vitest run --coverage` passes outright. See `.claude/NOTES.md`'s 2026-09-22 "Independent coverage audit" entry for
  the full list of what was tested and what was judged defensible to leave alone (mostly `?? []` fallbacks guarding
  server-already-validated data), including one genuinely dead code path flagged for a maintainer follow-up rather
  than papered over (`BaseBookingRoute.sendBookingMail()`'s `cancelled: true` half, which no current caller reaches).

## v0.4.0

### Features

- **A video location option fills in its own meeting link automatically, when `@rapidmx/meet-plugin` is
  installed.** A `BookingLocationOption` of type Video with no meeting URL set by the host now mints a real,
  working one at booking time (a private video meeting with the booker as its sole invitee) instead of leaving
  `Booking.locationVideoUrl` unset until the host fills it in by hand - detected and called at runtime, never a
  hard dependency: this plugin installs and works exactly as before on a deployment that never installs video
  conferencing at all, and a preset host URL is always used as-is. `@rapidmx/meet-plugin` is an
  `optionalDependencies` entry, resolved with a dynamic `import()` that never fails the booking itself if it
  can't be reached.

## v0.3.0

### Features

- **A purge hook, so uninstalling with data leaves nothing behind (`./purge`).** When an administrator uninstalls the plugin with **Also delete all data this plugin stored**, the server (once no copy runs the plugin) runs `onPurge()` before it deletes the booking collections and tables: it deletes every profile image (`avatarBlobKey`/`bannerBlobKey`, kept in the `BlobStore` under `booking-profiles/`) by the keys recorded in the profile rows, and throws an `AbortPurgeError` - which stops the purge with the rows still there for a retry - if any image can't be deleted. The bookings the plugin created in people's calendars are the calendar owners' own events and are not touched. Needs a server with `purgeData` support (the next `@rapidmx/server`).
- **Multiple meeting types per booking link, each with its own location options.** A booking link (`BookingType`) can
  now offer several meeting types (e.g. "15 Minute Chat" / "60 Minute Consultation"), each with its own duration and
  its own choice of locations a booker picks from: Phone (the booker types their number), Video call (the host sets a
  meeting URL, which may be left blank at setup and filled in per booking afterward), and Other (the booker types
  free-text instructions). Availability - the weekly windows, date overrides, buffers, notice and booking window -
  stays shared across all of a link's meeting types, exactly as before.

  **Breaking, no migration:** `BookingType.durationMinutes` is removed, replaced by the required `meetingTypes:
  BookingMeetingType[]` (at least one entry). See "Backend" below and the "Data" section of the README.

#### Backend

  - **Models:** `BookingMeetingType` and `BookingLocationOption` (with the new `BookingLocationType` enum), exported
    from the package root alongside the existing types. `BookingType.meetingTypes` replaces `durationMinutes`.
    `Booking` gains `meetingTypeUid`/`meetingTypeName` and `locationType`/`locationLabel`/`bookerPhone`/
    `locationVideoUrl`/`bookerLocationInstructions` - all snapshotted at booking time, so editing or removing a
    meeting type or location option later never changes an existing booking.
  - **`BaseBookingTypeRoute`** assigns a `uid` to any `meetingTypes`/`locationOptions` entry the caller sends without
    one, on both create and update - a caller may omit it for a new entry and must send back an existing one's uid to
    edit it in place.
  - **`GET /types/:mailboxUid/:slug/slots`** now requires a `meetingTypeUid` query parameter. **`POST
    /types/:mailboxUid/:slug`** now requires `meetingTypeUid` and `locationOptionUid` in the body, plus `bookerPhone`
    or `bookerLocationInstructions` when the chosen location needs one. The public booking type's `durationMinutes`
    is replaced by `meetingTypes` (without each option's `videoUrl`, which is shown only after booking).
  - **Two new host-authenticated endpoints**, permission-checked against the booking's own mailbox rather than the
    public/anonymous surface: `GET /host?bookingTypeUid=` lists a booking type's recent bookings, and `POST
    /host/:uid/location` sets or clears a booking's video call URL after the fact.
  - **`generateCandidateSlots()`** takes the slot duration as an explicit parameter rather than reading it off the
    booking type, since a duration is now per meeting type. A reschedule keeps a booking's own original duration
    (`endDate - startDate`) rather than re-deriving it from `meetingTypes`, so it can never change silently.

#### UI

  - **`MeetingTypesEditor`** (`apps/shared`), replacing the single "Duration (minutes)" field on the new and detail
    booking link forms: add, edit and remove meeting types, each with its own name, duration and nested list of
    location options (type, optional label, and a meeting URL field shown only for a video location).
  - **The public booking page** (`apps/book`) shows a meeting type selector above the time grid when a link offers
    more than one (reloading slots for the chosen one), and, once a time is picked, a location selector with the
    matching detail field (a phone number, a note that the link will be shared, or a free-text box). The confirmation
    panel and the manage page both show the booked location.
  - **The booking link detail page** gets an "Upcoming bookings" section listing the link's recent bookings, with an
    inline control to set a video booking's meeting URL - the only UI for that host-only capability.

## v0.2.0

> **Before publishing:** `package.json` `resolutions` and `devDependencies` still link `@rapidmx/restapi`,
> `@rapidmx/react-shared` and `@rapidmx/web-client` from sibling checkouts (`portal:../restapi`,
> `portal:../react-shared`, `portal:../web-client`). Replace them with the published releases that remove booking from
> core (restapi 0.12.0, react-shared 0.6.0, web-client 0.6.0 or later), run `yarn install`, and rerun the tests before
> `npm publish`.

First release. Booking moves out of core into this plugin, with its API, its data and its pages.

### Backend

- **Models:** `BookingType` and `Booking` (with `BookingStatus`, `BookingAvailabilityWindow` and
  `BookingDateOverride`), as `BookingTypeMongo`/`BookingMongo` and `BookingTypeSQL`/`BookingSQL`. The class names,
  collections and tables and the `BookingType`/`Booking` class ACLs are unchanged from `@rapidmx/restapi` 0.11, so
  existing data is used as is. Both are `@MailboxScopedData()`, so a mailbox erasure removes them.
- **Slugs are unique per mailbox, not globally.** The unique index `bookingtype_slug` (on `slug`) is replaced by
  `bookingtype_mailbox_slug` (on `mailboxUid` and `slug`). A SQL server drops the old index when it synchronizes the
  schema. **On MongoDB the old index stays** (nothing drops it), so slugs remain unique across mailboxes until it is
  dropped by hand: `db.booking_type_mongo.dropIndex("bookingtype_slug")`.
- **Booking page profile:** `BookingProfile` (`BookingProfileMongo`/`BookingProfileSQL`), one row per mailbox holding the
  keys of its avatar and banner in the server's blob store. It is `@MailboxScopedData()`, so a mailbox erasure removes the
  row, but the images in the blob store are left behind (the host has no cleanup hook for plugin data).
- **Routes:** `BookingTypeRouteMongo`/`BookingTypeRouteSQL` at `/api/mail/booking-types`,
  `BookingProfileRouteMongo`/`BookingProfileRouteSQL` at `/api/mail/booking-profiles` (upload, remove and read the
  avatar and banner; the images are served publicly) and `BookingRouteMongo`/`BookingRouteSQL` at `/api/mail/bookings`.
  The abstract `BaseBookingTypeRoute`, `BaseBookingProfileRoute` and `BaseBookingRoute` are exported from the package
  root.
- **Public endpoints are scoped to the mailbox:** `GET /types/:mailboxUid/:slug`, `GET /types/:mailboxUid/:slug/slots`
  and `POST /types/:mailboxUid/:slug` replace `/types/:slug...`. The public booking type and booking now include
  `mailboxUid`, `avatarVersion` and `bannerVersion`.
- **Moving a booking type to another mailbox** (`mailboxUid` in an update, with a `calendarFolderUid` of the new mailbox)
  is allowed until it has a booking, since each booking's event lives in the old mailbox's calendar.
- **Utilities:** `generateCandidateSlots`, `subtractBusy`, `normalizeSlug` and `validateAvailability`.
- **Entry points:** `./mongo` and `./sql` export only the models and routes the server loads (three of each).

### Manifest

- `apiVersion` 1, `mailboxScopedData: true`.
- **Setting:** `mail:booking:public_url` (string, empty by default), the base URL of the public booking pages used for
  the manage link in booking emails.
- **UI:** the `book` app on the public host at `/book`, the `booking-types` app on the webmail host at
  `/settings/booking-types`, and a **Booking Links** settings section.

### UI

- **Public pages** (`apps/book`), moved from the server: `/book`, `/book/:mailboxUid/:slug` (was `/book/:slug`, which
  no longer resolves) and `/book/manage/:token`, with slot paging (`_slotPaging`). A booking page is a wide card that
  opens with the host's banner and avatar (their initial and a plain banner when none is set), names the host first,
  then the booking type, its length and description, and shows the times in the visitor's time zone next to the
  form. The deployment's logo is shown once, in the branding header, not again inside the page.
- **Settings pages** (`apps/settings-booking-types`), moved from `@rapidmx/web-client`: the list, new and detail pages.
  They pass `pluginNav` through to `SettingsShell` with `active="booking-types"`. The app has its own `_layout`, a copy
  of the web client's webmail layout. The list has a **Copy link** button per booking link and a **Booking page
  appearance** card to upload or remove the mailbox's banner and avatar (cropped and scaled in the browser before they
  are uploaded). The new and detail forms have a **Mailbox** selector.
- **`AvailabilityEditor`**, moved from `@rapidmx/web-client`, and **`bookingApi`**, moved from `@rapidmx/react-shared`,
  both under `apps/shared`.
- The package ships the TSX sources (`apps`) for the server's Vite build and a compiled `dist/apps` for server-side
  rendering.

### Requirements

- Peers: `@rapidmx/restapi` >=0.12.0 <1, `@rapidrest/core` 5.x, `@rapidrest/service-core` 2.x,
  `@rapidmx/react-shared` >=0.6.0 <1, `@rapidmx/web-client` >=0.6.0 <1, `react` and `react-dom` 19.x.
- A server that builds and serves plugin UI. On an older server the API still works, but the pages aren't served.
