///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { BaseEntity } from "@rapidrest/service-core";

/**
 * A single recurring weekly window during which a `BookingType` can be booked, expressed in that booking
 * type's own `timezone` as minutes from local midnight (so `540`-`1020` is 09:00-17:00 local, and stays
 * 09:00-17:00 local across a daylight-saving transition rather than drifting by an hour the way a stored UTC
 * instant would).
 */
export interface BookingAvailabilityWindow {
    /** The day of the week this window applies to: `0` (Sunday) through `6` (Saturday). */
    dayOfWeek: number;

    /** The inclusive start of the window, in minutes from local midnight. */
    startMinute: number;

    /** The exclusive end of the window, in minutes from local midnight. `1440` is the end of the day. */
    endMinute: number;
}

/**
 * Replaces a `BookingType`'s weekly `availability` for one specific calendar date - the "I'm only free in the
 * morning that Tuesday" / "I'm out that Friday" escape hatch.
 *
 * `date` is a plain `YYYY-MM-DD` string rather than a `Date` for two independent reasons. Semantically it is a
 * local calendar date in the booking type's `timezone`, not an instant - a `Date` would have to pick some
 * arbitrary UTC time of day to represent "the 4th of July" and would then land on the wrong day for a caller in
 * a different zone. Practically, this type is stored inside a `simple-json` column on the SQL backend, which
 * round-trips through `JSON.stringify`/`JSON.parse` with no transformer, so a nested `Date` comes back out as
 * an ISO *string* anyway (the same latent trap `RecurrenceRule.until`/`exceptions` already sit in) - a field
 * that is genuinely a string to begin with can't be silently mistyped that way.
 */
export interface BookingDateOverride {
    /** The local calendar date, in the booking type's `timezone`, as `YYYY-MM-DD`. */
    date: string;

    /** The windows available on that date. An EMPTY array is meaningful and deliberate: it is a blackout, i.e.
     * the day is closed even though the weekly `availability` would otherwise open it. */
    windows: BookingAvailabilityWindow[];
}

/**
 * Defines a single bookable offering owned by a `Mailbox` - the Calendly-style "30 minute intro call" a
 * completely unauthenticated visitor can pick a slot from and book. Availability is expressed as recurring
 * weekly `availability` windows plus per-date `dateOverrides`, and is intersected at request time against the
 * owning mailbox's real calendar (see `@rapidmx/restapi`'s `computeBusyWindows()`) so a slot is only ever offered if the host is
 * genuinely free.
 *
 * Anonymous access to this entity is NOT granted through the `AccessControlList` - the class ACL is deny-all
 * like every other admin/owner-managed entity here, and `BaseBookingRoute` (the public route) does its own
 * authorization by `slug`/token and reads with `ignoreACL: true`. Granting `"anonymous"` an action in a class
 * ACL would leak far more than intended; see the note on `BaseMailboxRoute` for the incident that documents.
 *
 * @author Jean-Philippe Steinmetz
 */
export interface BookingType extends BaseEntity {
    /** The unique identifier of the `Mailbox` that owns this booking type. Managing it (create/list/update/
     * delete) is permission-checked against this mailbox's `AccessControlList`, the same as every other
     * mailbox-scoped child entity - see the architecture note on `Message.mailboxUid`. */
    mailboxUid: string;

    /** The unique identifier of the `Folder` (of type `CALENDAR`) bookings are written into, and whose existing
     * events are treated as busy time. */
    calendarFolderUid: string;

    /** The URL-safe public identifier for this booking type (the `intro-call` in `/book/jp@example.com/intro-call`).
     * Normalized to lowercase and unique within its `mailboxUid` - two mailboxes may each have an `intro-call` -
     * and collision-checked on create/update. Unlike `Domain`, whose `uid` *is* its name, this is an ordinary
     * mutable indexed field - `RepoUtils.update()` requires `obj.uid === existing.uid`, so a uid-derived slug could
     * never be renamed. */
    slug: string;

    /** The public-facing name of the offering, e.g. "30 Minute Intro Call". */
    name: string;

    description?: string;

    /** The host's name as shown to an anonymous booker. Denormalized onto this entity deliberately: an
     * unauthenticated caller cannot read the owning `Mailbox` or `Folder` record to look it up, which is the
     * exact remedy `BaseFolderRoute`'s doc comment prescribes for this situation. */
    hostDisplayName: string;

    /** How long a single booking lasts, in minutes. */
    durationMinutes: number;

    /** The IANA timezone identifier `availability`/`dateOverrides` are authored in. Validated on write by
     * round-tripping it through `convertLocalToUtc()`, which returns `undefined` for a name ICU doesn't know. */
    timezone: string;

