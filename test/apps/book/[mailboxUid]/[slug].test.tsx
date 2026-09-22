// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../../testUtils.js";
import PublicBookingPage from "../../../../apps/book/[mailboxUid]/[slug].js";

const publicBookingType = {
    mailboxUid: "jane@example.com",
    slug: "intro-call",
    name: "30 Minute Intro Call",
    description: "Let's chat",
    hostDisplayName: "Jane Host",
    meetingTypes: [{ uid: "mt1", name: "30 Minute Intro Call", durationMinutes: 30, locationOptions: [{ uid: "lo1", type: "video" }] }],
    timezone: "America/New_York",
    requiresApproval: false,
    minimumNoticeMinutes: 60,
    bookingWindowDays: 30,
};

const slot1 = { start: "2026-09-10T13:00:00.000Z", end: "2026-09-10T13:30:00.000Z" };
const slot2 = { start: "2026-09-10T14:00:00.000Z", end: "2026-09-10T14:30:00.000Z" };

function mockPage(extra?: (url: string, init?: RequestInit) => Response | undefined) {
    return mockFetch((url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (url === "/api/system/branding") return jsonResponse(200, { companyName: "", title: "" });
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("PublicBookingPage", () => {
    it("pages through the whole booking window with Show later times", async () => {
        const later = { start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T15:30:00.000Z" };
        const requested: URLSearchParams[] = [];
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 45 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                requested.push(new URL(url, "http://localhost").searchParams);
                return jsonResponse(200, requested.length === 1 ? [slot1] : [later]);
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await user.click(await screen.findByRole("button", { name: "Show later times" }));
        const laterLabel = new Date(later.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(await screen.findByRole("button", { name: laterLabel })).toBeInTheDocument();
        // The second window starts where the first ended, and the 45-day window is then exhausted.
        expect(requested).toHaveLength(2);
        expect(requested[1].get("from")).toBe(requested[0].get("to"));
        expect(screen.queryByRole("button", { name: "Show later times" })).not.toBeInTheDocument();
    });

    it("shows an error when loading later times fails, keeping the slots already shown", async () => {
        let calls = 0;
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 90 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                calls++;
                return calls === 1 ? jsonResponse(200, [slot1]) : jsonResponse(429, { message: "slow down" });
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await user.click(await screen.findByRole("button", { name: "Show later times" }));
        expect(await screen.findByText("slow down")).toBeInTheDocument();
        const slotLabel = new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(screen.getByRole("button", { name: slotLabel })).toBeInTheDocument();
    });

    it("shows a generic error when loading later times fails with a non-API error", async () => {
        let calls = 0;
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 90 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                calls++;
                if (calls === 1) return jsonResponse(200, [slot1]);
                throw new TypeError("network down");
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await user.click(await screen.findByRole("button", { name: "Show later times" }));
        expect(await screen.findByText("Could not load more times.")).toBeInTheDocument();
        // The cursor is kept, so the visitor can retry.
        expect(screen.getByRole("button", { name: "Show later times" })).toBeEnabled();
    });

    it("stops after two fully booked windows on first load and offers Show later times", async () => {
        const DAY = 24 * 60 * 60 * 1000;
        const later = { start: new Date(Date.now() + 100 * DAY).toISOString(), end: new Date(Date.now() + 100 * DAY + 1800000).toISOString() };
        const requested: URLSearchParams[] = [];
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 120 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                requested.push(new URL(url, "http://localhost").searchParams);
                // Windows 1-3 fully booked, window 4 has `later`.
                return jsonResponse(200, requested.length === 4 ? [later] : []);
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        // The page load asks for two windows only (the anonymous rate limit is shared per IP), then leaves it to the visitor.
        expect(await screen.findByText("No open times in the next few weeks.")).toBeInTheDocument();
        expect(screen.queryByText(/No open slots right now/)).not.toBeInTheDocument();
        expect(requested).toHaveLength(2);

        await user.click(screen.getByRole("button", { name: "Show later times" }));
        const laterDate = new Date(later.start).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        expect(await screen.findByRole("heading", { name: laterDate })).toBeInTheDocument();
        expect(requested).toHaveLength(4);
        expect(screen.queryByText("No open times in the next few weeks.")).not.toBeInTheDocument();
        // The 120-day window is exhausted after the fourth 30-day chunk.
        expect(screen.queryByRole("button", { name: "Show later times" })).not.toBeInTheDocument();
    });

    it("removes Show later times, without an error, when the rest of the window turns out fully booked", async () => {
        let calls = 0;
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 90 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                calls++;
                return jsonResponse(200, calls === 1 ? [slot1] : []);
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await user.click(await screen.findByRole("button", { name: "Show later times" }));
        await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Show later times" })).not.toBeInTheDocument());
        // Both remaining 30-day chunks were tried; the slot already shown stays, and nothing was added.
        expect(calls).toBe(3);
        const slotLabel = new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(screen.getByRole("button", { name: slotLabel })).toBeInTheDocument();
        expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
        expect(screen.queryByText("Could not load more times.")).not.toBeInTheDocument();
        expect(screen.queryByText(/No open slots right now/)).not.toBeInTheDocument();
    });

    it("resumes after a 500-slot cut-off response just past its last slot, without duplicating slots", async () => {
        const MINUTE = 60 * 1000;
        const dayStart = Math.floor(Date.now() / (24 * 60 * MINUTE)) * 24 * 60 * MINUTE + 2 * 24 * 60 * MINUTE;
        const at = (ms: number) => ({ start: new Date(ms).toISOString(), end: new Date(ms + MINUTE).toISOString() });
        // 500 one-minute slots, all on the same (UTC) day, so each time label is unique.
        const full = Array.from({ length: 500 }, (_v, i) => at(dayStart + i * MINUTE));
        const last = full[full.length - 1];
        const rest = at(dayStart + 500 * MINUTE);
        const requested: URLSearchParams[] = [];
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: 30 });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                requested.push(new URL(url, "http://localhost").searchParams);
                return jsonResponse(200, requested.length === 1 ? full : [last, rest]);
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        // Even a 30-day window offers more after a cut-off response.
        await user.click(await screen.findByRole("button", { name: "Show later times" }));
        const label = (slot: { start: string }) => new Date(slot.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(await screen.findByRole("button", { name: label(rest) })).toBeInTheDocument();
        expect(requested[1].get("from")).toBe(new Date(Date.parse(last.start) + 1).toISOString());
        expect(screen.getAllByRole("button", { name: label(last) })).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Show later times" })).not.toBeInTheDocument();
    });

    it("offers no later times when the default 30-day window is covered by the first response", async () => {
        const requested: string[] = [];
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, bookingWindowDays: undefined });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                requested.push(url);
                return jsonResponse(200, [slot1]);
            }
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        const slotLabel = new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        expect(await screen.findByRole("button", { name: slotLabel })).toBeInTheDocument();
        expect(requested).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Show later times" })).not.toBeInTheDocument();
    });

    it("shows the offering details and grouped slots once loaded", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1, slot2]);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        // The host is the page's heading and the booking type a sub-heading under it.
        expect(await screen.findByRole("heading", { level: 1, name: "Jane Host" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "30 Minute Intro Call" })).toBeInTheDocument();
        expect(screen.getByText("Let's chat")).toBeInTheDocument();
        expect(screen.getByText("30 minutes")).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 2, name: "Select a time" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 3, name: "Thursday, September 10, 2026" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "1:00 PM" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "2:00 PM" })).toBeInTheDocument();
    });

    it("asks for the booking type and its slots by mailbox and slug, keeping the mailbox's @ readable", async () => {
        const requested: string[] = [];
        mockPage((url) => {
            requested.push(url);
            if (url === "/api/mail/bookings/types/team%2Bops@example.com/a%20b") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/team%2Bops@example.com/a%20b/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "team+ops@example.com", slug: "a b" }} />);

        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(requested).toContain("/api/mail/bookings/types/team%2Bops@example.com/a%20b");
        expect(requested.some((url) => url.startsWith("/api/mail/bookings/types/team%2Bops@example.com/a%20b/slots?"))).toBe(true);
    });

    it("draws no logo of its own, leaving the branding header to carry it", async () => {
        mockPage((url) => {
            if (url === "/api/system/branding") return jsonResponse(200, { companyName: "Acme", title: "Acme Mail", logoUrl: "/logo.png" });
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const { container } = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(container.querySelector("img")).toBeNull();
    });

    it("shows the host's initial when the mailbox has no avatar or banner", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const { container } = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("main span[aria-hidden='true']")).toHaveTextContent("J");
    });

    it("shows the host's banner and avatar from the versions on the booking type", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") {
                return jsonResponse(200, { ...publicBookingType, avatarVersion: "av1", bannerVersion: "bn 2" });
            }
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const { container } = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        const sources = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
        expect(sources).toEqual([
            "/api/mail/booking-profiles/jane@example.com/banner?v=bn%202",
            "/api/mail/booking-profiles/jane@example.com/avatar?v=av1",
        ]);
        // The initial is only the fallback for a missing avatar.
        expect(container.querySelector("main span[aria-hidden='true']")).toBeNull();
    });

    it("shows only the banner when there is no avatar, and only the avatar when there is no banner", async () => {
        let type: Record<string, unknown> = { ...publicBookingType, bannerVersion: "bn1" };
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, type);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const first = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(Array.from(first.container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
            "/api/mail/booking-profiles/jane@example.com/banner?v=bn1",
        ]);
        expect(first.container.querySelector("main span[aria-hidden='true']")).toHaveTextContent("J");
        first.unmount();

        type = { ...publicBookingType, avatarVersion: "av1" };
        const second = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(Array.from(second.container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
            "/api/mail/booking-profiles/jane@example.com/avatar?v=av1",
        ]);
    });

    it("notes that the host confirms each booking only when approval is required", async () => {
        let requiresApproval = true;
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, requiresApproval });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const first = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(await screen.findByText("Jane Host confirms each booking.")).toBeInTheDocument();
        first.unmount();

        requiresApproval = false;
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(screen.queryByText(/confirms each booking/)).not.toBeInTheDocument();
    });

    it("omits the description when the booking type has none", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, { ...publicBookingType, description: undefined });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const { container } = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        await screen.findByRole("heading", { level: 1, name: "Jane Host" });
        expect(container.querySelector("p.whitespace-pre-line")).toBeNull();
    });

    it("shows the time zone the slot times are in", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);

        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        expect(await screen.findByText(`Times are shown in your time zone (${zone}).`)).toBeInTheDocument();
    });

    it("shows no host hero while loading or when the booking type can't be loaded", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(404, { message: "not found" });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, []);
            return undefined;
        });
        const { container } = render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(screen.getByText("Loading…")).toBeInTheDocument();
        expect(container.querySelector("main span[aria-hidden='true']")).toBeNull();

        await screen.findByText("not found");
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("main span[aria-hidden='true']")).toBeNull();
        expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    });

    it("shows an error when the booking type fails to load", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(404, { message: "not found" });
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, []);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(await screen.findByText("not found")).toBeInTheDocument();
    });

    it("shows a generic error message when loading fails with a non-API error", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") throw new TypeError("network down");
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, []);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(await screen.findByText("Could not load this booking page.")).toBeInTheDocument();
    });

    it("falls back to a generic unavailable message when the load succeeds with no booking type and no error", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, null);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, []);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(await screen.findByText("This booking link is not available.")).toBeInTheDocument();
    });

    it("shows an empty state when there are no open slots", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, []);
            return undefined;
        });
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        expect(await screen.findByText("No open slots right now — please check back later.")).toBeInTheDocument();
    });

    it("selects a slot, submits the booking form, and shows a confirmation with the manage link", async () => {
        const fetchMock = mockPage((url, init) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && init?.method === "POST") {
                return jsonResponse(200, {
                    uid: "b1",
                    bookingTypeSlug: "intro-call",
                    name: "30 Minute Intro Call",
                    hostDisplayName: "Jane Host",
                    meetingTypeUid: "mt1",
                    meetingTypeName: "30 Minute Intro Call",
                    locationType: "video",
                    bookerName: "Bob",
                    bookerEmail: "bob@example.com",
                    startDate: slot1.start,
                    endDate: slot1.end,
                    status: "confirmed",
                    manageToken: "tok123",
                });
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        await user.click(screen.getByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }));
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.type(screen.getByLabelText("Notes (optional)"), "Looking forward to it");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByText("You’re booked!")).toBeInTheDocument();
        expect(screen.getByText(/Save this link to cancel or reschedule later/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /book\/manage\/tok123/ })).toBeInTheDocument();
        // The confirmation names the meeting type and host, and the visitor's chosen time.
        const when = new Date(slot1.start).toLocaleString();
        expect(screen.getByText(`30 Minute Intro Call with Jane Host on ${when}.`)).toBeInTheDocument();
        // The selection form and the time list give way to the confirmation; the host stays in view.
        expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1, name: "Jane Host" })).toBeInTheDocument();
        // Booked through the mailbox-scoped endpoint, with the visitor's own zone and chosen meeting type/location.
        const post = fetchMock.mock.calls.find(([, init]: any) => init?.method === "POST");
        expect(post?.[0]).toBe("/api/mail/bookings/types/jane@example.com/intro-call");
        expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
            start: slot1.start,
            meetingTypeUid: "mt1",
            locationOptionUid: "lo1",
            bookerName: "Bob",
            bookerEmail: "bob@example.com",
            bookerNotes: "Looking forward to it",
            bookerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
    });

    it("requires a name and email before submitting", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        await user.click(
            screen.getByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }),
        );
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByText("Your name and email are both required.")).toBeInTheDocument();
    });

    it("lets the visitor choose a different time before booking", async () => {
        mockPage((url) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        const timeLabel = new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        await user.click(screen.getByRole("button", { name: timeLabel }));
        await user.click(screen.getByRole("button", { name: "Choose a different time" }));

        expect(screen.getByRole("button", { name: timeLabel })).toBeInTheDocument();
    });

    it("shows an error message when booking fails", async () => {
        mockPage((url, init) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && init?.method === "POST") return jsonResponse(409, { message: "slot taken" });
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        await user.click(
            screen.getByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }),
        );
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByText("slot taken")).toBeInTheDocument();
    });

    it("shows a generic error message when booking fails with a non-API error", async () => {
        mockPage((url, init) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && init?.method === "POST") throw new TypeError("network down");
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        await user.click(
            screen.getByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }),
        );
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByText("Could not book this slot.")).toBeInTheDocument();
    });

    it("shows a confirmation with no manage link when the response carries no manageToken", async () => {
        mockPage((url, init) => {
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, publicBookingType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && init?.method === "POST") {
                return jsonResponse(200, {
                    uid: "b1",
                    bookingTypeSlug: "intro-call",
                    name: "30 Minute Intro Call",
                    hostDisplayName: "Jane Host",
                    meetingTypeUid: "mt1",
                    meetingTypeName: "30 Minute Intro Call",
                    locationType: "video",
                    bookerName: "Bob",
                    bookerEmail: "bob@example.com",
                    startDate: slot1.start,
                    endDate: slot1.end,
                    status: "confirmed",
                });
            }
            return undefined;
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");

        await user.click(
            screen.getByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }),
        );
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByText("You’re booked!")).toBeInTheDocument();
        expect(screen.queryByText(/Save this link/)).not.toBeInTheDocument();
    });

    describe("multiple meeting types and locations", () => {
        const twoMeetingTypes = {
            ...publicBookingType,
            meetingTypes: [
                { uid: "mt1", name: "15 Min Chat", durationMinutes: 15, locationOptions: [{ uid: "lo1", type: "video" }] },
                {
                    uid: "mt2",
                    name: "60 Min Deep Dive",
                    durationMinutes: 60,
                    locationOptions: [
                        { uid: "lo2", type: "phone" },
                        { uid: "lo3", type: "other", label: "In person" },
                    ],
                },
            ],
        };

        it("offers a meeting type selector when there's more than one, and reloads slots for the chosen one", async () => {
            const requested: string[] = [];
            mockPage((url) => {
                if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, twoMeetingTypes);
                if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) {
                    requested.push(url);
                    return jsonResponse(200, [slot1]);
                }
                return undefined;
            });
            const user = userEvent.setup();
            render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
            await screen.findByText("30 Minute Intro Call");

            expect(requested[0]).toContain("meetingTypeUid=mt1");
            await user.click(screen.getByRole("radio", { name: /60 Min Deep Dive/ }));

            await vi.waitFor(() => expect(requested[requested.length - 1]).toContain("meetingTypeUid=mt2"));
        });

        it("requires a phone number before submitting a phone-location booking", async () => {
            mockPage((url) => {
                if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, twoMeetingTypes);
                if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
                return undefined;
            });
            const user = userEvent.setup();
            render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
            await screen.findByText("30 Minute Intro Call");

            await user.click(screen.getByRole("radio", { name: /60 Min Deep Dive/ }));
            await user.click(await screen.findByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }));
            await user.type(screen.getByLabelText("Your name"), "Bob");
            await user.type(screen.getByLabelText("Your email"), "bob@example.com");
            await user.click(screen.getByRole("radio", { name: "Phone" }));
            await user.click(screen.getByRole("button", { name: "Confirm booking" }));

            expect(await screen.findByText("Please enter a phone number.")).toBeInTheDocument();
        });

        it("shows the 'Other' location's custom label and requires instructions before submitting", async () => {
            mockPage((url) => {
                if (url === "/api/mail/bookings/types/jane@example.com/intro-call") return jsonResponse(200, twoMeetingTypes);
                if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot1]);
                return undefined;
            });
            const user = userEvent.setup();
            render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
            await screen.findByText("30 Minute Intro Call");

            await user.click(screen.getByRole("radio", { name: /60 Min Deep Dive/ }));
            await user.click(await screen.findByRole("button", { name: new Date(slot1.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }));
            expect(screen.getByRole("radio", { name: "In person" })).toBeInTheDocument();
            await user.type(screen.getByLabelText("Your name"), "Bob");
            await user.type(screen.getByLabelText("Your email"), "bob@example.com");
            await user.click(screen.getByRole("radio", { name: "In person" }));
            await user.click(screen.getByRole("button", { name: "Confirm booking" }));

            expect(await screen.findByText("Please describe how to reach you.")).toBeInTheDocument();
        });
    });
});
