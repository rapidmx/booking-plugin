// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../../testUtils.js";

const { protectBooking } = vi.hoisted(() => ({ protectBooking: vi.fn() }));
vi.mock("../../../../apps/shared/bookingProtection.js", () => ({ protectBooking }));

const PublicBookingPage = (await import("../../../../apps/book/[mailboxUid]/[slug].js")).default;

const protectedType = {
    mailboxUid: "jane@example.com",
    slug: "intro-call",
    name: "30 Minute Intro Call",
    hostDisplayName: "Jane Host",
    meetingTypes: [{ uid: "mt1", name: "30 Minute Intro Call", durationMinutes: 30, locationOptions: [{ uid: "lo1", type: "video" }] }],
    timezone: "America/New_York",
    requiresApproval: false,
    minimumNoticeMinutes: 60,
    bookingWindowDays: 30,
    hostCertificate: "aG9zdA==",
    hostCertificateFingerprint: "ab".repeat(32),
};
const slot = { start: "2026-09-10T13:00:00.000Z", end: "2026-09-10T13:30:00.000Z" };
const PROTECTION = { linkKey: "k=the-booking-key-0123456789", sealedFields: { bookerName: "c2VhbGVk" } };

afterEach(() => {
    vi.unstubAllGlobals();
    protectBooking.mockReset();
});

describe("PublicBookingPage for a protected host", () => {
    it("seals what the booker writes before booking, and keys the manage link it shows", async () => {
        protectBooking.mockResolvedValue(PROTECTION);
        const fetchMock = mockFetch((url, init) => {
            if (url === "/api/system/branding") return jsonResponse(200, { companyName: "", title: "" });
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, protectedType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot]);
            if (init?.method === "POST")
                {return jsonResponse(200, { uid: "b1", meetingTypeName: "30 Minute Intro Call", hostDisplayName: "Jane Host", startDate: slot.start, endDate: slot.end, status: "confirmed", manageToken: "tok123" });}
            throw new Error(`unexpected ${url}`);
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");
        await user.click(screen.getByRole("button", { name: new Date(slot.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }));
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));

        expect(await screen.findByRole("link", { name: /book\/manage\/tok123#k=the-booking-key/ })).toBeInTheDocument();
        expect(protectBooking).toHaveBeenCalledWith(
            "jane@example.com",
            protectedType.hostCertificate,
            protectedType.hostCertificateFingerprint,
            expect.objectContaining({ bookerName: "Bob" }),
            new Date(slot.end),
            "30 Minute Intro Call with Bob",
        );
        const post = fetchMock.mock.calls.find(([, init]: any) => init?.method === "POST");
        expect(JSON.parse((post?.[1] as RequestInit).body as string).protection).toEqual(PROTECTION);
    });

    it("shows a protected meeting's video link with the booking's key", async () => {
        protectBooking.mockResolvedValue(PROTECTION);
        mockFetch((url, init) => {
            if (url === "/api/system/branding") return jsonResponse(200, { companyName: "", title: "" });
            if (url === "/api/mail/bookings/types/jane@example.com/intro-call" && (init?.method ?? "GET") === "GET") return jsonResponse(200, protectedType);
            if (url.startsWith("/api/mail/bookings/types/jane@example.com/intro-call/slots?")) return jsonResponse(200, [slot]);
            if (init?.method === "POST") {
                return jsonResponse(200, {
                    uid: "b1",
                    meetingTypeName: "30 Minute Intro Call",
                    hostDisplayName: "Jane Host",
                    locationType: "video",
                    locationVideoUrl: "https://mail.example.com/meet/tok",
                    videoLinkKeyed: true,
                    startDate: slot.start,
                    endDate: slot.end,
                    status: "confirmed",
                    manageToken: "tok123",
                });
            }
            throw new Error(`unexpected ${url}`);
        });
        const user = userEvent.setup();
        render(<PublicBookingPage params={{ mailboxUid: "jane@example.com", slug: "intro-call" }} />);
        await screen.findByText("30 Minute Intro Call");
        await user.click(screen.getByRole("button", { name: new Date(slot.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }));
        await user.type(screen.getByLabelText("Your name"), "Bob");
        await user.type(screen.getByLabelText("Your email"), "bob@example.com");
        await user.click(screen.getByRole("button", { name: "Confirm booking" }));
        expect(await screen.findByText("Video call: https://mail.example.com/meet/tok#k=the-booking-key-0123456789")).toBeInTheDocument();
    });
});
