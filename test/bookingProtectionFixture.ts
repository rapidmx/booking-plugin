///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A protected booking's `protection`, as the booking page sends it - sealed values stand in as base64 (the server only checks their shape).

/** The link key a protected booking's links carry. */
export const LINK_KEY = "k=" + "L".repeat(30);

/** A booking key's signature binding the booking to its booker, as the booking page sends it (the server only checks its shape). */
export const KEY_BINDING = Buffer.alloc(64, 7).toString("base64");

/** `text` as an opaque sealed value. */
export const sealed = (text: string): string => Buffer.from(`sealed:${text}`).toString("base64");

/** A valid `protection` for a booking of `mailboxUid`, whose host's zero-access key is `hostFingerprint`, ending at `slotEnd`. */
export function bookingProtection(mailboxUid: string, hostFingerprint: string, slotEnd: string = "2099-06-01T14:00:00.000Z", overrides: Record<string, unknown> = {}) {
    return {
        meetingKey: { certificate: Buffer.from("booking certificate").toString("base64") },
        keyExpiresAt: new Date(Date.parse(slotEnd) + 3_600_000).toISOString(),
        keyWraps: [{ mailboxUid, recipientFingerprint: hostFingerprint, kind: "meeting-key", cms: sealed("wrap") }],
        sealedFields: { bookerName: sealed("host:Grace Hopper"), bookerNotes: sealed("host:notes") },
        guestSealedFields: { bookerName: sealed("guest:Grace Hopper"), bookerNotes: sealed("guest:notes") },
        meetingTitle: sealed("Intro Call with Grace Hopper"),
        linkKey: LINK_KEY,
        keyBinding: KEY_BINDING,
        ...overrides,
    };
}
