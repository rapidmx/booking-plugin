# Release Notes

## Unreleased

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
