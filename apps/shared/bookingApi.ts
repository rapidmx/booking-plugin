///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Typed wrappers over this plugin's booking API. Two distinct halves, both
 * mounted at `/mail/booking-types`/`/mail/bookings` (see `BaseBookingTypeRoute`/`BaseBookingRoute`), sharing this
 * file only because they're two views of the same feature — never used together in one request.
 *
 * Host-side (`listBookingTypes`/`createBookingType`/etc.) is an ordinary mailbox-scoped
 * `BaseScopedChildRoute` CRUD surface, authenticated like every other mail API call, used by
 * `apps/settings-booking-types/**`. Public (`getPublicBookingType`/`getBookingSlots`/`bookSlot`/
 * `getBookingByToken`/`cancelBooking`/`rescheduleBooking`) is `BaseBookingRoute`'s entirely unauthenticated
 * half — no `jwt` cookie is ever sent or expected — used by `apps/book/**`, the plugin's public
 * (non-`AppShell`) pages.
 */

import { apiFetch } from "@rapidmx/react-shared/util/api.js";
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
    durationMinutes: number;
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
    durationMinutes: number;
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
    slug?: string;
    name?: string;
    description?: string;
    hostDisplayName?: string;
    durationMinutes?: number;
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

// ---------------------------------------------------------------------------------------------------
// Public, unauthenticated half — `apps/book/**` only. Every function below hits `/mail/bookings/...`.
// ---------------------------------------------------------------------------------------------------

export interface PublicBookingType {
    slug: string;
    name: string;
    description?: string;
    hostDisplayName: string;
    durationMinutes: number;
    timezone: string;
    requiresApproval: boolean;
    minimumNoticeMinutes: number;
    bookingWindowDays: number;
}

export function getPublicBookingType(slug: string): Promise<PublicBookingType> {
    return apiFetch(`/mail/bookings/types/${encodeURIComponent(slug)}`);
}

export interface BookingSlot {
    start: string;
    end: string;
}

export function getBookingSlots(slug: string, from?: string, to?: string): Promise<BookingSlot[]> {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    return apiFetch(`/mail/bookings/types/${encodeURIComponent(slug)}/slots${query ? `?${query}` : ""}`);
}

export enum BookingStatus {
    PENDING = "pending",
    CONFIRMED = "confirmed",
    CANCELLED = "cancelled",
}

export interface PublicBooking {
    uid: string;
    bookingTypeSlug: string;
    name: string;
    hostDisplayName: string;
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
}

export interface BookSlotInput {
    start: string;
    bookerName: string;
    bookerEmail: string;
    bookerNotes?: string;
    bookerTimezone?: string;
}

export function bookSlot(slug: string, input: BookSlotInput): Promise<PublicBooking> {
    return apiFetch(`/mail/bookings/types/${encodeURIComponent(slug)}`, {
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
