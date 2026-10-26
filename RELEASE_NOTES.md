# Release Notes

## Unreleased

### Added

- **Protected bookings for hosts whose calendar is zero-access encrypted.** When zero-access encryption covers the host's calendar (restapi 0.35's per-type switch, "What to protect" in the web client's encryption settings), the booking page encrypts what the booker writes before it is sent: their name, phone number, notes and other answers are sealed in the booker's browser, once for the host's zero-access key and once for a temporary key belonging to the booking. The server stores only placeholders (the booker's email address as their name, every other field empty), so administrators, storage and backups can't read the booking. The booker's manage link and a minted video link carry the booking key after `#k=`, so the confirmation and manage pages open the booking in the browser; the host sees it in Booking Links once their mailbox is unlocked. The booking page receives the host's zero-access certificate with the booking type, and a protected host refuses an unprotected booking (400 "This booking page is out of date - reload it to book."), so a booking page opened before the host's calendar became protected must be reloaded. Mail to the booker (confirmation, reschedule, new video link) is composed from what the request carries, never from the stored placeholders.
- **A booking's calendar event and the host's Inbox notification are sealed while zero-access covers them.** The event's title, location and description are stored only sealed when the host's calendar is protected, and the invitation mailed to the booker is composed from the booking instead. The new-booking, reschedule and cancel notifications are filed sealed when the host's mail is protected; a notification that can't be filed sealed leaves out what the booker wrote.
- **A protected booking's key is discarded once it is over.** The new `BookingKeyExpiryJob` (exported from `./mongo` and `./sql`, so the server registers it with the plugin) discards the booker's sealed copy, the booking key's certificate, its signature and its wrap an hour after the booking ends (and never more than a week after it), soonest first, up to 200 bookings a run. The host's own sealed copy is kept. Its schedule is `mail:booking:key_expiry:schedule` (default `0 */5 * * * *`, every five minutes). Rescheduling moves the expiry to the new slot's end, and moves the minted video meeting's key expiry with it. After expiry the manage link no longer opens the booking, and the host can no longer change its video link.
- **A protected video booking gets a protected video meeting** when `@rapidmx/meet-plugin` 0.18 or later is installed: the meeting is minted with the booking's key and its title sealed, and the booker's name is never handed to it. With an older meet-plugin, no meeting is minted for a protected booking (a warning is logged) and the host sets the link.

### Changed

- **What a host and a booker need for a protected booking.** The booker must open their manage link exactly as it was mailed: without its key the page says so and Reschedule is disabled (400 "Open your booking's link exactly as it was sent to you to reschedule it."); Cancel still works. The host must have their mailbox unlocked to read a protected booking or change its video link (400 "Unlock your mailbox to change a protected booking's video link."). A cancellation mailed for a protected booking carries only the placeholders, and server-side searches see only the placeholders.
- **A protected booking's key is mailed only where its copy can't be stored readable.** The keyed manage and video links go to a booker on another server, or to a mailbox on this server whose mail is zero-access encrypted. Any other address in this server's domains (a list, an unknown address) gets the links without the key, as restapi's meeting invitations do, and a warning naming the booking is logged; the confirmation page still shows the keyed links. Keyed mail asks for a headers-only bounce, so a mistyped address doesn't return the key to the host's mailbox; through a transport that can't ask for one (SES), the key is left off unless the host's own mail is zero-access encrypted.
- **Builds and is tested against `@rapidmx/restapi` 0.35, `@rapidmx/web-client` 0.37 and `@rapidmx/meet-plugin` 0.18, and needs restapi 0.35 and web-client 0.37 or later.** restapi 0.35 extends zero-access encryption to calendar events, contacts and tasks, each with its own switch, adds protected video meetings with a temporary per-meeting key, and adds OpenPGP as a second end-to-end format alongside S/MIME. web-client 0.37 brings the per-type "What to protect" settings, opens protected events, contacts and meetings on the device, and gives each mailbox an OpenPGP key. meet-plugin 0.18 brings protected meetings, a hardened media relay and signaling, and the removal of a kicked participant on every replica at once. meet-plugin stays optional: without 0.18, protected bookings get no minted video meeting.

### Fixed

- **Saving a booking's video link without editing it no longer clears it.** Booking Links now sends the URL the field shows, so saving it unchanged keeps the link (and, for a protected booking, keeps the key in later mail).
- **A host's Inbox notification is no longer stored readable when the host's mail is zero-access encrypted.** It used to be filed as plain mail. It is now sealed, and a seal that fails partway removes the encrypted copy it stored instead of leaving it behind.
- **A booker who seals something other than text can't break the host's Booking Links page.** An opened field that isn't text is dropped (or, for the name, replaced by the booker's address), and a video link change for such a booking is refused.
- **A reschedule or video link change never mails the booker an invitation built from placeholders.** Both are refused without the booker's plaintext, and a Booking Links page loaded before the mailbox was unlocked opens the booking again before saving.
- **Expired protected bookings are discarded soonest first**, so bookings far in the future can't keep expired ones from being processed.

### Security

