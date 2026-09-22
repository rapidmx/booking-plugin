// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyResponse, jsonResponse, mockFetch } from "../testUtils.js";
import { ApiRequestError } from "@rapidmx/react-shared/util/api.js";
import {
    BookingLocationType,
    BookingStatus,
    BookingType,
    PublicBooking,
    PublicBookingType,
    bookSlot,
    bookingManageUrl,
    bookingProfileImageUrl,
    bookingPublicPath,
    bookingPublicUrl,
    cancelBooking,
    createBookingType,
    deleteBookingProfileImage,
    deleteBookingType,
    getBookingByToken,
    getBookingProfile,
    getBookingSlots,
    getBookingType,
    getPublicBookingType,
    listBookingTypes,
    listHostBookings,
    rescheduleBooking,
    setBookingLocationVideoUrl,
    updateBookingType,
    uploadBookingProfileImage,
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
    meetingTypes: [{ uid: "mt1", name: "Intro Call", durationMinutes: 30, locationOptions: [{ uid: "lo1", type: BookingLocationType.VIDEO }] }],
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
    mailboxUid: "jane@example.com",
    slug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "Jane",
    meetingTypes: [{ uid: "mt1", name: "Intro Call", durationMinutes: 30, locationOptions: [{ uid: "lo1", type: BookingLocationType.VIDEO }] }],
    timezone: "America/New_York",
    requiresApproval: false,
    minimumNoticeMinutes: 60,
    bookingWindowDays: 30,
};

const publicBooking: PublicBooking = {
    uid: "b1",
    mailboxUid: "jane@example.com",
    bookingTypeSlug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "Jane",
    meetingTypeUid: "mt1",
    meetingTypeName: "Intro Call",
    locationType: BookingLocationType.VIDEO,
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
            meetingTypes: [{ name: "Intro Call", durationMinutes: 30, locationOptions: [{ type: BookingLocationType.VIDEO }] }],
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
            meetingTypes: [{ name: "Intro Call", durationMinutes: 30, locationOptions: [{ type: BookingLocationType.VIDEO }] }],
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

describe("updateBookingType moving to another mailbox", () => {
    it("sends the new mailbox and its calendar folder along with the update", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, { ...bookingType, mailboxUid: "mb2", calendarFolderUid: "f-cal2" }));
        await updateBookingType({ uid: "bt1", version: 3, mailboxUid: "mb2", calendarFolderUid: "f-cal2" });
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.method).toBe("PUT");
        expect(JSON.parse(init.body as string)).toEqual({ uid: "bt1", version: 3, mailboxUid: "mb2", calendarFolderUid: "f-cal2" });
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

describe("bookingPublicPath", () => {
    it("builds /book/<mailbox>/<slug>", () => {
        expect(bookingPublicPath("mb1", "intro-call")).toBe("/book/mb1/intro-call");
    });

    it("keeps @ literal in the mailbox but encodes every other reserved character", () => {
        expect(bookingPublicPath("jane@example.com", "intro-call")).toBe("/book/jane@example.com/intro-call");
        expect(bookingPublicPath("a+b c/d?e#f%g@x.io", "slug")).toBe("/book/a%2Bb%20c%2Fd%3Fe%23f%25g@x.io/slug");
    });

    it("encodes the slug completely, including any @", () => {
        expect(bookingPublicPath("mb1", "intro call/1@2")).toBe("/book/mb1/intro%20call%2F1%402");
    });
});

describe("bookingPublicUrl", () => {
    it("prefixes the public path with this page's origin", () => {
        expect(bookingPublicUrl("jane@example.com", "intro-call")).toBe(`${window.location.origin}/book/jane@example.com/intro-call`);
    });
});

describe("getPublicBookingType", () => {
    it("fetches the mailbox-scoped, encoded path with no auth-specific handling", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBookingType));
        const result = await getPublicBookingType("jane@example.com", "intro call");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/types/jane@example.com/intro%20call", expect.anything());
        expect(result).toEqual(publicBookingType);
    });

    it("encodes the mailbox uid except for its @", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBookingType));
        await getPublicBookingType("a+b/c@example.com", "intro-call");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/types/a%2Bb%2Fc@example.com/intro-call", expect.anything());
    });
});

