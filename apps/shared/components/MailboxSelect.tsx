///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { Mailbox } from "@rapidmx/react-shared/mail/mailApi.js";

const INPUT_CLASS =
    "w-full text-sm py-2.5 px-3 border border-border rounded-sm bg-surface text-text focus:outline-none focus:border-primary";

export interface MailboxSelectProps {
    id: string;
    /** The mailboxes to choose from, as Settings knows them. */
    mailboxes: Mailbox[];
    /** The `uid` of the chosen mailbox. Listed even when it isn't one of `mailboxes`, so the field never shows a lie. */
    value: string;
    onChange: (mailboxUid: string) => void;
    disabled?: boolean;
}

/** Picks the mailbox a booking link belongs to. A mailbox's `uid` is its address, so it is shown next to the name. */
export default function MailboxSelect({ id, mailboxes, value, onChange, disabled }: MailboxSelectProps) {
    const known: boolean = mailboxes.some((mailbox) => mailbox.uid === value);
    return (
        <select id={id} className={INPUT_CLASS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {!known && <option value={value}>{value}</option>}
            {mailboxes.map((mailbox) => (
                <option key={mailbox.uid} value={mailbox.uid}>
                    {mailbox.displayName} ({mailbox.uid})
                </option>
            ))}
        </select>
    );
}
