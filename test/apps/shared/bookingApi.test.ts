// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyResponse, jsonResponse, mockFetch } from "../testUtils.js";
import {
    BookingStatus,
    BookingType,
    PublicBooking,
    PublicBookingType,
    bookSlot,
    bookingManageUrl,
    cancelBooking,
    createBookingType,
    deleteBookingType,
    getBookingByToken,
    getBookingSlots,
    getBookingType,
    getPublicBookingType,
    listBookingTypes,
    rescheduleBooking,
    updateBookingType,
} from "../../../apps/shared/bookingApi.js";

const bookingType: BookingType = {
    uid: "bt1",
    version: 0,
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    mailboxUid: "mb1",
    calendarFolderUid: "f-cal",
    slug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "Jane",
    durationMinutes: 30,
    timezone: "America/New_York",
    availability: [],
    dateOverrides: [],
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 60,
    bookingWindowDays: 30,
    requiresApproval: false,
    enabled: true,
};

const publicBookingType: PublicBookingType = {
    slug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "Jane",
    durationMinutes: 30,
    timezone: "America/New_York",
    requiresApproval: false,
    minimumNoticeMinutes: 60,
    bookingWindowDays: 30,
};

const publicBooking: PublicBooking = {
    uid: "b1",
    bookingTypeSlug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "Jane",
    bookerName: "Bob",
    bookerEmail: "bob@example.com",
    startDate: "2026-09-09T13:00:00.000Z",
    endDate: "2026-09-09T13:30:00.000Z",
    status: BookingStatus.CONFIRMED,
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("listBookingTypes", () => {
    it("fetches with the mailboxUid filter and default pagination", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, [bookingType]));
        const result = await listBookingTypes("mb1");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-types?limit=25&page=0&mailboxUid=mb1", expect.anything());
        expect(result).toEqual([bookingType]);
    });
});

describe("getBookingType", () => {
    it("fetches the encoded uid", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, bookingType));
        const result = await getBookingType("bt/1");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-types/bt%2F1", expect.anything());
        expect(result).toEqual(bookingType);
    });
});

describe("createBookingType", () => {
    it("posts the input with documented defaults applied", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, bookingType));
        await createBookingType({
            mailboxUid: "mb1",
            calendarFolderUid: "f-cal",
            slug: "intro-call",
            name: "Intro Call",
            hostDisplayName: "Jane",
            durationMinutes: 30,
            timezone: "America/New_York",
        });
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
        expect(body).toMatchObject({
            availability: [],
            dateOverrides: [],
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            minimumNoticeMinutes: 60,
            bookingWindowDays: 30,
            requiresApproval: false,
            enabled: true,
            slug: "intro-call",
        });
    });

    it("lets explicit input override the defaults", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, { ...bookingType, requiresApproval: true }));
        await createBookingType({
            mailboxUid: "mb1",
            calendarFolderUid: "f-cal",
            slug: "intro-call",
            name: "Intro Call",
            hostDisplayName: "Jane",
            durationMinutes: 30,
            timezone: "America/New_York",
            requiresApproval: true,
        });
        const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
        expect(body.requiresApproval).toBe(true);
    });
});

describe("updateBookingType", () => {
    it("PUTs the encoded uid with the input", async () => {
        const updated = { ...bookingType, name: "New Name" };
        const fetchMock = mockFetch(() => jsonResponse(200, updated));
        const result = await updateBookingType({ uid: "bt1", version: 0, name: "New Name" });
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/booking-types/bt1",
            expect.objectContaining({ method: "PUT", body: JSON.stringify({ uid: "bt1", version: 0, name: "New Name" }) }),
        );
        expect(result).toEqual(updated);
    });
});

describe("deleteBookingType", () => {
    it("DELETEs the encoded uid with the version query param", async () => {
        const fetchMock = mockFetch(() => emptyResponse(200));
        await deleteBookingType("bt1", 2);
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/booking-types/bt1?version=2",
            expect.objectContaining({ method: "DELETE" }),
        );
    });
});

describe("getPublicBookingType", () => {
    it("fetches the encoded slug with no auth-specific handling", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBookingType));
        const result = await getPublicBookingType("intro call");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/types/intro%20call", expect.anything());
        expect(result).toEqual(publicBookingType);
    });
});

describe("getBookingSlots", () => {
    it("fetches with no query params when from/to are omitted", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, []));
        await getBookingSlots("intro-call");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/types/intro-call/slots", expect.anything());
    });

    it("forwards from/to as query params when given", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, []));
        await getBookingSlots("intro-call", "2026-09-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z");
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/types/intro-call/slots?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z",
            expect.anything(),
        );
    });
});

describe("bookSlot", () => {
    it("posts the booking input to the encoded slug", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBooking));
        const result = await bookSlot("intro-call", { start: "2026-09-09T13:00:00.000Z", bookerName: "Bob", bookerEmail: "bob@example.com" });
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/types/intro-call",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ start: "2026-09-09T13:00:00.000Z", bookerName: "Bob", bookerEmail: "bob@example.com" }),
            }),
        );
        expect(result).toEqual(publicBooking);
    });
});

describe("getBookingByToken", () => {
    it("fetches the encoded token", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBooking));
        const result = await getBookingByToken("tok en");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/manage/tok%20en", expect.anything());
        expect(result).toEqual(publicBooking);
    });
});

describe("cancelBooking", () => {
    it("POSTs to the encoded token's cancel route", async () => {
        const cancelled = { ...publicBooking, status: BookingStatus.CANCELLED };
        const fetchMock = mockFetch(() => jsonResponse(200, cancelled));
        const result = await cancelBooking("tok1");
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/manage/tok1/cancel",
            expect.objectContaining({ method: "POST" }),
        );
        expect(result).toEqual(cancelled);
    });
});

describe("rescheduleBooking", () => {
    it("POSTs the new start to the encoded token's reschedule route", async () => {
        const moved = { ...publicBooking, startDate: "2026-09-10T13:00:00.000Z" };
        const fetchMock = mockFetch(() => jsonResponse(200, moved));
        const result = await rescheduleBooking("tok1", "2026-09-10T13:00:00.000Z");
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/manage/tok1/reschedule",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ start: "2026-09-10T13:00:00.000Z" }) }),
        );
        expect(result).toEqual(moved);
    });
});

describe("bookingManageUrl", () => {
    it("builds a same-origin manage URL from the token", () => {
        expect(bookingManageUrl("abc def")).toBe("/book/manage/abc%20def");
    });
});
