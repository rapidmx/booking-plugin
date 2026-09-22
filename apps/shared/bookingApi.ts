///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Typed wrappers over this plugin's booking API. Two distinct halves, both
 * mounted at `/mail/booking-types`/`/mail/bookings` (see `BaseBookingTypeRoute`/`BaseBookingRoute`), sharing this
 * file only because they're two views of the same feature — never used together in one request.
 *
 * Host-side (`listBookingTypes`/`createBookingType`/etc., and the booking page's avatar and banner) is an
 * ordinary mailbox-scoped surface, authenticated like every other mail API call, used by
 * `apps/settings-booking-types/**`. Public (`getPublicBookingType`/`getBookingSlots`/`bookSlot`/
 * `getBookingByToken`/`cancelBooking`/`rescheduleBooking`) is `BaseBookingRoute`'s entirely unauthenticated
 * half — no `jwt` cookie is ever sent or expected — used by `apps/book/**`, the plugin's public
 * (non-`AppShell`) pages.
 */

import { ApiRequestError, apiFetch, apiUrl } from "@rapidmx/react-shared/util/api.js";
import { ListParams, buildQuery } from "@rapidmx/react-shared/util/apiQuery.js";

export interface BookingAvailabilityWindow {
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
}

export interface BookingDateOverride {
    date: string;
    windows: BookingAvailabilityWindow[];
}

export enum BookingLocationType {
    PHONE = "phone",
    VIDEO = "video",
    OTHER = "other",
}

export interface BookingLocationOption {
    /** Omit when adding a new option - the server assigns one. Send back an existing option's uid to edit it in place. */
    uid?: string;
    type: BookingLocationType;
    label?: string;
    /** `VIDEO` only. Optional - may be left unset and filled in later per booking (see `setBookingLocationVideoUrl()`). */
    videoUrl?: string;
}

export interface BookingMeetingType {
    /** Omit when adding a new meeting type - the server assigns one. Send back an existing one's uid to edit it in place. */
    uid?: string;
    name: string;
    durationMinutes: number;
    locationOptions: BookingLocationOption[];
}

export interface BookingType {
    uid: string;
    version: number;
    dateCreated: string;
    dateModified: string;
    mailboxUid: string;
    calendarFolderUid: string;
    slug: string;
    name: string;
    description?: string;
    hostDisplayName: string;
    meetingTypes: BookingMeetingType[];
    timezone: string;
    availability: BookingAvailabilityWindow[];
    dateOverrides: BookingDateOverride[];
    slotIntervalMinutes?: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    bookingWindowDays: number;
    maxPerDay?: number;
    requiresApproval: boolean;
    enabled: boolean;
}

/** `encodeURIComponent()`, except that `@` stays as it is: it is legal in a path segment, and a mailbox's uid is its
 * address, so `jp@example.com` reads better in a link than `jp%40example.com`. */
function encodeMailboxUid(mailboxUid: string): string {
    return encodeURIComponent(mailboxUid).replace(/%40/g, "@");
}

/** The path of a booking type's public page, `/book/<mailbox>/<slug>`. */
export function bookingPublicPath(mailboxUid: string, slug: string): string {
    return `/book/${encodeMailboxUid(mailboxUid)}/${encodeURIComponent(slug)}`;
}

/** The full public URL of a booking type, on this site's own origin — what a host shares. Browser only. */
export function bookingPublicUrl(mailboxUid: string, slug: string): string {
    return `${window.location.origin}${bookingPublicPath(mailboxUid, slug)}`;
}

export function listBookingTypes(mailboxUid: string, params: ListParams = {}): Promise<BookingType[]> {
    return apiFetch(`/mail/booking-types?${buildQuery(params, { mailboxUid })}`);
}

export function getBookingType(uid: string): Promise<BookingType> {
    return apiFetch(`/mail/booking-types/${encodeURIComponent(uid)}`);
}

export interface CreateBookingTypeInput {
    mailboxUid: string;
    calendarFolderUid: string;
    slug: string;
    name: string;
    description?: string;
    hostDisplayName: string;
    meetingTypes: BookingMeetingType[];
    timezone: string;
    availability?: BookingAvailabilityWindow[];
    dateOverrides?: BookingDateOverride[];
    slotIntervalMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    bookingWindowDays?: number;
    maxPerDay?: number;
    requiresApproval?: boolean;
    enabled?: boolean;
}

export function createBookingType(input: CreateBookingTypeInput): Promise<BookingType> {
    return apiFetch("/mail/booking-types", {
        method: "POST",
        body: JSON.stringify({
            availability: [],
            dateOverrides: [],
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            minimumNoticeMinutes: 60,
            bookingWindowDays: 30,
            requiresApproval: false,
            enabled: true,
            ...input,
        }),
    });
}

export interface UpdateBookingTypeInput {
    uid: string;
    version: number;
    /** Moves the booking type to another mailbox; send `calendarFolderUid` of a calendar folder of that mailbox with it. */
    mailboxUid?: string;
    calendarFolderUid?: string;
    slug?: string;
    name?: string;
    description?: string;
    hostDisplayName?: string;
    meetingTypes?: BookingMeetingType[];
    timezone?: string;
    availability?: BookingAvailabilityWindow[];
    dateOverrides?: BookingDateOverride[];
    slotIntervalMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    bookingWindowDays?: number;
    maxPerDay?: number;
    requiresApproval?: boolean;
    enabled?: boolean;
}

export function updateBookingType(input: UpdateBookingTypeInput): Promise<BookingType> {
    return apiFetch(`/mail/booking-types/${encodeURIComponent(input.uid)}`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
}

export function deleteBookingType(uid: string, version: number): Promise<void> {
    return apiFetch(`/mail/booking-types/${encodeURIComponent(uid)}?version=${version}`, { method: "DELETE" });
}

/** Host-only. The most recent bookings made against `bookingTypeUid`, most recent first - see
 * `BaseBookingRoute.hostListBookings()`. Not paged - the route itself caps how many it returns. */
export function listHostBookings(bookingTypeUid: string): Promise<PublicBooking[]> {
    return apiFetch(`/mail/bookings/host?bookingTypeUid=${encodeURIComponent(bookingTypeUid)}`);
}

/** Host-only. Sets (or, with `undefined`, clears) one booking's video call URL - the escape hatch for a
 * `VIDEO` location option that was left blank at meeting-type setup time, or to hand out a unique link for
 * just this booking. 400 if the booking's location isn't `VIDEO`. */
export function setBookingLocationVideoUrl(uid: string, locationVideoUrl: string | undefined): Promise<PublicBooking> {
    return apiFetch(`/mail/bookings/host/${encodeURIComponent(uid)}/location`, {
        method: "POST",
        body: JSON.stringify({ locationVideoUrl }),
    });
}

// ---------------------------------------------------------------------------------------------------
// Public, unauthenticated half — `apps/book/**` only. Every function below hits `/mail/bookings/...`.
// ---------------------------------------------------------------------------------------------------

/** A `BookingLocationOption`'s public projection - `videoUrl` is left out (shown only after booking, see
 * `PublicBooking.locationVideoUrl`). */
export interface PublicLocationOption {
    uid: string;
    type: BookingLocationType;
    label?: string;
}

export interface PublicMeetingType {
    uid: string;
    name: string;
    durationMinutes: number;
    locationOptions: PublicLocationOption[];
}

export interface PublicBookingType {
    mailboxUid: string;
    slug: string;
    name: string;
    description?: string;
    hostDisplayName: string;
    meetingTypes: PublicMeetingType[];
    timezone: string;
    requiresApproval: boolean;
    minimumNoticeMinutes: number;
    bookingWindowDays: number;
    /** Set when the mailbox has an avatar; pass to `bookingProfileImageUrl()`. */
    avatarVersion?: string;
    /** Set when the mailbox has a banner; pass to `bookingProfileImageUrl()`. */
    bannerVersion?: string;
}

/** The path, below `/mail/bookings/types`, of one booking type's public endpoints. */
function publicTypePath(mailboxUid: string, slug: string): string {
    return `/mail/bookings/types/${encodeMailboxUid(mailboxUid)}/${encodeURIComponent(slug)}`;
}

export function getPublicBookingType(mailboxUid: string, slug: string): Promise<PublicBookingType> {
    return apiFetch(publicTypePath(mailboxUid, slug));
}

export interface BookingSlot {
    start: string;
    end: string;
}

export function getBookingSlots(mailboxUid: string, slug: string, meetingTypeUid: string, from?: string, to?: string): Promise<BookingSlot[]> {
    const params = new URLSearchParams();
    params.set("meetingTypeUid", meetingTypeUid);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return apiFetch(`${publicTypePath(mailboxUid, slug)}/slots?${params.toString()}`);
}

export enum BookingStatus {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    CANCELLED = "cancelled",
}

export interface PublicBooking {
    uid: string;
    mailboxUid: string;
    bookingTypeSlug: string;
    name: string;
    hostDisplayName: string;
    meetingTypeUid: string;
    meetingTypeName: string;
    locationType: BookingLocationType;
    locationLabel?: string;
    bookerPhone?: string;
    locationVideoUrl?: string;
    bookerLocationInstructions?: string;
    bookerName: string;
    bookerEmail: string;
    bookerNotes?: string;
    bookerTimezone?: string;
    startDate: string;
    endDate: string;
    status: BookingStatus;
    /** Only ever present on `bookSlot()`'s own response — the booker already has it by then, so no later
     * lookup (`getBookingByToken()` included) ever returns it again. */
    manageToken?: string;
    /** Set when the host's mailbox has an avatar; pass to `bookingProfileImageUrl()`. */
    avatarVersion?: string;
    /** Set when the host's mailbox has a banner. */
    bannerVersion?: string;
}

export interface BookSlotInput {
    start: string;
    meetingTypeUid: string;
    locationOptionUid: string;
    bookerName: string;
    bookerEmail: string;
    bookerNotes?: string;
    bookerTimezone?: string;
    /** Required when the chosen location option's type is `PHONE`. */
    bookerPhone?: string;
    /** Required when the chosen location option's type is `OTHER`. */
    bookerLocationInstructions?: string;
}

export function bookSlot(mailboxUid: string, slug: string, input: BookSlotInput): Promise<PublicBooking> {
    return apiFetch(publicTypePath(mailboxUid, slug), {
        method: "POST",
        body: JSON.stringify(input),
    });
}

export function getBookingByToken(token: string): Promise<PublicBooking> {
    return apiFetch(`/mail/bookings/manage/${encodeURIComponent(token)}`);
}

export function cancelBooking(token: string): Promise<PublicBooking> {
    return apiFetch(`/mail/bookings/manage/${encodeURIComponent(token)}/cancel`, { method: "POST" });
}

export function rescheduleBooking(token: string, start: string): Promise<PublicBooking> {
    return apiFetch(`/mail/bookings/manage/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ start }),
    });
}

/** The same-origin URL for a booking's manage page, shown on-screen right after a booking — the same
 * shape `BaseBookingRoute`'s email-embedded manage link resolves to as well
 * (`${mail:booking:public_url}/manage/:token`, see `apps/book/manage/[token].tsx`'s own doc comment). */
export function bookingManageUrl(manageToken: string): string {
    return `/book/manage/${encodeURIComponent(manageToken)}`;
}

// ---------------------------------------------------------------------------------------------------
// The booking page's avatar and banner — one pair per mailbox, shown on all of its booking pages.
// ---------------------------------------------------------------------------------------------------

export type BookingProfileImage = "avatar" | "banner";

/** What a mailbox has set for its booking pages. A version is present exactly when that image is. */
export interface BookingProfile {
    mailboxUid: string;
    avatarVersion?: string;
    bannerVersion?: string;
}

/** The URL of a mailbox's avatar or banner. `version` (from the profile or the public booking type) busts the cache
 * when the image is replaced, and lets the server cache it for good otherwise. */
export function bookingProfileImageUrl(mailboxUid: string, image: BookingProfileImage, version: string): string {
    return apiUrl(`/mail/booking-profiles/${encodeMailboxUid(mailboxUid)}/${image}?v=${encodeURIComponent(version)}`);
}

export function getBookingProfile(mailboxUid: string): Promise<BookingProfile> {
    return apiFetch(`/mail/booking-profiles/${encodeMailboxUid(mailboxUid)}`);
}

/**
 * Uploads `file` as the mailbox's avatar or banner. Bypasses `apiFetch` (which always forces `Content-Type:
 * application/json`) because `BaseBookingProfileRoute` reads the raw request body, like the branding uploads do.
 */
export async function uploadBookingProfileImage(mailboxUid: string, image: BookingProfileImage, file: Blob): Promise<BookingProfile> {
    const res = await fetch(apiUrl(`/mail/booking-profiles/${encodeMailboxUid(mailboxUid)}/${image}`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json") ? await res.json().catch(() => undefined) : undefined;
    if (!res.ok) {
        const message = (responseBody && (responseBody.message || responseBody.error)) || res.statusText || "Upload failed.";
        throw new ApiRequestError(message, res.status, responseBody?.code);
    }
    return responseBody as BookingProfile;
}

export function deleteBookingProfileImage(mailboxUid: string, image: BookingProfileImage): Promise<BookingProfile> {
    return apiFetch(`/mail/booking-profiles/${encodeMailboxUid(mailboxUid)}/${image}`, { method: "DELETE" });
}
