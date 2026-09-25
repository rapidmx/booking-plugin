///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import {
    BOOKING_REMINDER_MINUTES,
    bookingEventDescription,
    bookingEventLocation,
    formatBookingWhen,
    withReminderAlarm,
    type BookingEventDetails,
} from "../../src/util/BookingEventUtils.js";
import { BookingLocationType } from "../../src/models/types.js";

describe("booking event details", () => {
    const details = (data?: Partial<BookingEventDetails>): BookingEventDetails => ({
        locationType: BookingLocationType.VIDEO,
        bookerName: "Grace Hopper",
        bookerEmail: "grace@example.com",
        locationVideoUrl: "https://meet.example.com/ada",
        ...data,
    });

    it("bookingEventLocation() is a video call's URL, a phone booking's number, or a single line of other instructions.", () => {
        expect(bookingEventLocation(details())).toBe("https://meet.example.com/ada");
        expect(bookingEventLocation(details({ locationType: BookingLocationType.PHONE, bookerPhone: "1234567890" }))).toBe("Phone: 1234567890");
        expect(bookingEventLocation(details({ locationType: BookingLocationType.OTHER, bookerLocationInstructions: " Meet at\n  the corner. " }))).toBe("Meet at the corner.");
        expect(bookingEventLocation(details({ locationType: BookingLocationType.OTHER, bookerLocationInstructions: "x".repeat(500) }))).toHaveLength(200);
    });

    it("bookingEventLocation() is undefined when there is nothing to show yet.", () => {
        expect(bookingEventLocation(details({ locationVideoUrl: undefined }))).toBeUndefined();
        expect(bookingEventLocation(details({ locationType: BookingLocationType.PHONE }))).toBeUndefined();
        expect(bookingEventLocation(details({ locationType: BookingLocationType.OTHER }))).toBeUndefined();
        expect(bookingEventLocation(details({ locationType: BookingLocationType.OTHER, bookerLocationInstructions: "  " }))).toBeUndefined();
    });

    it("bookingEventDescription() names the booker, the location and the notes, in plain text and HTML.", () => {
        const described = bookingEventDescription(details({ locationLabel: "Zoom", bookerNotes: " Looking forward to it. " }));

        expect(described.description).toBe(
            "Booked by Grace Hopper <grace@example.com>\nZoom: https://meet.example.com/ada\nNotes: Looking forward to it.",
        );
        expect(described.descriptionHtml).toContain('<a href="https://meet.example.com/ada"');
        expect(described.descriptionHtml).toContain("Zoom: ");
        expect(described.descriptionHtml).toContain("Notes: Looking forward to it.");
        expect(described.descriptionHtml).toContain("Grace Hopper &lt;grace@example.com&gt;");
    });

    it("bookingEventDescription() says so when a video call has no link yet, and tells the host whom to call for a phone booking.", () => {
        expect(bookingEventDescription(details({ locationVideoUrl: undefined })).description).toBe(
            "Booked by Grace Hopper <grace@example.com>\nVideo call: the meeting link hasn't been set yet.",
        );
        expect(bookingEventDescription(details({ locationType: BookingLocationType.PHONE, bookerPhone: "1234567890" })).description).toBe(
            "Booked by Grace Hopper <grace@example.com>\nPhone: call Grace Hopper at 1234567890.",
        );
        expect(
            bookingEventDescription(details({ locationType: BookingLocationType.OTHER, bookerLocationInstructions: "Meet at the cafe." })).description,
        ).toBe("Booked by Grace Hopper <grace@example.com>\nOther: Meet at the cafe.");
    });

    it("bookingEventDescription() puts the booker's name on one line and escapes their text in the HTML.", () => {
        const described = bookingEventDescription(
            details({ bookerName: "Grace\r\n<b>Hopper</b>", bookerNotes: 'a <script>x</script> & "b"\nsecond line' }),
        );

        expect(described.description.split("\n")[0]).toBe("Booked by Grace <b>Hopper</b> <grace@example.com>");
        expect(described.descriptionHtml).not.toContain("<script");
        expect(described.descriptionHtml).not.toContain("<b>");
        expect(described.descriptionHtml).toContain("&lt;script&gt;");
        expect(described.descriptionHtml).toContain("<br>second line");
    });

    it("bookingEventDescription() reads a '$' in a video URL literally.", () => {
        const url = "https://meet.example.com/a$&b";

        expect(bookingEventDescription(details({ locationVideoUrl: url })).descriptionHtml).toContain('href="https://meet.example.com/a$&amp;b"');
    });

    it("formatBookingWhen() shows the day and times in the given time zone.", () => {
        expect(formatBookingWhen(new Date("2099-06-01T13:00:00.000Z"), new Date("2099-06-01T14:30:00.000Z"), "America/New_York")).toBe(
            "Monday, June 1, 2099, 9:00 AM - 10:30 AM (America/New_York)",
        );
    });

    it("BOOKING_REMINDER_MINUTES is 15.", () => {
        expect(BOOKING_REMINDER_MINUTES).toBe(15);
    });
});

describe("withReminderAlarm() Tests", () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

    it("adds a display alarm inside the event, the given minutes before it starts.", () => {
        expect(withReminderAlarm(ics, 15)).toBe(
            ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
        );
        expect(withReminderAlarm(ics, 0)).toContain("TRIGGER:-PT0M");
        expect(withReminderAlarm(ics, 7.9)).toContain("TRIGGER:-PT7M");
    });

    it("leaves the payload as it is when there is no reminder, or it already has an alarm.", () => {
        expect(withReminderAlarm(ics, undefined)).toBe(ics);
        expect(withReminderAlarm(ics, null)).toBe(ics);
        expect(withReminderAlarm(ics, -1)).toBe(ics);
        const alarmed = withReminderAlarm(ics, 15);
        expect(withReminderAlarm(alarmed, 30)).toBe(alarmed);
    });
});
