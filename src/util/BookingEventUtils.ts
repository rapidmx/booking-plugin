///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { sanitizeEventDescriptionHtml } from "@rapidmx/restapi";
import { Booking, BookingLocationType } from "../models/types.js";

// Internal to the route: deliberately not exported from `index.ts` (which re-exports `BookingUtils`), so the package's public surface stays as it was.

/** The reminder every booking's calendar event carries, in minutes before it starts - the host's standard "get ready" notice. */
export const BOOKING_REMINDER_MINUTES = 15;

/** The longest `location` a booking's calendar event is given - a location is a single line, so a long set of instructions is cut. */
const MAX_EVENT_LOCATION_LENGTH = 200;

/** The parts of a booking its calendar event and its host notification describe. */
export type BookingEventDetails = Pick<
    Booking,
    "locationType" | "locationLabel" | "bookerName" | "bookerEmail" | "bookerPhone" | "locationVideoUrl" | "bookerLocationInstructions" | "bookerNotes"
>;

/** The name a location is shown under when the host didn't label it. */
function locationName(details: BookingEventDetails): string {
    return details.locationLabel ?? { phone: "Phone", video: "Video call", other: "Other" }[details.locationType];
}

/**
 * The `location` of a booking's calendar event: a video call's join URL, the number to call for a phone booking, or the
 * booker's instructions for any other location. `undefined` when there is nothing to show yet (a video call whose link the
 * host hasn't set), so the event has no location rather than a placeholder in the field calendar clients open as a link.
 */
export function bookingEventLocation(details: BookingEventDetails): string | undefined {
    switch (details.locationType) {
        case BookingLocationType.VIDEO:
            return details.locationVideoUrl || undefined;
        case BookingLocationType.PHONE:
            return details.bookerPhone ? `Phone: ${details.bookerPhone}` : undefined;
        case BookingLocationType.OTHER:
        default:
            return details.bookerLocationInstructions?.replace(/\s+/g, " ").trim().slice(0, MAX_EVENT_LOCATION_LENGTH) || undefined;
    }
}

/** The lines of a booking's event description, as `[text, link]` pairs - `link` is set when the text is a URL to show clickable. */
function bookingDescriptionLines(details: BookingEventDetails): { text: string; link?: string }[] {
    const label: string = locationName(details);
    // One line, whatever the booker typed: a name with line breaks must not be able to write lines of its own into the description.
    const name: string = details.bookerName.replace(/\s+/g, " ").trim();
    const lines: { text: string; link?: string }[] = [{ text: `Booked by ${name} <${details.bookerEmail}>` }];
    switch (details.locationType) {
        case BookingLocationType.VIDEO:
            lines.push(
                details.locationVideoUrl
                    ? { text: `${label}: ${details.locationVideoUrl}`, link: details.locationVideoUrl }
                    : { text: `${label}: the meeting link hasn't been set yet.` },
            );
            break;
        case BookingLocationType.PHONE:
            lines.push({ text: `${label}: call ${name} at ${details.bookerPhone}.` });
            break;
        case BookingLocationType.OTHER:
        default:
            lines.push({ text: `${label}: ${details.bookerLocationInstructions}` });
            break;
    }
    if (details.bookerNotes?.trim()) {
        lines.push({ text: `Notes: ${details.bookerNotes.trim()}` });
    }
    return lines;
}

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The description of a booking's calendar event - who booked, where or how the meeting happens (the video call's link,
 * the number to call, or the instructions) and the booker's notes - as plain text and as HTML (the same lines, with a video
 * link clickable). Everything in it is the booker's own input, so the HTML is built from escaped text and sanitized like any
 * event description. The booker's manage link is deliberately not in it: the event is visible to everyone the calendar is shared with.
 */
export function bookingEventDescription(details: BookingEventDetails): { description: string; descriptionHtml: string } {
    const lines = bookingDescriptionLines(details);
    const paragraphs: string[] = lines.map(({ text, link }) => {
        const escaped: string = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
        // A function, not a string, as the replacement: a `$` in the URL must not be read as a replacement pattern.
        return `<p>${link ? escaped.replace(escapeHtml(link), () => `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`) : escaped}</p>`;
    });
    return { description: lines.map((line) => line.text).join("\n"), descriptionHtml: sanitizeEventDescriptionHtml(paragraphs.join("")) };
}

/** `start` to `end` as a person reads it in `timezone` - "Friday, September 25, 2026, 12:30 PM - 1:00 PM (America/Chicago)". */
export function formatBookingWhen(start: Date, end: Date, timezone: string): string {
    const day: string = new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "full" }).format(start);
    const time = (date: Date): string => new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeStyle: "short" }).format(date);
    return `${day}, ${time(start)} - ${time(end)} (${timezone})`;
}

/**
 * `ics` with a display alarm `minutes` before the event starts, as an invitation carries the event's reminder to the guest it is
 * mailed to. Unchanged when there is no reminder (`undefined`, `null` or negative), or when it already has an alarm.
 */
export function withReminderAlarm(ics: string, minutes: number | null | undefined): string {
    if (minutes === undefined || minutes === null || minutes < 0 || ics.includes("BEGIN:VALARM")) {
        return ics;
    }
    const alarm: string = ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", `TRIGGER:-PT${Math.floor(minutes)}M`, "END:VALARM"].join("\r\n");
    // The alarm is a component of the event, so it goes just before the event ends.
    return ics.replace("\r\nEND:VEVENT", () => `\r\n${alarm}\r\nEND:VEVENT`);
}
