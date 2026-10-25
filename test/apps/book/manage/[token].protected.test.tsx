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

const protection = vi.hoisted(() => ({
    takeBookingKey: vi.fn(),
    openBookerCopy: vi.fn(),
    bookingContent: vi.fn((content: any) => content),
}));
vi.mock("../../../../apps/shared/bookingProtection.js", () => protection);

const ManageBookingPage = (await import("../../../../apps/book/manage/[token].js")).default;

const KEY = { pkcs8: Uint8Array.of(1), linkKey: "k=the-booking-key-0123456789" };
const protectedBooking = {
    uid: "b1",
    mailboxUid: "jane@example.com",
    bookingTypeSlug: "intro-call",
    name: "30 Minute Intro Call",
    hostDisplayName: "Jane Host",
    meetingTypeUid: "mt1",
    meetingTypeName: "30 Minute Intro Call",
    locationType: "phone",
    bookerName: "bob@example.com",
    bookerEmail: "bob@example.com",
    startDate: "2026-09-10T13:00:00.000Z",
    endDate: "2026-09-10T13:30:00.000Z",
    status: "confirmed",
    protected: true,
    guestSealedFields: { bookerName: "c2VhbGVk" },
    meetingKeyCertificate: "Y2VydA==",
};

function mockPage(extra: (url: string, init?: RequestInit) => Response | undefined) {
    return mockFetch((url, init) => {
        const custom = extra(url, init);
        if (custom) return custom;
        if (url === "/api/system/branding") return jsonResponse(200, { companyName: "", title: "" });
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    protection.takeBookingKey.mockReset();
    protection.openBookerCopy.mockReset();
});

describe("ManageBookingPage for a protected booking", () => {
    it("shows what the booker wrote, opened with the link's key, and sends it with a cancellation for its mail", async () => {
        protection.takeBookingKey.mockReturnValue(KEY);
        protection.openBookerCopy.mockResolvedValue({ bookerName: "Bob", bookerPhone: "+1 555 0100" });
        const fetchMock = mockPage((url, init) => {
            if (url === "/api/mail/bookings/manage/tok123") return jsonResponse(200, protectedBooking);
            if (url === "/api/mail/bookings/manage/tok123/cancel" && init?.method === "POST") return jsonResponse(200, { ...protectedBooking, status: "cancelled" });
            return undefined;
        });
        const user = userEvent.setup();
        render(<ManageBookingPage params={{ token: "tok123" }} />);
        expect(await screen.findByText(/\+1 555 0100/)).toBeInTheDocument();
        expect(screen.getByText(/end-to-end encrypted/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Cancel booking" }));
        const confirm = await screen.findAllByRole("button", { name: "Cancel booking" });
        await user.click(confirm[confirm.length - 1]);
        await screen.findByText("This booking has been cancelled.");
        const cancel = fetchMock.mock.calls.find(([url]: any) => String(url).endsWith("/cancel"));
        expect(JSON.parse((cancel?.[1] as RequestInit).body as string)).toEqual({ content: { bookerName: "Bob", bookerPhone: "+1 555 0100" }, linkKey: KEY.linkKey });
    });

    it("shows a protected meeting's video link with the key the manage link carries", async () => {
        protection.takeBookingKey.mockReturnValue(KEY);
        protection.openBookerCopy.mockResolvedValue({ bookerName: "Bob" });
        mockPage((url) =>
            url === "/api/mail/bookings/manage/tok123"
                ? jsonResponse(200, { ...protectedBooking, locationType: "video", locationVideoUrl: "https://mail.example.com/meet/tok", videoLinkKeyed: true })
                : undefined,
        );
        render(<ManageBookingPage params={{ token: "tok123" }} />);
        expect(await screen.findByText(`Video call: https://mail.example.com/meet/tok#${KEY.linkKey}`)).toBeInTheDocument();
    });

    it("says the link is missing its key when it carries none, or one that doesn't open it", async () => {
        mockPage((url) => (url === "/api/mail/bookings/manage/tok123" ? jsonResponse(200, protectedBooking) : undefined));
        const { unmount } = render(<ManageBookingPage params={{ token: "tok123" }} />);
        expect(await screen.findByText(/This link is missing its key/)).toBeInTheDocument();
        // Without the key there is nothing to compose a new invitation from, so it can't be rescheduled - but it can still be cancelled.
        expect(screen.getByText(/can.t be rescheduled/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Reschedule" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel booking" })).toBeEnabled();
        unmount();

        protection.takeBookingKey.mockReturnValue(KEY);
        protection.openBookerCopy.mockResolvedValue(undefined);
        render(<ManageBookingPage params={{ token: "tok123" }} />);
        expect(await screen.findByText(/This link is missing its key/)).toBeInTheDocument();
    });
});
