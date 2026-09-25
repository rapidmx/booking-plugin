# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-09-25

### Changed
- Raise the @rapidmx/restapi, @rapidmx/react-shared and @rapidmx/web-client peer floors to 0.21.1, 0.16.0 and 0.15.1, set the development dependencies and resolutions to the same versions and the optional @rapidmx/meet-plugin to 0.4.1, so the plugin is built and tested against the current packages
- Register a SearchProvider test double in the route tests, since @rapidmx/restapi now injects one into every scoped route
- Document the change in the release notes

## [0.5.0] - 2026-09-24

### Added
- Added a requireNoBookings() guard to BaseBookingTypeRoute.delete(), matching update()'s existing mailbox-move guard, so deleting a booking type with active or pending bookings no longer orphans them and breaks manage()/cancel()/reschedule()/hostListBookings()/setBookingLocationVideoUrl() for those bookings
- Added type: "text" to BookingSQL.locationVideoUrl to match this file's own convention for fields validated past 255 characters, avoiding silent truncation on a MySQL/MariaDB deployment
- Added regression tests for the new delete() guard to bookingTypeMailboxSuite.ts, covering the 409-with-bookings, 204-with-none, and 403-without-permission cases on both backends
- Added tests for BookingUtils.validateMeetingTypes() rejecting an invalid meeting-type or location-option uid, an over-long label, and an over-long videoUrl
- Added a test confirming BaseBookingTypeRoute.normalizeMeetingTypeUids() preserves an edited-in-place meeting type's and location option's existing uid instead of minting a new one
- Added tests for BaseBookingRoute's bookerPhone and bookerLocationInstructions length and type validation, checked unconditionally regardless of the chosen location type
- Added tests for the /host endpoints' 400 and 404 paths, including clearing a previously-set video URL back to unset and a booking whose own booking type was deleted
- Added a test for manageUrl() omitting the cancel/reschedule line when no mail:booking:public_url is configured
- Added a test for checkBookingRateLimit() falling back to an unknown address bucket when called with no HttpRequest, the same category as the existing "params HTTP can't produce" cases
- Added tests completing a phone and an "other" location booking on the public booking page, and for its error message when reloading slots for a newly-chosen meeting type fails
- Added tests for the booking-type detail page's bookings list load failure, its loading indicator, saving a video URL's own failure path, clearing a video URL, and one booking's save leaving a sibling booking untouched
- Added tests for MeetingTypesEditor's remove-location-option success path, editing a label or video URL back to unset, and editing one meeting type or location option without touching its sibling
- Added test/apps/book/_locationSummary.test.ts covering the phone and "other" location summary cases, only video having been exercised before via the pages
- Added a test for the new-booking-type page's "every meeting type needs a name and at least one location option" validation guard
- Added v8 ignore comments to two genuinely unreachable guards in the public booking page's handleLoadMore() and handleSubmit(), both already provably dead given the surrounding effect/button-render guarantees
- Added stripTrustedRoles() (new src/util/RouteAccessUtils.ts) and apply it at three raw ACLUtils.hasPermission() call sites (BaseBookingProfileRoute.requireMailboxPermission(), BaseBookingRoute.requireMailboxPermission(), BaseBookingTypeRoute.requireBookableFolder()) so a trusted admin-role caller with no explicit grant on a mailbox is refused exactly like a stranger instead of bypassing the check
- Added regression tests for all three fixes across both backends and document the findings in NOTES.md

### Changed
- Override truncate() on BaseBookingTypeRoute to run requireNoBookings() against every matched booking type before deleting any of them, refusing the whole bulk call (409) if any has a booking, closing the gap delete()'s own guard left open via the inherited, unguarded bulk endpoint
- Upgraded rapidrest and rapidmx deps

### Fixed
- Fixed this package's pre-existing coverage gate gap, closing it from 97.96%/94.7%/98.06%/97.96% to 100%/98.88%/100%/100% against its own 100/95/100/100 gate
- Fixed countBookingsOnDay() to resolve a local calendar day's end via convertLocalToUtc() on the next calendar day instead of adding a flat 24 hours, so maxPerDay is no longer wrongly enforced or wrongly bypassed on a DST spring-forward or fall-back day

## [0.4.0] - 2026-09-23