- **The host's client can't be used to decrypt data for a booker.** Before the host's page sends a protected booking's details back to the server (when changing its video link), it checks that the booking key it unwrapped is the one the booking's certificate names, that this key signed the booker's address (the new `keyBinding`, which the booking page creates and the server requires and stores), and that the booker's copy holds exactly what the host's copy does. A booker can no longer plant some other sealed data in a booking to have it mailed back to them in plaintext. A REST client that creates protected bookings must send `protection.keyBinding` (400 without it).
- **The dependency audit passes again.** Fixed versions of follow-redirects, source-map-js, handlebars, undici, dompurify and vite are forced through `resolutions` (development dependencies only). Only node-forge's advisory 1240912 (GHSA-86w9-cpqp-85rv), which has no fixed release and comes in through `acme-client`, is ignored, in `.yarnrc.yml`; the exception will be removed once acme-client or node-forge ships a fix.

## v0.13.0

## v0.12.0

## v0.11.0

## v0.10.2

## v0.10.1

## v0.10.0

## v0.9.0

## v0.8.0

### Fixed

- **A booker's cancel now takes the meeting off the host's calendar, and both a cancel and a reschedule put a notification in the host's Inbox.** Cancelling through the manage link only marked the event `cancelled`, which the calendar still draws, so the meeting stayed on the host's calendar (the booker's iTIP `CANCEL` still went out from `MeetingSchedulingJob`). The event is now also deleted, as if the host had deleted the meeting - a soft delete, so the job still sees it and mails the cancellation - and a repeat cancel finishes it if an earlier attempt stopped after marking it cancelled. The host was told nothing when a booking was cancelled or moved, only when one was made: they now get an unread message, "Booking cancelled: <meeting> with <booker>" (when it was) or "Booking rescheduled: <meeting> with <booker>" (the new time and the previous one), filed the same way as the new-booking notification (best-effort, no invite, Reply-To the booker). Only the request that actually cancels notifies; a repeat does not.
- **Uploading the booking page's banner or avatar failed with "This request is missing a valid CSRF token."** The upload sends the file's own bytes, so it can't go through `apiFetch()`, which is what echoes the CSRF cookie as `x-csrf-token`. It now adds the header itself with `withCsrfHeader()` from `@rapidmx/react-shared`, like the branding uploads.

## v0.7.0

## v0.6.1

## v0.6.0

### Changed

- Builds and is tested against `@rapidmx/restapi` 0.23.0, `@rapidmx/react-shared` 0.19.0, `@rapidmx/web-client` 0.17.2 and `@rapidmx/meet-plugin` 0.5.0, and needs those versions or later. web-client 0.17.0 runs its pages on the router of `@rapidrest/react` 2.1.0, which is now a peer dependency (`>=2.1.0 <3`). The plugin's own code is unchanged. A minor bump because all of them are minor releases.

## v0.5.2

### Changed

- Raise the `@rapidmx/restapi` peer floor to `>=0.22.1`, `@rapidmx/react-shared` to `>=0.18.0` and `@rapidmx/web-client` to `>=0.16.0`, with the development dependencies and `resolutions` at the same versions, so the plugin is built and tested against the current packages.

### Added

- **A new booking puts a notification in the host's Inbox.** A booking used to appear only as an event on the calendar, so nothing in the inbox said one had been made. The host now gets an unread message, "New booking: <meeting> with <booker>" (or "Booking request: ..." when the booking type requires approval, saying it is awaiting their confirmation), with who booked, when in the booking type's own time zone, where or how the meeting happens, the booker's notes and time zone, and a Reply-To of the booker. It is filed straight into the mailbox, the way the server files its delivery failure notices - it is not mailed - so it doesn't depend on the mail transport or on a message from a local address passing SPF/DMARC on the way back in, and it is shown at once in a connected client. It comes from `bookings@<the mailbox's domain>` and is marked `Auto-Submitted`. It carries no iCalendar invite: a `text/calendar` part would be processed as a meeting request and put a second event on the calendar. It is best-effort like the booker's confirmation (a failure is logged, never thrown at the booker) and is for a new booking only - not a booker's cancel or reschedule. Needs the `Message` model of the server's backend, which the server always has.
- **Everyone in a booking gets a 15 minute reminder.** The host's calendar event has one (`reminderMinutesBeforeStart: 15`, which the calendar shows as its notification and `CalendarReminderJob` delivers), and the invitation mailed to the booker carries it as an alarm (`VALARM`, `TRIGGER:-PT15M`), so their calendar reminds them too - whether their client honours an alarm in an invitation is up to it. Bookings had none. A booker's invitation is the confirmation, a reschedule and the update after the host sets the video link.

### Fixed

- **A booking's calendar event now carries its location, and the details of the booking.** The event had no `location`, so the calendar (and the invitation mailed to the booker) showed "Add a room" while the video link was only in the confirmation mail, and its description was empty, so the event on the host's calendar had no link, no phone number and none of the booker's notes. The `location` is the video call's URL, `Phone: <number>` for a phone booking, or the booker's instructions (one line, at most 200 characters) for another location - none for a video call whose link isn't set yet. The description says who booked (name and address), the location line (the link, "call <name> at <number>", or the instructions - the whole text) and the booker's notes, as plain text and as HTML in which the link is clickable; everything the booker typed is escaped, and their name is put on one line. The booker's manage link is deliberately left out, since anyone the calendar is shared with can read the event.
- **Setting or clearing a booking's video link as the host (`POST /host/:uid/location`) now updates the calendar event too, and mails the booker the updated invitation.** It changed only the booking, so an event created before the link was known kept showing none. The event's location and description follow, its `sequence` is raised, and the booker is sent the updated invitation at once (with the manage link and the reminder, like a reschedule) instead of leaving it to `MeetingSchedulingJob`'s generic one. If the host's mailbox no longer exists nothing is sent from here and the job is left to it.


## v0.5.1

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
