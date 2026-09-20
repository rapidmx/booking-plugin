// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// The real SettingsShell only ever hands its pages a mailbox from its own list, so a mailbox it doesn't list can't be
// produced through it: this file replaces the shell with one that reports such a mailbox, to pin what the page shows then.
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../testUtils.js";
import SettingsBookingTypesPage from "../../../apps/settings-booking-types/index.js";

vi.mock("@rapidmx/web-client/shared/components/settings/layout/SettingsShell.js", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSettingsShell: () => ({
        mailboxUid: "ghost@example.com",
        mailboxes: [{ uid: "mb1", displayName: "My Mail" }],
    }),
}));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("SettingsBookingTypesPage for a mailbox the shell does not list", () => {
    it("uses the mailbox's address where it has no display name, for the editor's avatar initial", async () => {
        const fetchMock = mockFetch((url) => {
            if (url.startsWith("/api/mail/booking-types")) return jsonResponse(200, []);
            if (url === "/api/mail/booking-profiles/ghost@example.com") return jsonResponse(200, { mailboxUid: "ghost@example.com" });
            throw new Error(`unexpected ${url}`);
        });
        render(<SettingsBookingTypesPage userUid="u1" />);

        expect(await screen.findByText("No booking links yet.")).toBeInTheDocument();
        const section = screen.getByRole("region", { name: "Booking page appearance" });
        expect(section.querySelector("span[aria-hidden='true']")).toHaveTextContent("G");
        expect(fetchMock).toHaveBeenCalledWith("/api/mail/booking-profiles/ghost@example.com", expect.anything());
    });
});
