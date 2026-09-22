// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testUtils.js";
import SettingsBookingTypesPage from "../../../apps/settings-booking-types/index.js";

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

function bookingType(n: number, overrides: Record<string, unknown> = {}) {
    return {
        uid: `bt${n}`,
        version: 0,
        dateCreated: "2026-01-01T00:00:00.000Z",
        dateModified: "2026-01-01T00:00:00.000Z",
        mailboxUid: "mb1",
        calendarFolderUid: "f-cal",
        slug: `intro-${n}`,
        name: `Intro Call ${n}`,
        hostDisplayName: "My Mail",
        meetingTypes: [{ uid: `mt${n}`, name: "30 Minute Meeting", durationMinutes: 30, locationOptions: [{ uid: `lo${n}`, type: "video" }] }],
        timezone: "America/New_York",
        availability: [],
        dateOverrides: [],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 60,
        bookingWindowDays: 30,
        requiresApproval: false,
        enabled: true,
        ...overrides,
    };
}

function mockShell(extra?: (url: string, init?: RequestInit) => Response | undefined, mailboxes: unknown[] = [mailbox]) {
    return mockFetch((url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (url.startsWith("/api/mail/mailboxes/auto-provision")) return jsonResponse(404, { message: "not enabled" });
        if (url.startsWith("/api/mail/mailboxes")) return jsonResponse(200, mailboxes);
        if (url.startsWith("/api/mail/booking-profiles/")) return jsonResponse(200, { mailboxUid: "mb1" });
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
}

/** Answers the list request with `types`. */
const listing = (types: unknown[]) => (url: string) => (url.startsWith("/api/mail/booking-types") ? jsonResponse(200, types) : undefined);

/** Replaces the clipboard (which `userEvent.setup()` stubs itself, so this must come after it). */
function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
    window.history.pushState(null, "", "/settings/booking-types?mailboxUid=mb1");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.pushState(null, "", "/");
});

