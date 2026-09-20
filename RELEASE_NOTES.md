# Release Notes

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
