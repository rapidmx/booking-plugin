# RapidMX: Booking

[![CI](https://github.com/RapidMX/booking/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/RapidMX/booking/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/RapidMX/booking/badge.svg?branch=main)](https://coveralls.io/github/RapidMX/booking?branch=main)
[![npm version](https://img.shields.io/npm/v/@rapidmx/booking-plugin)](https://www.npmjs.com/package/@rapidmx/booking-plugin)

Calendly-style booking pages for a [RapidMX server](https://github.com/RapidMX/server). A mailbox owner publishes
booking links (booking types), each offering one or more meeting types (e.g. "15 Minute Chat" / "60 Minute Consultation")
with their own duration and choice of locations (phone, video call, or a custom "other"). Anyone with a link picks a
meeting type, an open slot from the owner's live calendar (availability is shared across all of a link's meeting types),
and how to meet, and books it with no account. The booker gets a confirmation email with a link to cancel or reschedule.

This plugin used to be part of `@rapidmx/restapi`, `@rapidmx/react-shared`, `@rapidmx/web-client` and the server. Room
and resource booking (a resource mailbox's auto-accept and booking window) is unrelated and stays in core.

## What it adds

- **API**:
  - `/api/mail/booking-types`: the owner's booking types, permission-checked against the owning mailbox like any other
    mailbox-scoped entity. A slug is unique within its mailbox, and the calendar folder must be a calendar of the same
    mailbox that the caller can read. A booking type can be moved to another mailbox until it has its first booking.
  - `/api/mail/booking-profiles`: the avatar and banner shown on a mailbox's booking pages. `POST` and `DELETE`
    `/:mailboxUid/avatar` and `/:mailboxUid/banner` need update permission on the mailbox (the image is the raw request
    body, PNG, JPEG, GIF or WebP, up to 2 MiB for an avatar and 5 MiB for a banner, kept in the server's blob store);
    `GET /:mailboxUid` needs read permission; `GET` of an image is public.
  - `/api/mail/bookings`: the anonymous half. `GET /types/:mailboxUid/:slug` shows a booking type, including its
    `meetingTypes` (each with a duration and its own `locationOptions`); `GET /types/:mailboxUid/:slug/slots` takes a
    required `meetingTypeUid` and shows that meeting type's open slots; `POST /types/:mailboxUid/:slug` books a slot,
    given a `meetingTypeUid` and `locationOptionUid` (plus a phone number or free-text instructions, when the chosen
    location needs one); `GET /manage/:token` with `POST /manage/:token/cancel` and `POST /manage/:token/reschedule`
    manage a booking. Every write is rate limited. Two more endpoints are host-authenticated rather than anonymous:
    `GET /host?bookingTypeUid=` lists a booking type's bookings, and `POST /host/:uid/location` sets or clears a
    booking's video call URL - the escape hatch for a video location left blank when the meeting type was configured,
    or to hand out a unique link for one booking.
- **Public booking pages** at `/book/:mailboxUid/:slug` (for example `/book/jp@example.com/intro-call`) and
  `/book/manage/:token` (the `book` app, on the server's public host). A page shows the host's name, avatar and banner,
  the booking type, and the open times.
- **Settings → Booking Links** at `/settings/booking-types` (the `booking-types` app, on the webmail host), listed in the
  Settings sidebar: each link can be copied from the list, belongs to a mailbox chosen in the form, and the page sets the
  mailbox's booking page avatar and banner.

## Install

Add it in the server's admin console (**Plugins**), or list it in the server's `system:plugins:defaults` so a new
deployment starts with it. Every server copy installs enabled plugins with npm at startup and restarts when they change.
To try a local build, point `system:plugins:sources` at a tarball from `npm pack`. Because the plugin ships
pages, the first start after installing, upgrading, enabling or disabling it rebuilds the server's browser bundles (see
the server README's "Plugin UI" section).

The package has two server entry points, `@rapidmx/booking-plugin/mongo` and `@rapidmx/booking-plugin/sql`, each
exporting only the models and routes the server loads. The package root exports the backend-agnostic surface: the
`Booking`/`BookingType`/`BookingMeetingType`/`BookingLocationOption` types, `BookingStatus`/`BookingLocationType`, the
slot utilities (`generateCandidateSlots`, `subtractBusy`, `normalizeSlug`, `validateAvailability`) and the abstract
`BaseBookingRoute`/`BaseBookingTypeRoute`.

Peer dependencies: `@rapidmx/restapi` 0.12 or later, `@rapidrest/core` 5, `@rapidrest/service-core` 2,
`@rapidmx/react-shared` 0.6 or later, `@rapidmx/web-client` 0.6 or later, and React 19.

## Settings

| Key | Default | Use |
| --- | --- | --- |
| `mail:booking:public_url` | `""` | The address of the public booking pages, for example `https://mail.example.com/book`. Confirmation emails include the manage link (`<public_url>/manage/<token>`) only when it's set. The server's Helm chart sets it to `<publicUrl>/book`. |

The anonymous endpoints use the server's shared `rateLimit` settings. Their defaults are tuned for sign-in, so a
deployment that exposes booking pages should raise `rateLimit.maxAttempts` enough for a visitor to page through a few
weeks of availability.

## UI

The pages are TSX sources under `apps/`, with a compiled copy under `dist/apps` for server-side rendering, the same way
`@rapidmx/web-client` ships its pages. The server builds them together with its own apps, so they share its React,
`@rapidmx/react-shared` state and stylesheet. They use only the supported plugin UI surface of `@rapidmx/web-client`
(`SettingsShell`, `BrandingChrome`) and `@rapidmx/react-shared` (branding, API client, buttons, alerts, forms and
modals).

- `apps/book`: the public pages. They render their own branding header and footer and get the web client's stylesheet
  from the server's build.
- `apps/settings-booking-types`: the list, new and detail pages. Each passes its props, including `pluginNav`, to
  `SettingsShell` with `active="booking-types"`, so the Booking Links entry is highlighted. The detail page also lists
  the link's recent bookings and lets the host set a video booking's meeting URL after the fact.
- `apps/shared`: `bookingApi.ts` (the typed API client), `AvailabilityEditor` and `MeetingTypesEditor` (a booking link's
  meeting types and their location options).

## Data

Existing booking types and bookings carry over when a server moves from core booking to this plugin. The models keep
their class names (`BookingTypeMongo`, `BookingMongo`, `BookingTypeSQL`, `BookingSQL`), so they use the same collections
and tables (`booking_type_sql`, `booking_sql` and the Mongo equivalents), the same indexes and the same `BookingType` and
`Booking` class ACLs. Nothing is migrated.

Both models are marked `@MailboxScopedData()` and the manifest declares `mailboxScopedData: true`. A mailbox erasure
removes the mailbox's booking types and bookings through the server's generic purge of mailbox-scoped plugin data, and
waits while this plugin is installed but not loaded. With the plugin uninstalled, booking rows already in the database
are left behind by an erasure.

`BookingType.durationMinutes` was replaced by `BookingType.meetingTypes` (see [RELEASE_NOTES.md](RELEASE_NOTES.md)) -
a breaking change to this plugin's own schema, with no migration. An existing `BookingType` row from before that
change has no `meetingTypes`, so its public booking page has no meeting type to offer; edit and save the link in
Settings to give it one.

## Development

```sh
yarn install
yarn vitest run --coverage   # Mongo and SQL route suites, utilities, pages; coverage gates
yarn lint
yarn build                   # tsc into dist/lib, dist/types and dist/apps
```

The Mongo suites start `mongodb-memory-server` on port 9999, like the other RapidMX backend repos, so don't run them at
the same time as another repo's suites. During development `@rapidmx/restapi`, `@rapidmx/react-shared` and
`@rapidmx/web-client` are linked from sibling checkouts (see `resolutions` in `package.json`); build their `dist` first.

## License

[MPL-2.0](LICENSE)
