///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Protected bookings (meet-plugin `specs/meeting_privacy.md` §6.2), identical on both backends - run by
// `test/routes/{mongo,sql}/BookingRoute.test.ts`.
import { request } from "@rapidrest/service-core/test";
import { simpleParser } from "mailparser";
import { bookingProtection, LINK_KEY, sealed } from "../bookingProtectionFixture.js";

export interface BookingProtectionSuiteContext {
    app: () => any;
    baseUrl: string;
    ownerToken: () => string;
    mailboxUid: () => string;
    /** Gives the host mailbox a zero-access key covering `types` (default: calendar only). Returns its key. */
    protectHost: (types?: Record<string, boolean>) => Promise<{ publicKey: string; fingerprint: string }>;
    createBookingType: (data?: any) => Promise<any>;
    validBooking: (start?: string) => any;
    findBookings: () => Promise<any[]>;
    findEvents: () => Promise<any[]>;
    findMessages: () => Promise<any[]>;
    blobText: (key: string) => Promise<string>;
    sentMail: () => { raw: Buffer; envelopeTo: string[] }[];
    clearSentMail: () => void;
    setKeyExpiresAt: (uid: string, at: Date) => Promise<void>;
    runExpiry: () => Promise<void>;
}

export function bookingProtectionSuite(ctx: BookingProtectionSuiteContext): void {
    const book = (slug: string, body: any) => request(ctx.app()).post(`${ctx.baseUrl}/types/${ctx.mailboxUid()}/${slug}`).send(body);
    const host = () => ({
        get: (url: string) => request(ctx.app()).get(url).set("Authorization", "jwt " + ctx.ownerToken()),
        post: (url: string) => request(ctx.app()).post(url).set("Authorization", "jwt " + ctx.ownerToken()),
    });
    const bookProtected = async (fingerprint: string, overrides: any = {}) => {
        const bookingType = await ctx.createBookingType();
        const result = await book(bookingType.slug, { ...ctx.validBooking(), protection: bookingProtection(ctx.mailboxUid(), fingerprint), ...overrides });
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        return { bookingType, result };
    };

    /** A mail's text body and calendar part, decoded. */
    const decoded = async (raw: Buffer | string): Promise<string> => {
        const mail = await simpleParser(raw);
        return [mail.text ?? "", ...mail.attachments.map((a) => a.content.toString())].join(" ");
    };

    describe("protected bookings", () => {
        it("Gives the booking page the host's zero-access certificate only while zero-access covers the host's calendar", async () => {
            const plain = await ctx.createBookingType();
            const before = await request(ctx.app()).get(`${ctx.baseUrl}/types/${ctx.mailboxUid()}/${plain.slug}`);
            expect(before.body.hostCertificate).toBeUndefined();
            const key = await ctx.protectHost();
            const after = await request(ctx.app()).get(`${ctx.baseUrl}/types/${ctx.mailboxUid()}/${plain.slug}`);
            expect(after.body).toMatchObject({ hostCertificate: key.publicKey, hostCertificateFingerprint: key.fingerprint });
        });

        it("Stores what the booker wrote only sealed, names them by address on the event, and mails the manage link with its key", async () => {
            const key = await ctx.protectHost();
            const { result } = await bookProtected(key.fingerprint);

            const [booking] = await ctx.findBookings();
            expect(booking).toMatchObject({
                bookerName: "grace@example.com",
                keyProtected: true,
                sealedFields: { bookerName: sealed("host:Grace Hopper"), bookerNotes: sealed("host:notes") },
                guestSealedFields: { bookerName: sealed("guest:Grace Hopper"), bookerNotes: sealed("guest:notes") },
                keyWraps: [expect.objectContaining({ recipientFingerprint: key.fingerprint })],
            });
            expect(booking.bookerNotes ?? null).toBeNull();
            expect(JSON.stringify(booking)).not.toContain("Looking forward to it.");
            expect(JSON.stringify(booking)).not.toContain(LINK_KEY);
            const [event] = await ctx.findEvents();
            expect(event.title).toBe("Protected event");
            expect(event.attendees[0].displayName ?? null).toBeNull();
            expect(JSON.stringify(event)).not.toContain("Grace Hopper");

            const raw = await decoded(ctx.sentMail()[0].raw);
            expect(raw).toContain(`/manage/${result.body.manageToken}#${LINK_KEY}`);
            expect(raw).toContain("SUMMARY:Intro Call with Grace Hopper");
            expect(result.body).toMatchObject({ protected: true, bookerName: "grace@example.com", guestSealedFields: booking.guestSealedFields });
            expect(result.body.sealedFields).toBeUndefined();
        });

        it("Leaves what the booker wrote out of a host notification that isn't filed sealed, and says where to read it", async () => {
            const key = await ctx.protectHost({ mail: false, calendar: true });
            await bookProtected(key.fingerprint);
            const [message] = await ctx.findMessages();
            expect(message.subject).toBe("New booking: Intro Call with grace@example.com");
            const raw = await decoded(await ctx.blobText(message.bodyBlobKey));
            expect(raw).toContain("end-to-end encrypted");
            expect(raw).not.toContain("Looking forward to it.");
            expect(raw).not.toContain("Grace Hopper");
        });

        it.each([
            ["no protection", (_fp: string) => ({ protection: undefined })],
            ["a wrap to another key", (_fp: string) => ({ protection: bookingProtection("x", "cd".repeat(32)) })],
            ["a key expiring after the week the booking allows", (fp: string) => ({ protection: { ...bookingProtection("", fp), keyExpiresAt: "2099-07-01T00:00:00.000Z" } })],
            ["no link key", (fp: string) => ({ protection: { ...bookingProtection("", fp), linkKey: "nope" } })],
            ["an unsealed booker field", (fp: string) => ({ protection: { ...bookingProtection("", fp), guestSealedFields: { bookerName: "Grace Hopper!" } } })],
            ["an unknown sealed field", (fp: string) => ({ protection: { ...bookingProtection("", fp), sealedFields: { bookerName: sealed("x"), bookerEmail: sealed("x") } } })],
            ["no sealed name", (fp: string) => ({ protection: { ...bookingProtection("", fp), sealedFields: { bookerNotes: sealed("x") } } })],
            ["no certificate", (fp: string) => ({ protection: { ...bookingProtection("", fp), meetingKey: {} } })],
            ["no wraps", (fp: string) => ({ protection: { ...bookingProtection("", fp), keyWraps: [] } })],
            ["a meeting title that isn't sealed", (fp: string) => ({ protection: { ...bookingProtection("", fp), meetingTitle: 7 } })],
            ["a protection that isn't an object", (_fp: string) => ({ protection: "yes" })],
            ["sealed fields that aren't an object", (fp: string) => ({ protection: { ...bookingProtection("", fp), guestSealedFields: [sealed("x")] } })],
        ])("Refuses a booking of a protected host with %s (400)", async (_name, overrides) => {
            const key = await ctx.protectHost();
            const bookingType = await ctx.createBookingType();
            const body: any = { ...ctx.validBooking(), ...overrides(key.fingerprint) };
            if (body.protection && typeof body.protection === "object" && body.protection.keyWraps?.[0]?.mailboxUid === "") {
                body.protection.keyWraps[0].mailboxUid = ctx.mailboxUid();
            }
            const result = await book(bookingType.slug, body);
            expect(result.status, JSON.stringify(result.body)).toBe(400);
        });

        it("Refuses a protected booking of a host zero-access doesn't cover, and one whose video meeting has no sealed title", async () => {
            const bookingType = await ctx.createBookingType();
            const unprotected = await book(bookingType.slug, { ...ctx.validBooking(), protection: bookingProtection(ctx.mailboxUid(), "ab".repeat(32)) });
            expect(unprotected.status).toBe(400);
            expect(unprotected.body.message).toBe("This host doesn't take protected bookings.");

            const key = await ctx.protectHost();
            const video = await ctx.createBookingType({
                meetingTypes: [{ uid: "mt-v", name: "Video chat", durationMinutes: 60, locationOptions: [{ uid: "lo-v", type: "video" }] }],
            });
            const untitled = await book(video.slug, {
                ...ctx.validBooking(),
                meetingTypeUid: "mt-v",
                locationOptionUid: "lo-v",
                protection: bookingProtection(ctx.mailboxUid(), key.fingerprint, undefined, { meetingTitle: undefined }),
            });
            expect(untitled.status, JSON.stringify(untitled.body)).toBe(400);
        });

        it("Gives the booker their own sealed copy by the manage token, and the host theirs and the key's wrap", async () => {
            const key = await ctx.protectHost();
            const { bookingType, result } = await bookProtected(key.fingerprint);
            const booker = await request(ctx.app()).get(`${ctx.baseUrl}/manage/${result.body.manageToken}`);
            expect(booker.body).toMatchObject({ protected: true, guestSealedFields: { bookerName: sealed("guest:Grace Hopper") } });
            expect(booker.body.meetingKeyCertificate).toEqual(expect.any(String));
            expect(booker.body.sealedFields).toBeUndefined();
            expect(booker.body.keyWraps).toBeUndefined();
            const listed = await host().get(`${ctx.baseUrl}/host?bookingTypeUid=${bookingType.uid}`);
            expect(listed.body[0]).toMatchObject({ protected: true, sealedFields: { bookerName: sealed("host:Grace Hopper") }, keyWraps: [expect.anything()] });
            expect(listed.body[0].guestSealedFields).toBeUndefined();
        });

        it("Mails a reschedule from the plaintext and key the manage page sends, never storing either", async () => {
            const key = await ctx.protectHost();
            const { result } = await bookProtected(key.fingerprint);
            ctx.clearSentMail();
            const moved = await request(ctx.app())
                .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/reschedule`)
                .send({ start: "2099-06-01T14:00:00.000Z", content: { bookerName: "Grace Hopper", bookerNotes: "Moved, thanks." }, linkKey: LINK_KEY });
            expect(moved.status, JSON.stringify(moved.body)).toBe(200);
            const raw = await decoded(ctx.sentMail()[0].raw);
            expect(raw).toContain("SUMMARY:Intro Call with Grace Hopper");
            expect(raw).toContain(`#${LINK_KEY}`);
            const [booking] = await ctx.findBookings();
            expect(JSON.stringify(booking)).not.toContain("Moved, thanks.");

            const cancelled = await request(ctx.app())
                .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/cancel`)
                .send({ content: { bookerName: "Grace Hopper" } });
            expect(cancelled.status).toBe(200);
        });

        it("Rebuilds the event and mail of a host's new video link from the plaintext the host's client sends", async () => {
            const key = await ctx.protectHost();
            const { result } = await bookProtected(key.fingerprint);
            const [booking] = await ctx.findBookings();
            ctx.clearSentMail();
            const set = await host()
                .post(`${ctx.baseUrl}/host/${booking.uid}/location`)
                .send({ locationVideoUrl: "https://video.example/new", content: { bookerName: "Grace Hopper", bookerNotes: "Host view" }, linkKey: LINK_KEY });
            expect(set.status, JSON.stringify(set.body)).toBe(200);
            const raw = await decoded(ctx.sentMail()[0].raw);
            expect(raw).toContain("https://video.example/new");
            expect(raw).toContain(`/manage/${result.body.manageToken}#${LINK_KEY}`);
            expect(raw).not.toContain(`https://video.example/new#`);
            const [updated] = await ctx.findBookings();
            expect(updated.videoLinkKeyed ?? null).toBeNull();
            expect(JSON.stringify(await ctx.findEvents())).not.toContain("Host view");
        });

        it("Discards the booker's copy and the key at expiry, keeping the host's copy", async () => {
            const key = await ctx.protectHost();
            await bookProtected(key.fingerprint);
            const [booking] = await ctx.findBookings();
            await ctx.runExpiry();
            expect((await ctx.findBookings())[0].guestSealedFields).toBeTruthy();

            await ctx.setKeyExpiresAt(booking.uid, new Date(Date.now() - 1000));
            await ctx.runExpiry();
            const [discarded] = await ctx.findBookings();
            expect(discarded.guestSealedFields ?? null).toBeNull();
            expect(discarded.meetingKeyCertificate ?? null).toBeNull();
            expect(discarded.keyWraps ?? null).toBeNull();
            expect(discarded.keyDiscardedAt).toBeTruthy();
            expect(discarded.sealedFields).toEqual(booking.sealedFields);
        });
    });
}
