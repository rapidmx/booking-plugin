# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/RapidMX/booking/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/RapidMX/booking/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/RapidMX/booking/compare/v0.1.0...v0.2.0
