///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * A protected booking on the client (meet-plugin `specs/meeting_privacy.md` §6.2). When the host's calendar is covered by zero-access
 * encryption the booking page makes a temporary booking key and seals what the booker writes twice: to the host's zero-access certificate
 * (the host's copy) and to the booking key (the booker's copy, opened with the key their manage link carries after `#k=`). The booking key
 * itself is wrapped to the host, so the host's client can send the booker their links again. The server never holds the key.
 */
import { fromBase64, toBase64 } from "@rapidmx/web-client/lib/crypto/encoding.js";
import { getUnlockedKeys } from "@rapidmx/web-client/lib/crypto/keySession.js";
import { generateMeetingKey, importMeetingKey, meetingKeyFragment, readMeetingKeyFragment } from "@rapidmx/web-client/lib/crypto/meetingKeys.js";
import { decryptEnvelopedDataWithKeys, encryptForRecipients } from "@rapidmx/web-client/lib/crypto/smime.js";
import { isOpenedRecord, openSealedRecord } from "@rapidmx/web-client/lib/zeroAccess/sealedRecords.js";
import type { PublicBooking } from "./bookingApi.js";

/** The booker-written fields a protected booking seals. */
export interface BookingContent {
    bookerName?: string;
    bookerNotes?: string;
    bookerPhone?: string;
    bookerLocationInstructions?: string;
}

const CONTENT_FIELDS = ["bookerName", "bookerNotes", "bookerPhone", "bookerLocationInstructions"] as const;

/**
 * Whether every booker-written field `booking` holds is text (or unset). What opens from a sealed field is whatever was sealed, and anyone
 * can seal to the host's public certificate: the server checks only that a sealed value is a blob, so a booker can seal an object as their
 * name. One must never reach the page (React refuses to render it, taking the host's list down with it) nor a request.
 */
function hasTextContent(booking: object): boolean {
    return CONTENT_FIELDS.every((field) => {
        const value: unknown = (booking as Record<string, unknown>)[field];
        return value === undefined || value === null || typeof value === "string";
    });
}

/** `booking` with each booker-written field that isn't text left out, the name falling back to the booker's address (the server's own
 * placeholder for it). */
function textContentOnly(booking: PublicBooking): PublicBooking {
    if (hasTextContent(booking)) {
        return booking;
    }
    const kept: Record<string, unknown> = { ...booking };
    for (const field of CONTENT_FIELDS) {
        const value: unknown = kept[field];
        if (value !== undefined && value !== null && typeof value !== "string") {
            if (field === "bookerName") {
                kept.bookerName = booking.bookerEmail;
            } else {
                delete kept[field];
            }
        }
    }
    return kept as unknown as PublicBooking;
}

/** How long after its slot ends a booking's key is kept. */
export const BOOKING_KEY_GRACE_MS = 60 * 60_000;

/** What `bookSlot()` sends to book protected. */
export interface BookingProtectionInput {
    meetingKey: { certificate: string };
    keyExpiresAt: string;
    keyWraps: { mailboxUid: string; recipientFingerprint: string; kind: "meeting-key"; cms: string }[];
    sealedFields: Record<string, string>;
    guestSealedFields: Record<string, string>;
    meetingTitle?: string;
    linkKey: string;
}

async function seal(value: unknown, certificates: Uint8Array[]): Promise<string> {
    return toBase64(await encryptForRecipients(new TextEncoder().encode(JSON.stringify(value)), certificates));
}

/**
 * What protects a booking of mailbox `mailboxUid`, whose host's zero-access certificate is `hostCertificate` (base64 DER, with
 * `hostFingerprint`), of `content`, ending at `slotEnd`. `meetingTitle`, for a video booking, is the meeting's title, sealed so both the
 * booker and the host can read it.
 */
export async function protectBooking(
    mailboxUid: string,
    hostCertificate: string,
    hostFingerprint: string,
    content: BookingContent,
    slotEnd: Date,
    meetingTitle?: string,
): Promise<BookingProtectionInput> {
    const host = fromBase64(hostCertificate);
    const key = await generateMeetingKey(new Date(slotEnd.valueOf() + BOOKING_KEY_GRACE_MS));
    const sealedFields: Record<string, string> = {};
    const guestSealedFields: Record<string, string> = {};
    for (const field of CONTENT_FIELDS) {
        const value = content[field];
        if (value) {
            sealedFields[field] = await seal(value, [host]);
            guestSealedFields[field] = await seal(value, [key.certificateDer]);
        }
    }
    return {
        meetingKey: { certificate: toBase64(key.certificateDer) },
        keyExpiresAt: new Date(slotEnd.valueOf() + BOOKING_KEY_GRACE_MS).toISOString(),
        keyWraps: [{ mailboxUid, recipientFingerprint: hostFingerprint, kind: "meeting-key", cms: toBase64(await encryptForRecipients(key.pkcs8, [host])) }],
        sealedFields,
        guestSealedFields,
        ...(meetingTitle ? { meetingTitle: await seal(meetingTitle, [key.certificateDer, host]) } : {}),
        linkKey: meetingKeyFragment(key.pkcs8),
    };
}

