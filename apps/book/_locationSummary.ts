///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Shared between the booking page and the manage page - both show a booked appointment's location the same
 * way. Not a page: `_`-prefixed files in `apps/` aren't routed.
 */
import { BookingLocationType, PublicBooking } from "../shared/bookingApi.js";

export const LOCATION_TYPE_LABELS: Record<BookingLocationType, string> = {
    [BookingLocationType.PHONE]: "Phone",
    [BookingLocationType.VIDEO]: "Video call",
    [BookingLocationType.OTHER]: "Other",
};

/** A one-line summary of a booking's location, shown on the confirmation panel and the manage page. */
export function locationSummary(
    booking: Pick<PublicBooking, "locationType" | "locationLabel" | "bookerPhone" | "locationVideoUrl" | "bookerLocationInstructions">,
): string {
    const label = booking.locationLabel ?? LOCATION_TYPE_LABELS[booking.locationType];
    switch (booking.locationType) {
        case BookingLocationType.PHONE:
            return `${label}: we'll call you at ${booking.bookerPhone}.`;
        case BookingLocationType.VIDEO:
            return booking.locationVideoUrl
                ? `${label}: ${booking.locationVideoUrl}`
                : `${label}: the meeting link will be shared with you before the meeting.`;
        case BookingLocationType.OTHER:
        default:
            return `${label}: ${booking.bookerLocationInstructions}`;
    }
}
