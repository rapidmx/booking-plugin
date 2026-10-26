///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * A protected booking (meet-plugin `specs/meeting_privacy.md` §6.2): when zero-access encryption covers the host's calendar, the booking
 * page makes a temporary booking key and seals what the booker writes - name, notes, phone, location instructions - twice: to the host's
 * zero-access certificate (kept) and to the booking key (the booker's copy, discarded once the booking is over). The booker's manage link
 * and video link carry the key after `#`. The server sees the plaintext only inside the request that carries it, to compose the mail it
 * sends, and stores only the sealed copies.
 */
import { ApiError } from "@rapidrest/core";
import { ApiErrors } from "@rapidrest/service-core";

/** The booker-written fields a protected booking stores only sealed. */
export const PROTECTED_BOOKING_FIELDS = ["bookerName", "bookerNotes", "bookerPhone", "bookerLocationInstructions"] as const;
export type ProtectedBookingField = (typeof PROTECTED_BOOKING_FIELDS)[number];

/** What a protected booking's link carries after `#` (`k=` and the base64url booking key). */
const LINK_KEY = /^k=[A-Za-z0-9_-]{16,1024}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const MAX_SEALED_LENGTH = 64 * 1024;
const MAX_CERTIFICATE_LENGTH = 8 * 1024;
/** A P-256 ECDSA signature, raw `r || s` (64 bytes), base64. */
const KEY_BINDING = /^[A-Za-z0-9+/]{86}==$/;
/** How long after its slot ends a booking's key may be kept at most. */
const MAX_KEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** The longest plaintext field a request may carry for the mail it sends (`bookingContentOf()`). */
const MAX_CONTENT_LENGTH = 4000;

/** A book request's `protection`. */
export interface BookingProtectionBody {
    meetingKey?: { certificate?: unknown };
    keyExpiresAt?: unknown;
    keyWraps?: unknown;
    /** Sealed to the host's zero-access certificate. */
    sealedFields?: Record<string, unknown>;
    /** Sealed to the booking key: the booker's own copy. */
    guestSealedFields?: Record<string, unknown>;
    /** The video meeting's title, sealed to the booking key and the host's certificate - for a booking that mints one. */
    meetingTitle?: unknown;
    /** The `#` part of the booker's links, for the mail this request sends. Never stored. */
    linkKey?: unknown;
    /** The booking key's signature of the booking's host mailbox and booker address (`apps/shared/bookingProtection.ts`
     * `keyBindingData()`), so the host's client sends the booking's key and what the booker wrote only to the address that made it. */
    keyBinding?: unknown;
}

/** One sealed copy of the booking key, for the host. */
export interface BookingKeyWrap {
    mailboxUid: string;
    recipientFingerprint: string;
    kind: "meeting-key";
    cms: string;
}

/** `protection`, validated. */
export interface BookingProtection {
    certificate: string;
    keyExpiresAt: Date;
    keyWraps: BookingKeyWrap[];
    sealedFields: Record<string, string>;
    guestSealedFields: Record<string, string>;
    meetingTitle?: string;
    linkKey: string;
    keyBinding: string;
}

/** What a manage or host request carries in plaintext about a protected booking, for the mail it sends (never stored). */
export type BookingContent = Partial<Record<ProtectedBookingField, string>>;

function invalid(message: string): ApiError {
    return new ApiError(ApiErrors.INVALID_REQUEST, 400, message);
}

function isSealed(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_SEALED_LENGTH && BASE64.test(value);
}

/** `value` as the sealed booker fields: only protected field names, each sealed, `bookerName` among them (400 otherwise). */
function sealedFieldsOf(value: unknown, name: string): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid(`'protection.${name}' must be the sealed booker fields.`);
    }
    const fields: Record<string, string> = {};
    for (const [field, sealed] of Object.entries(value)) {
        if (!(PROTECTED_BOOKING_FIELDS as readonly string[]).includes(field) || !isSealed(sealed)) {
            throw invalid(`'protection.${name}.${field}' isn't a sealed booker field.`);
        }
        fields[field] = sealed;
    }
    if (!fields.bookerName) {
        throw invalid(`'protection.${name}.bookerName' is required.`);
    }
    return fields;
}

