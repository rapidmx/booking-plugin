// @vitest-environment node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromBase64, toBase64 } from "@rapidmx/web-client/lib/crypto/encoding.js";
import { generateMeetingKey, importMeetingKey } from "@rapidmx/web-client/lib/crypto/meetingKeys.js";
import { decryptEnvelopedDataWithKeys } from "@rapidmx/web-client/lib/crypto/smime.js";

const { getUnlockedKeys } = vi.hoisted(() => ({ getUnlockedKeys: vi.fn() }));
vi.mock("@rapidmx/web-client/lib/crypto/keySession.js", () => ({ getUnlockedKeys, subscribeKeySession: () => () => undefined }));

const { bookingContent, hostLinkKey, openBookerCopy, openHostCopy, protectBooking, takeBookingKey, BOOKING_KEY_GRACE_MS } = await import(
    "../../../apps/shared/bookingProtection.js"
);

/** A stand-in for the host's zero-access key: P-256 with a certificate. */
async function hostKey() {
    const key = await generateMeetingKey(new Date(Date.now() + 86_400_000));
    const { decryptionKey } = await importMeetingKey(key.pkcs8, key.certificateDer, "unused");
    return { certificate: toBase64(key.certificateDer), fingerprint: key.fingerprint, unlocked: { ...decryptionKey, fingerprint: key.fingerprint } };
}

const open = async (sealed: string, keys: any[]) => JSON.parse(new TextDecoder().decode(await decryptEnvelopedDataWithKeys(fromBase64(sealed), keys)));
const END = new Date("2099-06-01T14:00:00.000Z");

afterEach(() => {
    vi.clearAllMocks();
});

describe("bookingProtection", () => {
    it("seals what the booker writes for the host and for the booker, wraps the key to the host, and seals a meeting's title for both", async () => {
        const host = await hostKey();
        const protection = await protectBooking("mb", host.certificate, host.fingerprint, { bookerName: "Grace", bookerNotes: "Hi", bookerPhone: "" }, END, "Intro with Grace");

        expect(protection.keyExpiresAt).toBe(new Date(END.valueOf() + BOOKING_KEY_GRACE_MS).toISOString());
        expect(Object.keys(protection.sealedFields).sort()).toEqual(["bookerName", "bookerNotes"]);
        expect(await open(protection.sealedFields.bookerName, [host.unlocked])).toBe("Grace");
        expect(protection.keyWraps[0]).toMatchObject({ mailboxUid: "mb", recipientFingerprint: host.fingerprint, kind: "meeting-key" });

        // The booker opens their copy with the key their link carries.
        const booking: any = { uid: "b1", mailboxUid: "mb", protected: true, guestSealedFields: protection.guestSealedFields, meetingKeyCertificate: protection.meetingKey.certificate };
        const pkcs8 = takeBookingKey({ hash: `#${protection.linkKey}`, pathname: "/book/manage/t", search: "" }, { replaceState: vi.fn() })!.pkcs8;
        expect(await openBookerCopy(booking, pkcs8)).toEqual({ bookerName: "Grace", bookerNotes: "Hi" });
        const { decryptionKey } = await importMeetingKey(pkcs8, fromBase64(protection.meetingKey.certificate), "b1");
        expect(await open(protection.meetingTitle!, [decryptionKey])).toBe("Intro with Grace");
        expect(await open(protection.meetingTitle!, [host.unlocked])).toBe("Intro with Grace");
        expect((await protectBooking("mb", host.certificate, host.fingerprint, { bookerName: "G" }, END)).meetingTitle).toBeUndefined();
    });

    it("takes the key from the manage link once, and opens nothing without the booking's own key", async () => {
        const history = { replaceState: vi.fn() };
        expect(takeBookingKey({ hash: "", pathname: "/m", search: "" }, history)).toBeUndefined();
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(takeBookingKey({ hash: "#k=short", pathname: "/m", search: "?x" }, history)).toBeUndefined();
        expect(history.replaceState).toHaveBeenCalledWith(null, "", "/m?x");

        const host = await hostKey();
        const protection = await protectBooking("mb", host.certificate, host.fingerprint, { bookerName: "Grace" }, END);
        const booking: any = { uid: "b1", guestSealedFields: protection.guestSealedFields, meetingKeyCertificate: protection.meetingKey.certificate };
        const other = await generateMeetingKey(new Date(Date.now() + 60_000));
        expect(await openBookerCopy(booking, other.pkcs8)).toBeUndefined();
        expect(await openBookerCopy({ ...booking, meetingKeyCertificate: undefined }, other.pkcs8)).toBeUndefined();
    });

    it("opens the host's copy and the booker's link key with the host's unlocked zero-access key", async () => {
        const host = await hostKey();
        const protection = await protectBooking("mb", host.certificate, host.fingerprint, { bookerName: "Grace", bookerNotes: "Hi" }, END);
        const listed: any = { uid: "b1", mailboxUid: "mb", protected: true, bookerName: "grace@example.com", sealedFields: protection.sealedFields, keyWraps: protection.keyWraps };

        getUnlockedKeys.mockReturnValue({ zeroAccessKeys: [host.unlocked] });
        expect(await openHostCopy(listed)).toMatchObject({ bookerName: "Grace", bookerNotes: "Hi" });
        expect(await hostLinkKey(listed)).toBe(protection.linkKey);
        expect(await openHostCopy({ ...listed, protected: undefined })).toEqual({ ...listed, protected: undefined });

        getUnlockedKeys.mockReturnValue(undefined);
        expect(await hostLinkKey(listed)).toBeUndefined();
        getUnlockedKeys.mockReturnValue({ zeroAccessKeys: [{ ...host.unlocked, privateKey: (await hostKey()).unlocked.privateKey }] });
        expect(await hostLinkKey(listed)).toBeUndefined();
    });

    it("picks only the booker-written fields a request sends for its mail", () => {
        expect(bookingContent({ bookerName: "Grace", bookerNotes: "", bookerPhone: "1", ...({ bookerEmail: "g@example.com" } as any) })).toEqual({ bookerName: "Grace", bookerPhone: "1" });
    });
});
