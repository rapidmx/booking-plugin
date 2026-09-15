# Release Notes

## Unreleased

> **Before publishing:** `package.json` `resolutions` and `devDependencies` still link `@rapidmx/restapi`,
> `@rapidmx/react-shared` and `@rapidmx/web-client` from sibling checkouts (`portal:../restapi`,
> `portal:../react-shared`, `portal:../web-client`). Replace them with the published releases that remove booking from
> core (restapi 0.12.0, react-shared 0.6.0, web-client 0.6.0 or later), run `yarn install`, and rerun the tests before
> `npm publish`.

First release. Booking moves out of core into this plugin, with its API, its data and its pages.

### Backend

- **Models:** `BookingType` and `Booking` (with `BookingStatus`, `BookingAvailabilityWindow` and
  `BookingDateOverride`), as `BookingTypeMongo`/`BookingMongo` and `BookingTypeSQL`/`BookingSQL`. The class names,
  collections and tables, indexes and the `BookingType`/`Booking` class ACLs are unchanged from `@rapidmx/restapi` 0.11,
  so existing data is used as is. Both are `@MailboxScopedData()`, so a mailbox erasure removes them.
- **Routes:** `BookingTypeRouteMongo`/`BookingTypeRouteSQL` at `/api/mail/booking-types` and
  `BookingRouteMongo`/`BookingRouteSQL` at `/api/mail/bookings`, the same paths and behavior as before. The abstract
  `BaseBookingTypeRoute` and `BaseBookingRoute` are exported from the package root.
- **Utilities:** `generateCandidateSlots`, `subtractBusy`, `normalizeSlug` and `validateAvailability`.
- **Entry points:** `./mongo` and `./sql` export only the four models and four routes the server loads.

### Manifest

- `apiVersion` 1, `mailboxScopedData: true`.
- **Setting:** `mail:booking:public_url` (string, empty by default), the base URL of the public booking pages used for
  the manage link in booking emails.
- **UI:** the `book` app on the public host at `/book`, the `booking-types` app on the webmail host at
  `/settings/booking-types`, and a **Booking Links** settings section.

### UI

- **Public pages** (`apps/book`), moved from the server: `/book`, `/book/:slug` and `/book/manage/:token`, with slot
  paging (`_slotPaging`).
- **Settings pages** (`apps/settings-booking-types`), moved from `@rapidmx/web-client`: the list, new and detail pages.
  They pass `pluginNav` through to `SettingsShell` with `active="booking-types"`. The app has its own `_layout`, a copy
  of the web client's webmail layout.
- **`AvailabilityEditor`**, moved from `@rapidmx/web-client`, and **`bookingApi`**, moved from `@rapidmx/react-shared`,
  both under `apps/shared`.
- The package ships the TSX sources (`apps`) for the server's Vite build and a compiled `dist/apps` for server-side
  rendering.

### Requirements

- Peers: `@rapidmx/restapi` >=0.12.0 <1, `@rapidrest/core` 5.x, `@rapidrest/service-core` 2.x,
  `@rapidmx/react-shared` >=0.6.0 <1, `@rapidmx/web-client` >=0.6.0 <1, `react` and `react-dom` 19.x.
- A server that builds and serves plugin UI. On an older server the API still works, but the pages aren't served.