/** The booking key in a manage link's `#` part, removing that part from the address bar - `undefined` when it carries none. */
export function takeBookingKey(
    location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
    history: Pick<History, "replaceState"> = window.history,
): { pkcs8: Uint8Array; linkKey: string } | undefined {
    const pkcs8 = readMeetingKeyFragment(location.hash);
    if (location.hash) {
        history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    return pkcs8 ? { pkcs8, linkKey: meetingKeyFragment(pkcs8) } : undefined;
}

/** What the booker wrote, opened from `booking`'s booker copy with `pkcs8` (their link's key) - `undefined` when it won't open. */
export async function openBookerCopy(booking: PublicBooking, pkcs8: Uint8Array): Promise<BookingContent | undefined> {
    if (!booking.meetingKeyCertificate || !booking.guestSealedFields) {
        return undefined;
    }
    try {
        const { decryptionKey } = await importMeetingKey(pkcs8, fromBase64(booking.meetingKeyCertificate), booking.uid);
        const content: BookingContent = {};
        for (const [field, sealed] of Object.entries(booking.guestSealedFields)) {
            if ((CONTENT_FIELDS as readonly string[]).includes(field)) {
                const value: unknown = JSON.parse(new TextDecoder().decode(await decryptEnvelopedDataWithKeys(fromBase64(sealed), [decryptionKey])));
                // Only text: whatever was sealed is what opens (`hasTextContent()`).
                if (typeof value === "string") {
                    content[field as keyof BookingContent] = value;
                }
            }
        }
        return content;
    } catch {
        return undefined;
    }
}

/** `booking` (as the host lists it) with the host's copy opened, while the host's mailbox is unlocked - else as it is. Unchecked. */
async function openHostRecord(booking: PublicBooking): Promise<PublicBooking> {
    return booking.protected && booking.sealedFields ? await openSealedRecord(booking as PublicBooking & { mailboxUid: string }) : booking;
}

/** `booking` (as the host lists it) with the host's copy opened, while the host's mailbox is unlocked - else as it is. A field that
 * opens to anything but text is left out (`textContentOnly()`). */
export async function openHostCopy(booking: PublicBooking): Promise<PublicBooking> {
    return textContentOnly(await openHostRecord(booking));
}

/** `booking` (a protected one, as the host lists it) with every field of the host's copy opened right now, or `undefined` when they
 * don't all open (the host's mailbox is locked, or it isn't its key) or one opens to anything but text. For a change whose mail and
 * event are composed from what the booker wrote: a copy listed while the mailbox was locked still holds the server's placeholders (the
 * booker's address as their name, nothing else), which must never be sent as what they wrote. */
export async function openedHostCopy(booking: PublicBooking): Promise<PublicBooking | undefined> {
    const opened = await openHostRecord(booking);
    return isOpenedRecord(opened) && hasTextContent(opened) ? opened : undefined;
}

/** `booking`'s link key, opened from the host's wrap while the host's mailbox is unlocked - for the mail a host change sends the booker. */
export async function hostLinkKey(booking: PublicBooking): Promise<string | undefined> {
    const keys = getUnlockedKeys(booking.mailboxUid)?.zeroAccessKeys;
    const wrap = booking.keyWraps?.find((candidate) => keys?.some((key) => key.fingerprint === candidate.recipientFingerprint));
    if (!keys?.length || !wrap) {
        return undefined;
    }
    try {
        return meetingKeyFragment(await decryptEnvelopedDataWithKeys(fromBase64(wrap.cms), keys));
    } catch {
        return undefined;
    }
}

/** `booking`'s booker-written fields, for a request that needs the plaintext for its mail. Text only. */
export function bookingContent(booking: BookingContent): BookingContent {
    const content: BookingContent = {};
    for (const field of CONTENT_FIELDS) {
        const value: unknown = booking[field];
        if (value && typeof value === "string") {
            content[field] = value;
        }
    }
    return content;
}