describe("getBookingSlots", () => {
    it("fetches with only the meetingTypeUid query param when from/to are omitted", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, []));
        await getBookingSlots("jane@example.com", "intro-call", "mt1");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?meetingTypeUid=mt1", expect.anything());
    });

    it("forwards from/to as query params when given", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, []));
        await getBookingSlots("jane@example.com", "intro-call", "mt1", "2026-09-01T00:00:00.000Z", "2026-09-08T00:00:00.000Z");
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/types/jane@example.com/intro-call/slots?meetingTypeUid=mt1&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z",
            expect.anything(),
        );
    });

    it("forwards only the one of from/to that is given", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, []));
        await getBookingSlots("mb1", "intro-call", "mt1", undefined, "2026-09-08T00:00:00.000Z");
        expect(fetchMock).toHaveBeenLastCalledWith(
            "/api/mail/bookings/types/mb1/intro-call/slots?meetingTypeUid=mt1&to=2026-09-08T00%3A00%3A00.000Z",
            expect.anything(),
        );
    });
});

describe("bookSlot", () => {
    it("posts the booking input to the mailbox-scoped, encoded path", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBooking));
        const result = await bookSlot("jane@example.com", "intro-call", {
            start: "2026-09-09T13:00:00.000Z",
            meetingTypeUid: "mt1",
            locationOptionUid: "lo1",
            bookerName: "Bob",
            bookerEmail: "bob@example.com",
        });
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/types/jane@example.com/intro-call",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    start: "2026-09-09T13:00:00.000Z",
                    meetingTypeUid: "mt1",
                    locationOptionUid: "lo1",
                    bookerName: "Bob",
                    bookerEmail: "bob@example.com",
                }),
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

describe("listHostBookings", () => {
    it("fetches the booking type's bookings, host-authenticated", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, [publicBooking]));
        const result = await listHostBookings("bt1");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/host?bookingTypeUid=bt1", expect.anything());
        expect(result).toEqual([publicBooking]);
    });
});

describe("setBookingLocationVideoUrl", () => {
    it("POSTs the new URL to the booking's location route", async () => {
        const updated = { ...publicBooking, locationVideoUrl: "https://example.com/room" };
        const fetchMock = mockFetch(() => jsonResponse(200, updated));
        const result = await setBookingLocationVideoUrl("b1", "https://example.com/room");
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/mail/bookings/host/b1/location",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ locationVideoUrl: "https://example.com/room" }) }),
        );
        expect(result).toEqual(updated);
    });

    it("sends an empty body to clear a previously-set URL - JSON.stringify() drops an undefined property", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, publicBooking));
        await setBookingLocationVideoUrl("b1", undefined);
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/bookings/host/b1/location", expect.objectContaining({ body: "{}" }));
    });
});

describe("bookingManageUrl", () => {
    it("builds a same-origin manage URL from the token", () => {
        expect(bookingManageUrl("abc def")).toBe("/book/manage/abc%20def");
    });
});


describe("bookingProfileImageUrl", () => {
    it("points at the mailbox's image, with @ kept literal and the version as the cache-buster", () => {
        expect(bookingProfileImageUrl("jane@example.com", "avatar", "v1")).toBe("/api/mail/booking-profiles/jane@example.com/avatar?v=v1");
        expect(bookingProfileImageUrl("jane@example.com", "banner", "v1")).toBe("/api/mail/booking-profiles/jane@example.com/banner?v=v1");
    });

    it("encodes the rest of the mailbox uid and the whole version", () => {
        expect(bookingProfileImageUrl("a+b@x.io", "avatar", "2026 09/10")).toBe("/api/mail/booking-profiles/a%2Bb@x.io/avatar?v=2026%2009%2F10");
    });
});