describe("SettingsBookingTypesPage", () => {
    it("shows an empty state when there are no booking links", async () => {
        mockShell(listing([]));
        render(<SettingsBookingTypesPage userUid="u1" />);
        expect(await screen.findByText("No booking links yet.")).toBeInTheDocument();
    });

    it("lists booking links with their public link, duration, and enabled state", async () => {
        mockShell(listing([bookingType(1), bookingType(2, { enabled: false })]));
        render(<SettingsBookingTypesPage userUid="u1" />);

        expect(await screen.findByText("Intro Call 1")).toBeInTheDocument();
        // The link column shows the mailbox-scoped public path.
        expect(screen.getByText("/book/mb1/intro-1")).toBeInTheDocument();
        expect(screen.getByText("/book/mb1/intro-2")).toBeInTheDocument();
        expect(screen.getAllByText("30 Minute Meeting (30 min)")).toHaveLength(2);
        expect(screen.getByText("Yes")).toBeInTheDocument();
        expect(screen.getByText("No")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "+ New booking link" })).toHaveAttribute(
            "href",
            "/settings/booking-types/new?mailboxUid=mb1",
        );
        expect(screen.getAllByRole("link", { name: "View" })[0]).toHaveAttribute(
            "href",
            "/settings/booking-types/bt1?mailboxUid=mb1",
        );
    });

    it("shows a link's public path under the mailbox it is saved in, with the address's @ readable", async () => {
        mockShell(listing([bookingType(1, { mailboxUid: "team+ops@example.com" })]));
        render(<SettingsBookingTypesPage userUid="u1" />);
        expect(await screen.findByText("/book/team%2Bops@example.com/intro-1")).toBeInTheDocument();
    });

    it("shows an error message when the list fails to load", async () => {
        mockShell((url) => (url.startsWith("/api/mail/booking-types") ? jsonResponse(500, { message: "boom" }) : undefined));
        render(<SettingsBookingTypesPage userUid="u1" />);
        expect(await screen.findByText("boom")).toBeInTheDocument();
    });

    it("shows a generic error message when the list fails with a non-API error", async () => {
        mockShell((url) => {
            if (url.startsWith("/api/mail/booking-types")) throw new TypeError("network down");
            return undefined;
        });
        render(<SettingsBookingTypesPage userUid="u1" />);
        expect(await screen.findByText("Could not load your booking links.")).toBeInTheDocument();
    });

    describe("booking page appearance", () => {
        it("shows the editor of the selected mailbox's banner and avatar above the list", async () => {
            const fetchMock = mockShell(
                (url) =>
                    url === "/api/mail/booking-profiles/mb1"
                        ? jsonResponse(200, { mailboxUid: "mb1", avatarVersion: "a1", bannerVersion: "b1" })
                        : url.startsWith("/api/mail/booking-types")
                          ? jsonResponse(200, [bookingType(1)])
                          : undefined,
            );
            render(<SettingsBookingTypesPage userUid="u1" />);

            const section = await screen.findByRole("region", { name: "Booking page appearance" });
            expect(await within(section).findByAltText("Banner preview")).toHaveAttribute(
                "src",
                "/api/mail/booking-profiles/mb1/banner?v=b1",
            );
            expect(within(section).getByAltText("Avatar preview")).toHaveAttribute("src", "/api/mail/booking-profiles/mb1/avatar?v=a1");
            expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-profiles/mb1", expect.anything());
            // It comes before the list of links.
            expect(section.compareDocumentPosition(await screen.findByText("Intro Call 1")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("starts the avatar off with the initial of the selected mailbox's name", async () => {
            mockShell(listing([]));
            render(<SettingsBookingTypesPage userUid="u1" />);
            const section = await screen.findByRole("region", { name: "Booking page appearance" });
            await screen.findByText("No booking links yet.");
            expect(section.querySelector("span[aria-hidden='true']")).toHaveTextContent("M");
        });

        it("loads the editor afresh for another mailbox", async () => {
            const other = { ...mailbox, uid: "mb2", displayName: "Support Desk" };
            window.history.pushState(null, "", "/settings/booking-types?mailboxUid=mb2");
            const fetchMock = mockShell(
                (url) => {
                    if (url === "/api/mail/booking-profiles/mb2") return jsonResponse(200, { mailboxUid: "mb2", bannerVersion: "b9" });
                    if (url.startsWith("/api/mail/booking-types")) return jsonResponse(200, []);
                    return undefined;
                },
                [mailbox, other],
            );
            render(<SettingsBookingTypesPage userUid="u1" />);

            expect(await screen.findByAltText("Banner preview")).toHaveAttribute("src", "/api/mail/booking-profiles/mb2/banner?v=b9");
            expect(fetchMock).not.toHaveBeenCalledWith("/api/mail/booking-profiles/mb1", expect.anything());
            expect(screen.getByRole("region", { name: "Booking page appearance" }).querySelector("span[aria-hidden='true']")).toHaveTextContent("S");
        });
    });

    describe("Copy link", () => {
        const publicUrl = (n: number) => `${window.location.origin}/book/mb1/intro-${n}`;

        it("has a button per link that names the link it copies", async () => {
            mockShell(listing([bookingType(1), bookingType(2)]));
            render(<SettingsBookingTypesPage userUid="u1" />);

            expect(await screen.findByRole("button", { name: "Copy link to Intro Call 1" })).toHaveTextContent("Copy link");
            expect(screen.getByRole("button", { name: "Copy link to Intro Call 2" })).toHaveTextContent("Copy link");
        });

        it("copies the link's full public URL and says so", async () => {
            mockShell(listing([bookingType(1), bookingType(2)]));
            const writeText = vi.fn().mockResolvedValue(undefined);
            const user = userEvent.setup();
            render(<SettingsBookingTypesPage userUid="u1" />);
            const first = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            stubClipboard(writeText);

            await user.click(first);

            expect(writeText).toHaveBeenCalledTimes(1);
            expect(writeText).toHaveBeenCalledWith(publicUrl(1));
            expect(first).toHaveTextContent("Copied");
            // Only the row that was copied says so.
            expect(screen.getByRole("button", { name: "Copy link to Intro Call 2" })).toHaveTextContent("Copy link");
        });

        it("copies the URL of a link saved in another mailbox with that mailbox in it", async () => {
            mockShell(listing([bookingType(1, { mailboxUid: "team@example.com", slug: "a b" })]));
            const writeText = vi.fn().mockResolvedValue(undefined);
            const user = userEvent.setup();
            render(<SettingsBookingTypesPage userUid="u1" />);
            const button = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            stubClipboard(writeText);

            await user.click(button);

            expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/book/team@example.com/a%20b`);
        });

        it("goes back to 'Copy link' two seconds later", async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            mockShell(listing([bookingType(1)]));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            render(<SettingsBookingTypesPage userUid="u1" />);
            const button = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            stubClipboard(vi.fn().mockResolvedValue(undefined));

            await user.click(button);
            expect(button).toHaveTextContent("Copied");

            await act(() => vi.advanceTimersByTimeAsync(1900));
            expect(button).toHaveTextContent("Copied");
            await act(() => vi.advanceTimersByTimeAsync(200));
            expect(button).toHaveTextContent("Copy link");
        });

        it("keeps saying 'Copied' on a second link when the first one's timer runs out", async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            mockShell(listing([bookingType(1), bookingType(2)]));
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            render(<SettingsBookingTypesPage userUid="u1" />);
            const first = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            const second = screen.getByRole("button", { name: "Copy link to Intro Call 2" });
            stubClipboard(vi.fn().mockResolvedValue(undefined));

            await user.click(first);
            await act(() => vi.advanceTimersByTimeAsync(1000));
            await user.click(second);
            expect(first).toHaveTextContent("Copy link");
            expect(second).toHaveTextContent("Copied");

            // The first link's timer runs out here, and must not clear the second's confirmation.
            await act(() => vi.advanceTimersByTimeAsync(1100));
            expect(second).toHaveTextContent("Copied");
            await act(() => vi.advanceTimersByTimeAsync(1000));
            expect(second).toHaveTextContent("Copy link");
        });

        it("says the link couldn't be copied when the browser refuses the clipboard", async () => {
            mockShell(listing([bookingType(1)]));
            const writeText = vi.fn().mockRejectedValue(new Error("denied"));
            const user = userEvent.setup();
            render(<SettingsBookingTypesPage userUid="u1" />);
            const button = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            stubClipboard(writeText);

            await user.click(button);

            expect(await screen.findByText("Could not copy the link. Open the booking link and copy its address by hand.")).toBeInTheDocument();
            expect(button).toHaveTextContent("Copy link");
        });

        it("clears that message once a copy works", async () => {
            mockShell(listing([bookingType(1)]));
            const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
            const user = userEvent.setup();
            render(<SettingsBookingTypesPage userUid="u1" />);
            const button = await screen.findByRole("button", { name: "Copy link to Intro Call 1" });
            stubClipboard(writeText);

            await user.click(button);
            await screen.findByText(/Could not copy the link/);
            await user.click(button);

            expect(button).toHaveTextContent("Copied");
            expect(screen.queryByText(/Could not copy the link/)).not.toBeInTheDocument();
        });
    });
});
