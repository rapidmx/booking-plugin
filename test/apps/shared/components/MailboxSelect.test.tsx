// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Mailbox } from "@rapidmx/react-shared/mail/mailApi.js";
import MailboxSelect from "../../../../apps/shared/components/MailboxSelect.js";

function mailbox(uid: string, displayName: string): Mailbox {
    return {
        uid,
        version: 0,
        dateCreated: "2026-01-01T00:00:00.000Z",
        dateModified: "2026-01-01T00:00:00.000Z",
        primarySmtpAddress: uid,
        aliasAddresses: [],
        displayName,
        timezone: "UTC",
        quotaBytes: 1,
        usedBytes: 0,
    };
}

const mailboxes = [mailbox("jane@example.com", "Jane Host"), mailbox("support@example.com", "Support")];

describe("MailboxSelect", () => {
    it("lists each mailbox as its name and its address", () => {
        render(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={() => undefined} />);

        const options = screen.getAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual(["Jane Host (jane@example.com)", "Support (support@example.com)"]);
        expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual(["jane@example.com", "support@example.com"]);
    });

    it("sets the element id, so a label can point at it", () => {
        render(
            <>
                <label htmlFor="mailboxUid">Mailbox</label>
                <MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={() => undefined} />
            </>,
        );
        expect(screen.getByLabelText("Mailbox")).toHaveAttribute("id", "mailboxUid");
    });

    it("selects the current value", () => {
        render(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="support@example.com" onChange={() => undefined} />);
        expect(screen.getByRole("combobox")).toHaveValue("support@example.com");
    });

    it("adds no extra option for a value that is one of the mailboxes", () => {
        render(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={() => undefined} />);
        expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("lists a current value that isn't one of the mailboxes, first, so the field never shows a lie", () => {
        render(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="old@example.com" onChange={() => undefined} />);

        const options = screen.getAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual([
            "old@example.com",
            "Jane Host (jane@example.com)",
            "Support (support@example.com)",
        ]);
        expect(screen.getByRole("combobox")).toHaveValue("old@example.com");
    });

    it("still lists the current value when there are no mailboxes at all", () => {
        render(<MailboxSelect id="mailboxUid" mailboxes={[]} value="old@example.com" onChange={() => undefined} />);
        expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["old@example.com"]);
    });

    it("reports the uid of the mailbox that was chosen", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        render(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={onChange} />);

        await user.selectOptions(screen.getByRole("combobox"), "support@example.com");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("support@example.com");
    });

    it("can be disabled", async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        const { rerender } = render(
            <MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={onChange} disabled />,
        );
        expect(screen.getByRole("combobox")).toBeDisabled();
        await user.selectOptions(screen.getByRole("combobox"), "support@example.com");
        expect(onChange).not.toHaveBeenCalled();

        rerender(<MailboxSelect id="mailboxUid" mailboxes={mailboxes} value="jane@example.com" onChange={onChange} />);
        expect(screen.getByRole("combobox")).toBeEnabled();
    });
});