/** Whether `value` is a booking's link key. */
export function isLinkKey(value: unknown): value is string {
    return typeof value === "string" && LINK_KEY.test(value);
}

/**
 * `body` validated for a booking of mailbox `mailboxUid` whose host's zero-access key is `hostFingerprint`, for a slot ending at
 * `slotEnd` (400 otherwise): the booking key's certificate; an expiry after now and at most a week after the slot; one to four wraps,
 * all the host's, to that key; both sealed copies; the link key; and the key's signature binding it to the booker (checked by the host's
 * client, which holds the key).
 */
export function validateBookingProtection(body: BookingProtectionBody, mailboxUid: string, hostFingerprint: string, slotEnd: Date, now: number): BookingProtection {
    if (!body || typeof body !== "object") {
        throw invalid("'protection' must be an object.");
    }
    const certificate: unknown = body.meetingKey?.certificate;
    if (typeof certificate !== "string" || certificate.length > MAX_CERTIFICATE_LENGTH || !BASE64.test(certificate)) {
        throw invalid("'protection.meetingKey.certificate' must be a base64 DER certificate.");
    }
    const expires: Date = new Date(typeof body.keyExpiresAt === "string" ? body.keyExpiresAt : NaN);
    if (isNaN(expires.valueOf()) || expires.valueOf() <= now || expires.valueOf() > slotEnd.valueOf() + MAX_KEY_GRACE_MS) {
        throw invalid("'protection.keyExpiresAt' must be in the future, at most a week after the booking ends.");
    }
    const wraps: unknown = body.keyWraps;
    if (!Array.isArray(wraps) || wraps.length === 0 || wraps.length > 4) {
        throw invalid("'protection.keyWraps' must list 1 to 4 wraps.");
    }
    const keyWraps: BookingKeyWrap[] = wraps.map((wrap: any) => {
        if (
            wrap?.mailboxUid !== mailboxUid ||
            typeof wrap.recipientFingerprint !== "string" ||
            !FINGERPRINT.test(wrap.recipientFingerprint) ||
            wrap.recipientFingerprint !== hostFingerprint ||
            wrap.kind !== "meeting-key" ||
            !isSealed(wrap.cms)
        ) {
            throw invalid("Each wrap is the host's: its 'mailboxUid', its zero-access key's 'recipientFingerprint', 'kind' \"meeting-key\" and a sealed 'cms'.");
        }
        return { mailboxUid, recipientFingerprint: hostFingerprint, kind: "meeting-key", cms: wrap.cms };
    });
    if (body.meetingTitle !== undefined && !isSealed(body.meetingTitle)) {
        throw invalid("'protection.meetingTitle' must be the sealed meeting title.");
    }
    if (!isLinkKey(body.linkKey)) {
        throw invalid("'protection.linkKey' must be the booking's link key.");
    }
    if (typeof body.keyBinding !== "string" || !KEY_BINDING.test(body.keyBinding)) {
        throw invalid("'protection.keyBinding' must be the booking key's signature of the booking.");
    }
    return {
        certificate,
        keyExpiresAt: expires,
        keyWraps,
        sealedFields: sealedFieldsOf(body.sealedFields, "sealedFields"),
        guestSealedFields: sealedFieldsOf(body.guestSealedFields, "guestSealedFields"),
        meetingTitle: body.meetingTitle,
        linkKey: body.linkKey,
        keyBinding: body.keyBinding,
    };
}

/** `value` (a request's `content`) as booker fields for the mail it sends: the protected field names with bounded strings only. */
export function bookingContentOf(value: unknown): BookingContent | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const content: BookingContent = {};
    for (const field of PROTECTED_BOOKING_FIELDS) {
        const given: unknown = (value as Record<string, unknown>)[field];
        if (typeof given === "string" && given.trim() && given.length <= MAX_CONTENT_LENGTH) {
            content[field] = given;
        }
    }
    return content.bookerName ? content : undefined;
}

/** `url` with a protected booking's `linkKey` after `#`, when given. */
export function withLinkKey(url: string, linkKey: string | undefined): string {
    return linkKey ? `${url}#${linkKey}` : url;
}