### Changed
- Fill in a video location's meeting link automatically at booking time when @rapidmx/videoconf-plugin is installed and active and the host hasn't set one, minting a private meeting with the booker as its sole invitee
- Detect and call the plugin only at runtime, through an optional dependency and a dynamic import that never fails the booking itself, so this plugin keeps working exactly as before wherever video conferencing isn't installed
- Test every case on both backends, including the plugin reporting active while the import or the call itself genuinely fails
- Document the integration in the release notes and NOTES, including the pre-existing coverage gate failure this work found but does not touch
- Updated rapidmx deps
- Renaming videoconf-plugin to meet-plugin

## [0.3.0] - 2026-09-22

### Added
- Added an onPurge hook, exported as @rapidmx/booking-plugin/purge, that deletes the booking profile images from the blob store by their keys when the plugin is uninstalled with its data, since the images are only findable through rows the purge deletes
- Added BookingMeetingType and BookingLocationOption to BookingType, replacing the single durationMinutes with meetingTypes so one booking link can offer several meeting types, each with its own duration and location options, sharing the link's own availability
- Added BookingLocationType (phone, video, other) and snapshot a booking's chosen meeting type and location onto it at booking time, so editing or removing a meeting type or location option later never changes an existing booking
- Added GET /host and POST /host/:uid/location to BaseBookingRoute, letting a host list a booking type's bookings and set or clear a video booking's meeting URL after the fact, permission-checked against the booking's own mailbox
- Added normalizeMeetingTypeUids to BaseBookingTypeRoute, assigning a uid to any new meeting type or location option on create or update while preserving an existing one
- Added MeetingTypesEditor, replacing the single duration field on the new and detail booking link forms with an editor for a link's meeting types and their location options
- Added an Upcoming bookings section to the booking link detail page, with an inline control to set a video booking's meeting URL

### Changed
- Abort the purge without deleting anything when an image can't be removed, so the rows survive and a retry can find the rest
- Test the hook against found, missing and failing images
- Document the hook in the release notes and NOTES, including what the server removes itself and what this plugin must
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Change the public and booking APIs to require meetingTypeUid on the slots endpoint and meetingTypeUid plus locationOptionUid on book, validating a phone number or free-text instructions when the chosen location needs one
- Change generateCandidateSlots to take the slot duration as an explicit parameter instead of reading it off the booking type, and change reschedule to keep a booking's own original duration rather than re-deriving it from meetingTypes
- Change the public booking page to offer a meeting type selector when a link has more than one, reloading slots for the chosen one, and a location selector with the matching detail field once a time is picked
- Change the manage and confirmation pages to show a booking's location
- Update the README, release notes and NOTES for the new meeting types and locations, including the breaking, unmigrated change to BookingType's shape
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

## [0.2.0] - 2026-09-20

### Added
- Added a Copy link button for each booking link on the Booking Links list, copying its full public URL
- Added a Mailbox selector to the new and edit booking link forms, moving a link to the chosen mailbox's calendar and refusing the move once the link has bookings
- Added BookingProfile models and the /api/mail/booking-profiles route for a per-mailbox booking page avatar and banner, stored in the blob store and served publicly
- Added a Booking page appearance card to the Booking Links list to upload or remove the banner and avatar, cropping and scaling images in the browser first
- Added tests for the mailbox-scoped booking API, moving booking types between mailboxes, the profile route and the new pages, components and API helpers

### Changed
- Change public booking links to /book/<mailboxUid>/<slug> and the public API to /types/:mailboxUid/:slug, making slugs unique per mailbox with the bookingtype_mailbox_slug index in place of bookingtype_slug
- Change the booking and manage pages to open with the host's banner, avatar and name, in a wider two-column card with larger text and the visitor's time zone
- Document the changes in the README, release notes and NOTES, including the MongoDB index that has to be dropped by hand and the images left behind by a mailbox erasure
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

### Fixed
- Fixed the booking pages drawing the deployment logo a second time under the branding header, and pushing the branding footer off screen

[Unreleased]: https://github.com/RapidMX/booking/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/RapidMX/booking/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/RapidMX/booking/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/RapidMX/booking/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/RapidMX/booking/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/RapidMX/booking/compare/v0.1.0...v0.2.0
