///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * A protected booking on the client (meet-plugin `specs/meeting_privacy.md` §6.2). When the host's calendar is covered by zero-access
 * encryption the booking page makes a temporary booking key and seals what the booker writes twice: to the host's zero-access certificate
 * (the host's copy) and to the booking key (the booker's copy, opened with the key their manage link carries after `#k=`). The booking key
 * itself is wrapped to the host, so the host's client can send the booker their links again. The server never holds the key.
 *
 * Anyone can seal to the host's certificate, so the host's client never sends the booker what opened with its zero-access key without
 * proof that it is this booking's: the unwrapped key must be the certificate's, it must have signed the booker's address (`keyBinding`),
 * and the host copy must match the booker's copy that key opens (`hostChange()`). Otherwise a booker could put any ciphertext sealed to
 * the host - a sealed event's description, another meeting's key wrap, another booking's copies - in their booking, and have the host's
 * client mail them its plaintext.
 */
import { fromBase64, toBase64 } from "@rapidmx/web-client/lib/crypto/encoding.js";
import { getUnlockedKeys } from "@rapidmx/web-client/lib/crypto/keySession.js";
import { certificateHoldsKey } from "@rapidmx/web-client/lib/crypto/keyPairMatch.js";
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
    keyBinding: string;
}

const ECDSA_P256: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const ECDSA_SHA256: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/** What a booking key signs (`keyBinding`): the booker's address, as the server stores it. */
function keyBindingData(bookerEmail: string): Uint8Array {
    return new TextEncoder().encode(`rapidmx-booking-key-v1
${bookerEmail.trim().toLowerCase()}`);
}

/** The booking key `pkcs8`'s signature binding it to `bookerEmail` (base64 raw `r || s`). */
async function signKeyBinding(pkcs8: Uint8Array, bookerEmail: string): Promise<string> {
    const key = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, ECDSA_P256, false, ["sign"]);
    return toBase64(new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, key, keyBindingData(bookerEmail) as BufferSource)));
}

/** Whether `signature` is the booking key `pkcs8`'s binding of it to `bookerEmail`. Never rejects. */
async function verifyKeyBinding(pkcs8: Uint8Array, bookerEmail: string, signature: string): Promise<boolean> {
    try {
        const { x, y } = await crypto.subtle.exportKey("jwk", await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, ECDSA_P256, true, ["sign"]));
        const publicKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y }, ECDSA_P256, false, ["verify"]);
        return await crypto.subtle.verify(ECDSA_SHA256, publicKey, fromBase64(signature) as BufferSource, keyBindingData(bookerEmail) as BufferSource);
    } catch {
        return false;
    }
}

async function seal(value: unknown, certificates: Uint8Array[]): Promise<string> {
    return toBase64(await encryptForRecipients(new TextEncoder().encode(JSON.stringify(value)), certificates));
}

/**
 * What protects a booking of mailbox `mailboxUid`, whose host's zero-access certificate is `hostCertificate` (base64 DER, with
 * `hostFingerprint`), of `content` by `bookerEmail`, ending at `slotEnd`. `meetingTitle`, for a video booking, is the meeting's title,
 * sealed so both the booker and the host can read it.
 */
export async function protectBooking(
    mailboxUid: string,
    hostCertificate: string,
    hostFingerprint: string,
    content: BookingContent,
    bookerEmail: string,
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
        keyBinding: await signKeyBinding(key.pkcs8, bookerEmail),
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
    return booking.protected && booking.sealedFields ? await openSealedRecord(booking) : booking;
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

/** `booking`'s key, unwrapped from the host's wrap while the host's mailbox is unlocked - only when it is the key of the booking's
 * certificate and has signed the booking's booker address (`keyBinding`), else `undefined`. What a wrap opens to is whatever was sealed
 * to the host: unchecked, it could be another meeting's key, or any plaintext the host's key opens. */
async function hostBookingKey(booking: PublicBooking): Promise<Uint8Array | undefined> {
    const keys = getUnlockedKeys(booking.mailboxUid)?.zeroAccessKeys;
    const wrap = booking.keyWraps?.find((candidate) => keys?.some((key) => key.fingerprint === candidate.recipientFingerprint));
    if (!keys?.length || !wrap || !booking.meetingKeyCertificate || !booking.keyBinding) {
        return undefined;
    }
    try {
        const pkcs8 = await decryptEnvelopedDataWithKeys(fromBase64(wrap.cms), keys);
        const isBookingKey =
            (await certificateHoldsKey(fromBase64(booking.meetingKeyCertificate), pkcs8)) &&
            (await verifyKeyBinding(pkcs8, booking.bookerEmail, booking.keyBinding));
        return isBookingKey ? pkcs8 : undefined;
    } catch {
        return undefined;
    }
}

/**
 * What a host change of protected `booking` (as the host lists it) sends for the mail to the booker: what the booker wrote and their link
 * key - or `undefined` while the host's mailbox is locked, or when any of it isn't provably this booking's. The host copy is opened again
 * now (`openedHostCopy()`), the key is unwrapped and checked (`hostBookingKey()`), and the booker's copy opened with it must hold the same
 * fields, the name among them. A booker can seal anything to the host's certificate but can't make a booker copy matching a ciphertext
 * whose plaintext they don't know, nor sign their own address with a key they never had.
 */
export async function hostChange(booking: PublicBooking): Promise<{ content: BookingContent; linkKey: string } | undefined> {
    const opened = await openedHostCopy(booking);
    const pkcs8 = opened && (await hostBookingKey(booking));
    const bookerCopy = pkcs8 && (await openBookerCopy(booking, pkcs8));
    if (!opened || !pkcs8 || !bookerCopy) {
        return undefined;
    }
    const content = bookingContent(opened);
    const confirmed = bookingContent(bookerCopy);
    const agrees = CONTENT_FIELDS.every((field) => content[field] === confirmed[field]);
    return agrees && content.bookerName ? { content, linkKey: meetingKeyFragment(pkcs8) } : undefined;
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
