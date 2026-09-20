# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/RapidMX/booking/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/RapidMX/booking/compare/v0.1.0...v0.2.0
