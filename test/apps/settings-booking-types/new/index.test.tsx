// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, mockLocation, restoreLocation } from "../../testUtils.js";
import NewBookingTypePage from "../../../../apps/settings-booking-types/new/index.js";

const mailbox = {
    uid: "mb1",
    version: 0,
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    ownerUserUid: "u1",
    primarySmtpAddress: "u1@example.com",
    aliasAddresses: [],
    displayName: "My Mail",
    timezone: "America/New_York",
    quotaBytes: 1_000_000_000,
    usedBytes: 0,
};
const calendarFolder = {
    uid: "f-cal",
    version: 0,
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    mailboxUid: "mb1",
    name: "Calendar",
    type: "calendar" as const,
    unreadCount: 0,
    totalCount: 0,
};
const inboxFolder = { ...calendarFolder, uid: "f-inbox", name: "Inbox", type: "inbox" as const };

const created = {
    uid: "bt1",
    version: 0,
    dateCreated: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    mailboxUid: "mb1",
    calendarFolderUid: "f-cal",
    slug: "intro-call",
    name: "Intro Call",
    hostDisplayName: "My Mail",
    meetingTypes: [{ uid: "mt1", name: "30 Minute Meeting", durationMinutes: 30, locationOptions: [{ uid: "lo1", type: "video" }] }],
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

function mockShell(extra?: (url: string, init?: RequestInit) => Response | undefined) {
    return mockFetch((url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (url.startsWith("/api/mail/mailboxes/auto-provision")) return jsonResponse(404, { message: "not enabled" });
        if (url.startsWith("/api/mail/mailboxes")) return jsonResponse(200, [mailbox]);
        if (url.startsWith("/api/mail/folders")) return jsonResponse(200, [inboxFolder, calendarFolder]);
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
}

beforeEach(() => {
    window.history.pushState(null, "", "/settings/booking-types/new?mailboxUid=mb1");
});

afterEach(() => {
    restoreLocation();
    vi.unstubAllGlobals();
    window.history.pushState(null, "", "/");
});

describe("NewBookingTypePage", () => {
    it("prefills host name and timezone from the mailbox", async () => {
        mockShell();
        render(<NewBookingTypePage userUid="u1" />);

        expect(await screen.findByLabelText("Host name shown to visitors")).toHaveValue("My Mail");
        expect(screen.getByLabelText("Timezone")).toHaveValue("America/New_York");
    });

    it("shows an error when the calendar folder can't be resolved", async () => {
        mockShell((url) => (url.startsWith("/api/mail/folders") ? jsonResponse(200, [inboxFolder]) : undefined));
        render(<NewBookingTypePage userUid="u1" />);
        expect(await screen.findByText("This mailbox has no Calendar folder yet.")).toBeInTheDocument();
    });

    it("shows an error when loading folders fails with an API error", async () => {
        mockShell((url) => (url.startsWith("/api/mail/folders") ? jsonResponse(500, { message: "folders boom" }) : undefined));
        render(<NewBookingTypePage userUid="u1" />);
        expect(await screen.findByText("folders boom")).toBeInTheDocument();
    });

    it("shows a generic error when loading folders fails with a non-API error", async () => {
        mockShell((url) => {
            if (url.startsWith("/api/mail/folders")) throw new TypeError("network down");
            return undefined;
        });
        render(<NewBookingTypePage userUid="u1" />);
        expect(await screen.findByText("Could not load this mailbox's folders.")).toBeInTheDocument();
    });

    it("requires slug, name, and host name before submitting", async () => {
        mockShell();
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.clear(screen.getByLabelText("Host name shown to visitors"));
        await user.click(screen.getByRole("button", { name: "Create" }));

        expect(await screen.findByText("Slug, name, and host name are all required.")).toBeInTheDocument();
    });

    it("creates the booking type and navigates to its detail page", async () => {
        const location = mockLocation();
        const fetchMock = mockShell((url, init) =>
            url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(200, created) : undefined,
        );
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Create" }));

        await vi.waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-types", expect.objectContaining({ method: "POST" })),
        );
        const body = JSON.parse((fetchMock.mock.calls.find(([u]) => u === "/api/mail/booking-types")![1] as RequestInit).body as string);
        expect(body.calendarFolderUid).toBe("f-cal");
        expect(body.meetingTypes).toEqual([{ name: "30 Minute Meeting", durationMinutes: 30, locationOptions: [{ type: "video" }] }]);
        await vi.waitFor(() => expect(location.href).toBe("/settings/booking-types/bt1?mailboxUid=mb1"));
    });

    it("shows an error message when creation fails", async () => {
        mockShell((url, init) =>
            url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(400, { message: "slug taken" }) : undefined,
        );
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Create" }));

        expect(await screen.findByText("slug taken")).toBeInTheDocument();
    });

    it("shows a generic error message when creation fails with a non-API error", async () => {
        mockShell((url, init) => {
            if (url === "/api/mail/booking-types" && init?.method === "POST") throw new TypeError("network down");
            return undefined;
        });
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Create" }));

        expect(await screen.findByText("Could not create this booking link.")).toBeInTheDocument();
    });

    it("adds an availability window and includes it in the created payload", async () => {
        const fetchMock = mockShell((url, init) =>
            url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(200, created) : undefined,
        );
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Add window" }));
        await user.click(screen.getByRole("button", { name: "Create" }));

        await vi.waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-types", expect.objectContaining({ method: "POST" })),
        );
        const body = JSON.parse((fetchMock.mock.calls.find(([u]) => u === "/api/mail/booking-types")![1] as RequestInit).body as string);
        expect(body.availability).toHaveLength(1);
    });

    it("toggles the requires-approval checkbox and updates duration/notice/window fields", async () => {
        mockShell();
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.click(screen.getByLabelText("Require my approval before confirming a booking"));
        expect(screen.getByLabelText("Require my approval before confirming a booking")).toBeChecked();

        const duration = screen.getByLabelText("Duration (minutes)");
        await user.clear(duration);
        await user.type(duration, "45");
        expect(duration).toHaveValue(45);

        const notice = screen.getByLabelText("Minimum notice (minutes)");
        await user.clear(notice);
        await user.type(notice, "120");
        expect(notice).toHaveValue(120);

        const windowDays = screen.getByLabelText("Booking window (days ahead)");
        await user.clear(windowDays);
        await user.type(windowDays, "14");
        expect(windowDays).toHaveValue(14);

        await user.type(screen.getByLabelText("Description (optional)"), "Let's chat");
        expect(screen.getByLabelText("Description (optional)")).toHaveValue("Let's chat");

        await user.clear(screen.getByLabelText("Timezone"));
        await user.type(screen.getByLabelText("Timezone"), "UTC");
        expect(screen.getByLabelText("Timezone")).toHaveValue("UTC");
    });

    it("blocks submission with its own message when the calendar folder is still missing at submit time", async () => {
        mockShell((url) => (url.startsWith("/api/mail/folders") ? jsonResponse(200, [inboxFolder]) : undefined));
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByText("This mailbox has no Calendar folder yet.");

        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Create" }));

        expect(await screen.findAllByText("This mailbox has no Calendar folder yet.")).toHaveLength(2);
    });
});

describe("NewBookingTypePage mailbox", () => {
    const mailbox2 = { ...mailbox, uid: "mb2", displayName: "Support Desk", timezone: "Europe/London", primarySmtpAddress: "support@example.com" };
    const calendarFolder2 = { ...calendarFolder, uid: "f-cal2", mailboxUid: "mb2" };
    const inboxFolder2 = { ...inboxFolder, uid: "f-inbox2", mailboxUid: "mb2" };
    const mailboxField = () => screen.getByLabelText("Mailbox", { selector: "#mailboxUid" });
    const hostName = () => screen.getByLabelText("Host name shown to visitors");
    const timezone = () => screen.getByLabelText("Timezone");

    /** Two mailboxes in the shell; `folders` answers each mailbox's folder listing (by default, an inbox and a calendar). */
    function mockTwoMailboxes(
        folders: (mailboxUid: string) => Response | Promise<Response> = (uid) =>
            jsonResponse(200, uid === "mb2" ? [inboxFolder2, calendarFolder2] : [inboxFolder, calendarFolder]),
        extra?: (url: string, init?: RequestInit) => Response | undefined,
    ) {
        return mockFetch((url, init) => {
            const custom = extra?.(url, init);
            if (custom) return custom;
            if (url.startsWith("/api/mail/mailboxes/auto-provision")) return jsonResponse(404, { message: "not enabled" });
            if (url.startsWith("/api/mail/mailboxes")) return jsonResponse(200, [mailbox, mailbox2]);
            if (url.startsWith("/api/mail/folders")) return folders(new URL(url, "http://localhost").searchParams.get("mailboxUid")!);
            throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
        });
    }

    const foldersRequested = (fetchMock: ReturnType<typeof mockFetch>) =>
        fetchMock.mock.calls
            .filter(([url]) => String(url).startsWith("/api/mail/folders"))
            .map(([url]) => new URL(String(url), "http://localhost").searchParams.get("mailboxUid"));

    const postedBody = (fetchMock: ReturnType<typeof mockFetch>) => {
        const post = fetchMock.mock.calls.find(([url, init]) => url === "/api/mail/booking-types" && (init as RequestInit)?.method === "POST");
        return post ? JSON.parse((post[1] as RequestInit).body as string) : undefined;
    };

    async function fillAndCreate(user: ReturnType<typeof userEvent.setup>) {
        await user.type(screen.getByLabelText("Name"), "Intro Call");
        await user.type(screen.getByLabelText("Slug (used in the public link)"), "intro-call");
        await user.click(screen.getByRole("button", { name: "Create" }));
    }

    it("offers the shell's mailboxes, starting at the one Settings is showing", async () => {
        mockTwoMailboxes();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        expect(mailboxField()).toHaveValue("mb1");
        expect(Array.from(mailboxField().options).map((option) => option.textContent)).toEqual(["My Mail (mb1)", "Support Desk (mb2)"]);
    });

    it("starts at the mailbox named in the address, prefilling its name and timezone", async () => {
        window.history.pushState(null, "", "/settings/booking-types/new?mailboxUid=mb2");
        const fetchMock = mockTwoMailboxes();
        render(<NewBookingTypePage userUid="u1" />);

        await screen.findByLabelText("Host name shown to visitors");
        expect(mailboxField()).toHaveValue("mb2");
        expect(hostName()).toHaveValue("Support Desk");
        expect(timezone()).toHaveValue("Europe/London");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb2"]));
        await act(async () => undefined);
    });

    it("looks up the calendar of the mailbox that is chosen, and creates the link there", async () => {
        const fetchMock = mockTwoMailboxes(undefined, (url, init) =>
            url === "/api/mail/booking-types" && init?.method === "POST"
                ? jsonResponse(200, { ...created, mailboxUid: "mb2", calendarFolderUid: "f-cal2" })
                : undefined,
        );
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1"]));
        const location = mockLocation();

        await user.selectOptions(mailboxField(), "mb2");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1", "mb2"]));
        await fillAndCreate(user);

        await vi.waitFor(() => expect(location.href).toBe("/settings/booking-types/bt1?mailboxUid=mb2"));
        expect(postedBody(fetchMock)).toMatchObject({ mailboxUid: "mb2", calendarFolderUid: "f-cal2" });
    });

    it("creates the link in the mailbox Settings is showing when the mailbox is left alone", async () => {
        const fetchMock = mockTwoMailboxes(undefined, (url, init) =>
            url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(200, created) : undefined,
        );
        const user = userEvent.setup();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1"]));
        mockLocation();

        await fillAndCreate(user);

        await vi.waitFor(() => expect(postedBody(fetchMock)).toMatchObject({ mailboxUid: "mb1", calendarFolderUid: "f-cal" }));
    });

    it("carries the new mailbox's name and timezone over while they are still the old mailbox's", async () => {
        const user = userEvent.setup();
        mockTwoMailboxes();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        expect(hostName()).toHaveValue("My Mail");
        expect(timezone()).toHaveValue("America/New_York");

        await user.selectOptions(mailboxField(), "mb2");
        expect(hostName()).toHaveValue("Support Desk");
        expect(timezone()).toHaveValue("Europe/London");

        // And back again: they are still the mailbox's own.
        await user.selectOptions(mailboxField(), "mb1");
        expect(hostName()).toHaveValue("My Mail");
        expect(timezone()).toHaveValue("America/New_York");
    });

    it("keeps a host name the user typed, but still carries the timezone", async () => {
        const user = userEvent.setup();
        mockTwoMailboxes();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await user.clear(hostName());
        await user.type(hostName(), "Jane from Sales");

        await user.selectOptions(mailboxField(), "mb2");

        expect(hostName()).toHaveValue("Jane from Sales");
        expect(timezone()).toHaveValue("Europe/London");
    });

    it("keeps a timezone the user typed, but still carries the host name", async () => {
        const user = userEvent.setup();
        mockTwoMailboxes();
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await user.clear(timezone());
        await user.type(timezone(), "Asia/Tokyo");

        await user.selectOptions(mailboxField(), "mb2");

        expect(timezone()).toHaveValue("Asia/Tokyo");
        expect(hostName()).toHaveValue("Support Desk");
    });

    it("gets rid of the previous mailbox's calendar error once the new mailbox has a calendar", async () => {
        const user = userEvent.setup();
        mockTwoMailboxes((uid) => jsonResponse(200, uid === "mb2" ? [inboxFolder2, calendarFolder2] : [inboxFolder]));
        render(<NewBookingTypePage userUid="u1" />);
        expect(await screen.findByText("This mailbox has no Calendar folder yet.")).toBeInTheDocument();

        await user.selectOptions(mailboxField(), "mb2");

        await vi.waitFor(() => expect(screen.queryByText("This mailbox has no Calendar folder yet.")).not.toBeInTheDocument());
    });

    it("reports a chosen mailbox that has no calendar, and won't create the link", async () => {
        const user = userEvent.setup();
        const fetchMock = mockTwoMailboxes((uid) => jsonResponse(200, uid === "mb2" ? [inboxFolder2] : [inboxFolder, calendarFolder]));
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.selectOptions(mailboxField(), "mb2");
        expect(await screen.findByText("This mailbox has no Calendar folder yet.")).toBeInTheDocument();
        await fillAndCreate(user);

        expect(await screen.findAllByText("This mailbox has no Calendar folder yet.")).toHaveLength(2);
        expect(postedBody(fetchMock)).toBeUndefined();
    });

    it("reports a chosen mailbox whose folders can't be loaded", async () => {
        const user = userEvent.setup();
        mockTwoMailboxes((uid) => (uid === "mb2" ? jsonResponse(403, { message: "not yours" }) : jsonResponse(200, [calendarFolder])));
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");

        await user.selectOptions(mailboxField(), "mb2");

        expect(await screen.findByText("not yours")).toBeInTheDocument();
    });

    it("doesn't use the previous mailbox's calendar while the new mailbox's is still loading", async () => {
        const user = userEvent.setup();
        let answerMb2: (response: Response) => void = () => undefined;
        const fetchMock = mockTwoMailboxes(
            (uid) => (uid === "mb2" ? new Promise<Response>((resolve) => (answerMb2 = resolve)) : jsonResponse(200, [calendarFolder])),
            (url, init) => (url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(200, { ...created, mailboxUid: "mb2" }) : undefined),
        );
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1"]));
        await act(async () => undefined);

        await user.selectOptions(mailboxField(), "mb2");
        await fillAndCreate(user);

        expect(await screen.findByText("This mailbox has no Calendar folder yet.")).toBeInTheDocument();
        expect(postedBody(fetchMock)).toBeUndefined();

        // Once it has loaded, the link can be created in it.
        await act(async () => answerMb2(jsonResponse(200, [calendarFolder2])));
        mockLocation();
        await user.click(screen.getByRole("button", { name: "Create" }));
        await vi.waitFor(() => expect(postedBody(fetchMock)).toMatchObject({ mailboxUid: "mb2", calendarFolderUid: "f-cal2" }));
    });

    it("ignores the calendar of a mailbox that was left before its answer came", async () => {
        const user = userEvent.setup();
        let answerMb1: (response: Response) => void = () => undefined;
        const fetchMock = mockTwoMailboxes(
            (uid) => (uid === "mb1" ? new Promise<Response>((resolve) => (answerMb1 = resolve)) : jsonResponse(200, [inboxFolder2, calendarFolder2])),
            (url, init) => (url === "/api/mail/booking-types" && init?.method === "POST" ? jsonResponse(200, { ...created, mailboxUid: "mb2" }) : undefined),
        );
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1"]));

        await user.selectOptions(mailboxField(), "mb2");
        await vi.waitFor(() => expect(foldersRequested(fetchMock)).toEqual(["mb1", "mb2"]));
        await act(async () => undefined);
        // mb1's listing arrives late.
        await act(async () => answerMb1(jsonResponse(200, [inboxFolder, calendarFolder])));
        mockLocation();
        await fillAndCreate(user);

        await vi.waitFor(() => expect(postedBody(fetchMock)).toMatchObject({ mailboxUid: "mb2", calendarFolderUid: "f-cal2" }));
    });

    it("ignores a listing of a mailbox that was left, whether it had no calendar or failed", async () => {
        const user = userEvent.setup();
        const answers: Array<(result: Response | Error) => void> = [];
        mockTwoMailboxes((uid) => {
            if (uid === "mb1") {
                return new Promise<Response>((resolve, reject) => answers.push((result) => (result instanceof Error ? reject(result) : resolve(result))));
            }
            return jsonResponse(200, [inboxFolder2, calendarFolder2]);
        });
        render(<NewBookingTypePage userUid="u1" />);
        await screen.findByLabelText("Host name shown to visitors");
        await act(async () => undefined);

        await user.selectOptions(mailboxField(), "mb2");
        await act(async () => undefined);
        // The first listing of mb1 finds no calendar, but arrives after the switch to mb2.
        await act(async () => answers[0](jsonResponse(200, [inboxFolder])));
        expect(screen.queryByText("This mailbox has no Calendar folder yet.")).not.toBeInTheDocument();

        // Back to mb1 and on to mb2 again: the second listing of mb1 fails, but only after leaving it.
        await user.selectOptions(mailboxField(), "mb1");
        await user.selectOptions(mailboxField(), "mb2");
        await act(async () => undefined);
        await act(async () => answers[1](new TypeError("network down")));
        expect(screen.queryByText("Could not load this mailbox's folders.")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
