///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { isMailboxScopedData } from "@rapidmx/restapi";
import { BookingStatus } from "../../src/models/types.js";
import { BookingMongo } from "../../src/models/mongo/BookingMongo.js";
import { BookingTypeMongo } from "../../src/models/mongo/BookingTypeMongo.js";

describe("Mongo model default construction", () => {
    it("BookingTypeMongo falls back to class defaults when constructed with no data.", () => {
        const obj = new BookingTypeMongo();

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

    it("BookingTypeMongo applies provided overrides when constructed with data.", () => {
        const obj = new BookingTypeMongo({
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

    it("BookingMongo falls back to class defaults when constructed with no data.", () => {
        const obj = new BookingMongo();

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

    it("BookingMongo applies provided overrides when constructed with data.", () => {
        const startDate = new Date("2026-06-01T13:00:00Z");
        const endDate = new Date("2026-06-01T14:00:00Z");
        const cancelledAt = new Date("2026-05-30T09:00:00Z");
        const obj = new BookingMongo({
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

    it("BookingMongo keeps class defaults for fields omitted from a partial constructor call.", () => {
        // See BookingSQL's identical test in sql.test.ts for the full reasoning - a genuine partial
        // merge is never otherwise exercised by any real caller in this test suite.
        const obj = new BookingMongo({ bookingTypeUid: "bt-1", bookerEmail: "grace@example.com", status: BookingStatus.PENDING });

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

    it("BookingMongo keeps every class default when constructed with an empty partial object.", () => {
        // See BookingSQL's identical test in sql.test.ts for the full reasoning.
        const obj = new BookingMongo({});

        expect(obj.bookingTypeUid).toBe("");
        expect(obj.bookerEmail).toBe("");
        expect(obj.status).toBe(BookingStatus.CONFIRMED);
    });

    it("marks both models as mailbox-scoped data, so a mailbox's erasure removes them.", () => {
        expect(isMailboxScopedData(BookingTypeMongo)).toBe(true);
        expect(isMailboxScopedData(BookingMongo)).toBe(true);
    });
});