    /** The recurring weekly windows this type can be booked in. */
    availability: BookingAvailabilityWindow[];

    /** Per-date replacements for `availability`. A date present here wins outright for that date. */
    dateOverrides: BookingDateOverride[];

    /** How far apart consecutive candidate slot start times are, in minutes. Defaults to `durationMinutes`
     * (back-to-back slots) when unset. */
    slotIntervalMinutes?: number;

    /** Padding kept clear immediately before a booking, in minutes - a slot whose padded window collides with
     * existing busy time is not offered. */
    bufferBeforeMinutes: number;

    /** Padding kept clear immediately after a booking, in minutes. */
    bufferAfterMinutes: number;

    /** The minimum lead time, in minutes, between now and a bookable slot's start. */
    minimumNoticeMinutes: number;

    /** How far into the future slots are offered, in days from now. */
    bookingWindowDays: number;

    /** The maximum number of non-cancelled bookings allowed on any single local date. Unset means unlimited.
     * This is an availability control, NOT abuse protection - see `BaseBookingRoute`'s doc comment. */
    maxPerDay?: number;

    /** When `true`, a new booking lands as `PENDING` with a `TENTATIVE` calendar event for the host to confirm,
     * rather than auto-confirming. */
    requiresApproval: boolean;

    /** When `false`, the public endpoints behave as though this booking type does not exist (404). */
    enabled: boolean;
}

export enum BookingStatus {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    CANCELLED = "cancelled",
}

/**
 * A single appointment booked against a `BookingType` by an anonymous visitor. Pairs 1:1 with a real
 * `CalendarEvent` in the host's calendar (`calendarEventUid`) - the event is what the host and every connected
 * client see, while this row carries the booker-facing details and the `manageToken` that lets the booker come
 * back later to cancel or reschedule without ever having an account.
 *
 * @author Jean-Philippe Steinmetz
 */
export interface Booking extends BaseEntity {
    /** The unique identifier of the `BookingType` this was booked against. */
    bookingTypeUid: string;

    /** The unique identifier of the host `Mailbox`, denormalized from the booking type so the host's bookings
     * can be listed without a join. */
    mailboxUid: string;

    /** The unique identifier of the `Folder` (of type `CALENDAR`) holding `calendarEventUid`. */
    folderUid: string;

    /** The unique identifier of the `CalendarEvent` created for this booking. */
    calendarEventUid: string;

    bookerName: string;

    /** The booker's email address, normalized to lowercase. Where the confirmation and the manage link are sent. */
    bookerEmail: string;

    bookerNotes?: string;

    /** The IANA timezone the booker selected their slot in, recorded purely so the host can see it. Never used
     * for any scheduling math - the slot itself is stored as absolute instants. */
    bookerTimezone?: string;

    startDate: Date;

    endDate: Date;

    status: BookingStatus;

    /** The unguessable token embedded in the booker's manage link, minted server-side (32 random bytes) and
     * immutable thereafter. This is the booker's ONLY credential; unlike `CalendarShareLink.token` it is not an
     * `ACLRecord` on anything, since `BaseBookingRoute` resolves it directly rather than going through the ACL
     * system. It has no expiry and no GC job - see that route's documented limitations. */
    manageToken: string;

    cancelledAt?: Date;
}

/**
 * The look of a mailbox's public booking pages: the avatar and banner shown above every one of the mailbox's booking
 * types. One row per mailbox, whose `uid` is the mailbox's own `uid` (its address) so it is found without a query and
 * can never be duplicated.
 *
 * The images themselves live in the server's `BlobStore`, like `Branding`'s logo, and are served publicly - the pages
 * are anonymous - by `BaseBookingProfileRoute`. Deleting the mailbox removes this row (it is `@MailboxScopedData()`),
 * but the host has no hook to remove the blobs a plugin row points at, so they are left behind.
 *
 * @author Jean-Philippe Steinmetz
 */
export interface BookingProfile extends BaseEntity {
    /** The unique identifier of the `Mailbox` this profile belongs to. Always equal to `uid`. */
    mailboxUid: string;

    /** The `BlobStore` key of the avatar image, if one has been uploaded. Route-managed, never client-set. */
    avatarBlobKey?: string;

    /** The media type the avatar was uploaded as. */
    avatarContentType?: string;

    /** The `BlobStore` key of the banner image, if one has been uploaded. Route-managed, never client-set. */
    bannerBlobKey?: string;

    /** The media type the banner was uploaded as. */
    bannerContentType?: string;
}
