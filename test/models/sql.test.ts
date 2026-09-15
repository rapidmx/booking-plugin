///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { isMailboxScopedData } from "@rapidmx/restapi";
import { BookingStatus } from "../../src/models/types.js";
import { BookingSQL } from "../../src/models/sql/BookingSQL.js";
import { BookingTypeSQL } from "../../src/models/sql/BookingTypeSQL.js";

describe("SQL model default construction", () => {
    it("BookingTypeSQL falls back to class defaults when constructed with no data.", () => {
        const obj = new BookingTypeSQL();

        expect(obj.mailboxUid).toBe("");
        expect(obj.calendarFolderUid).toBe("");
        expect(obj.slug).toBe("");
        expect(obj.name).toBe("");
        expect(obj.description).toBeUndefined();
        expect(obj.hostDisplayName).toBe("");
        expect(obj.durationMinutes).toBe(30);
        expect(obj.timezone).toBe("UTC");
        expect(obj.availability).toEqual([]);
        expect(obj.dateOverrides).toEqual([]);
        expect(obj.slotIntervalMinutes).toBeUndefined();
        expect(obj.bufferBeforeMinutes).toBe(0);
        expect(obj.bufferAfterMinutes).toBe(0);
        expect(obj.minimumNoticeMinutes).toBe(0);
        expect(obj.bookingWindowDays).toBe(60);
        expect(obj.maxPerDay).toBeUndefined();
        expect(obj.requiresApproval).toBe(false);
        expect(obj.enabled).toBe(true);
    });

    it("BookingTypeSQL applies provided overrides when constructed with data.", () => {
        const obj = new BookingTypeSQL({
            mailboxUid: "mailbox-1",
            calendarFolderUid: "folder-1",
            slug: "intro-call",
            name: "Intro Call",
            description: "A quick chat.",
            hostDisplayName: "Ada Lovelace",
            durationMinutes: 45,
            timezone: "America/New_York",
            availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }],
            dateOverrides: [{ date: "2026-07-04", windows: [] }],
            slotIntervalMinutes: 15,
            bufferBeforeMinutes: 5,
            bufferAfterMinutes: 10,
            minimumNoticeMinutes: 120,
            bookingWindowDays: 14,
            maxPerDay: 3,
            requiresApproval: true,
            enabled: false,
        });

        expect(obj.mailboxUid).toBe("mailbox-1");
        expect(obj.calendarFolderUid).toBe("folder-1");
        expect(obj.slug).toBe("intro-call");
        expect(obj.name).toBe("Intro Call");
        expect(obj.description).toBe("A quick chat.");
        expect(obj.hostDisplayName).toBe("Ada Lovelace");
        expect(obj.durationMinutes).toBe(45);
        expect(obj.timezone).toBe("America/New_York");
        expect(obj.availability).toEqual([{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }]);
        expect(obj.dateOverrides).toEqual([{ date: "2026-07-04", windows: [] }]);
        expect(obj.slotIntervalMinutes).toBe(15);
        expect(obj.bufferBeforeMinutes).toBe(5);
        expect(obj.bufferAfterMinutes).toBe(10);
        expect(obj.minimumNoticeMinutes).toBe(120);
        expect(obj.bookingWindowDays).toBe(14);
        expect(obj.maxPerDay).toBe(3);
        expect(obj.requiresApproval).toBe(true);
        expect(obj.enabled).toBe(false);
    });

    it("BookingSQL falls back to class defaults when constructed with no data.", () => {
        const obj = new BookingSQL();

        expect(obj.bookingTypeUid).toBe("");
        expect(obj.mailboxUid).toBe("");
        expect(obj.folderUid).toBe("");
        expect(obj.calendarEventUid).toBe("");
        expect(obj.bookerName).toBe("");
        expect(obj.bookerEmail).toBe("");
        expect(obj.bookerNotes).toBeUndefined();
        expect(obj.bookerTimezone).toBeUndefined();
        expect(obj.status).toBe(BookingStatus.CONFIRMED);
        expect(obj.manageToken).toBe("");
        expect(obj.cancelledAt).toBeUndefined();
    });

    it("BookingSQL applies provided overrides when constructed with data.", () => {
        const startDate = new Date("2026-06-01T13:00:00Z");
        const endDate = new Date("2026-06-01T14:00:00Z");
        const cancelledAt = new Date("2026-05-30T09:00:00Z");
        const obj = new BookingSQL({
            bookingTypeUid: "bt-1",
            mailboxUid: "mailbox-1",
            folderUid: "folder-1",
            calendarEventUid: "event-1",
            bookerName: "Grace Hopper",
            bookerEmail: "grace@example.com",
            bookerNotes: "Looking forward to it.",
            bookerTimezone: "America/Chicago",
            startDate,
            endDate,
            status: BookingStatus.CANCELLED,
            manageToken: "token-1",
            cancelledAt,
        });

        expect(obj.bookingTypeUid).toBe("bt-1");
        expect(obj.mailboxUid).toBe("mailbox-1");
        expect(obj.folderUid).toBe("folder-1");
        expect(obj.calendarEventUid).toBe("event-1");
        expect(obj.bookerName).toBe("Grace Hopper");
        expect(obj.bookerEmail).toBe("grace@example.com");
        expect(obj.bookerNotes).toBe("Looking forward to it.");
        expect(obj.bookerTimezone).toBe("America/Chicago");
        expect(obj.startDate).toBe(startDate);
        expect(obj.endDate).toBe(endDate);
        expect(obj.status).toBe(BookingStatus.CANCELLED);
        expect(obj.manageToken).toBe("token-1");
        expect(obj.cancelledAt).toBe(cancelledAt);
    });

    it("BookingSQL keeps class defaults for fields omitted from a partial constructor call.", () => {
        // Every other test either passes no data at all (skips the whole `if (other)` block) or every
        // field (always takes each ternary's true branch) - a genuine partial merge, the shape
        // `RepoUtils.instantiateObject()` and every real "supply only what changed" caller actually use,
        // is never otherwise exercised, leaving each `!== undefined` ternary's false/default branch
        // uncovered.
        const obj = new BookingSQL({ bookingTypeUid: "bt-1", bookerEmail: "grace@example.com", status: BookingStatus.PENDING });

        expect(obj.bookingTypeUid).toBe("bt-1");
        expect(obj.bookerEmail).toBe("grace@example.com");
        expect(obj.status).toBe(BookingStatus.PENDING);
        expect(obj.mailboxUid).toBe("");
        expect(obj.folderUid).toBe("");
        expect(obj.calendarEventUid).toBe("");
        expect(obj.bookerName).toBe("");
        expect(obj.manageToken).toBe("");
        expect(obj.startDate).toBeInstanceOf(Date);
        expect(obj.endDate).toBeInstanceOf(Date);
    });

    it("BookingSQL keeps every class default when constructed with an empty partial object.", () => {
        // An empty object still takes the `if (other)` branch (unlike passing no argument at all), so
        // every `!== undefined` ternary's false branch needs its own exercise here - the mixed test
        // above only omits the fields it doesn't itself provide.
        const obj = new BookingSQL({});

        expect(obj.bookingTypeUid).toBe("");
        expect(obj.bookerEmail).toBe("");
        expect(obj.status).toBe(BookingStatus.CONFIRMED);
    });

    it("marks both models as mailbox-scoped data, so a mailbox's erasure removes them.", () => {
        expect(isMailboxScopedData(BookingTypeSQL)).toBe(true);
        expect(isMailboxScopedData(BookingSQL)).toBe(true);
    });
});