describe("getBookingProfile", () => {
    it("fetches the mailbox's profile", async () => {
        const profile = { mailboxUid: "jane@example.com", avatarVersion: "a1" };
        const fetchMock = mockFetch(() => jsonResponse(200, profile));
        const result = await getBookingProfile("jane@example.com");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-profiles/jane@example.com", expect.anything());
        expect(result).toEqual(profile);
    });
});

describe("uploadBookingProfileImage", () => {
    const profile = { mailboxUid: "jane@example.com", bannerVersion: "b1" };
    const png = () => new Blob(["x"], { type: "image/png" });

    it("POSTs the blob as the raw body, with its own type, and the session cookie", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, profile));
        const blob = new Blob(["xyz"], { type: "image/jpeg" });
        const result = await uploadBookingProfileImage("jane@example.com", "banner", blob);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/mail/booking-profiles/jane@example.com/banner");
        expect(init.method).toBe("POST");
        expect(init.credentials).toBe("include");
        expect(init.headers).toEqual({ "Content-Type": "image/jpeg" });
        expect(init.body).toBe(blob);
        expect(result).toEqual(profile);
    });

    it("falls back to a binary content type for a blob without one", async () => {
        const fetchMock = mockFetch(() => jsonResponse(200, profile));
        await uploadBookingProfileImage("mb1", "avatar", new Blob(["xyz"]));
        expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ "Content-Type": "application/octet-stream" });
    });

    it("throws an ApiRequestError with the server's message, status and code", async () => {
        mockFetch(() => jsonResponse(413, { message: "Too large", code: "TOO_LARGE" }, { statusText: "Payload Too Large" }));
        const error = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error.message).toBe("Too large");
        expect(error.status).toBe(413);
        expect(error.code).toBe("TOO_LARGE");
    });

    it("uses the error field when the body has no message", async () => {
        mockFetch(() => jsonResponse(400, { error: "Bad image" }));
        const error = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error.message).toBe("Bad image");
        expect(error.status).toBe(400);
    });

    it("falls back to the status text when the error body is not JSON", async () => {
        mockFetch(() => new Response("<html>gateway</html>", { status: 502, statusText: "Bad Gateway", headers: { "content-type": "text/html" } }));
        const error = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error.message).toBe("Bad Gateway");
        expect(error.status).toBe(502);
        expect(error.code).toBeUndefined();
    });

    it("falls back to a generic message when there is no body and no status text", async () => {
        mockFetch(() => emptyResponse(500));
        const error = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(error).toBeInstanceOf(ApiRequestError);
        expect(error.message).toBe("Upload failed.");
        expect(error.status).toBe(500);
    });

    it("falls back to the status text when a JSON error body can't be parsed or has no message", async () => {
        mockFetch(() => new Response("not json", { status: 500, statusText: "Server Error", headers: { "content-type": "application/json" } }));
        const first = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(first.message).toBe("Server Error");

        mockFetch(() => jsonResponse(500, {}, { statusText: "Server Error" }));
        const second = await uploadBookingProfileImage("mb1", "avatar", png()).catch((e) => e);
        expect(second.message).toBe("Server Error");
    });

    it("propagates a network failure", async () => {
        mockFetch(() => {
            throw new TypeError("network down");
        });
        await expect(uploadBookingProfileImage("mb1", "avatar", png())).rejects.toThrow("network down");
    });
});

describe("deleteBookingProfileImage", () => {
    it("DELETEs the mailbox's image and returns the updated profile", async () => {
        const profile = { mailboxUid: "jane@example.com" };
        const fetchMock = mockFetch(() => jsonResponse(200, profile));
        const result = await deleteBookingProfileImage("jane@example.com", "avatar");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-profiles/jane@example.com/avatar", expect.objectContaining({ method: "DELETE" }));
        expect(result).toEqual(profile);
    });
});
