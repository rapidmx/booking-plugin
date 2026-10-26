///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Protected bookings (meet-plugin `specs/meeting_privacy.md` §6.2), identical on both backends - run by
// `test/routes/{mongo,sql}/BookingRoute.test.ts`.
import { request } from "@rapidrest/service-core/test";
import { PluginRegistry } from "@rapidmx/restapi";
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
    /** Runs `BookingKeyExpiryJob` once, looking at `batchSize` bookings at most when given. */
    runExpiry: (batchSize?: number) => Promise<void>;
    /** The booking route instance. */
    route: () => any;
    findVideoMeetings: () => Promise<any[]>;
    /** Makes `name` one of this server's (verified, enabled) domains, an alias of `aliasOf` when given. */
    addDomain: (name: string, aliasOf?: string) => Promise<void>;
    /** Adds a mailbox at `address` on this server, its mail zero-access encrypted with `zeroAccessMail`. */
    addMailbox: (address: string, options?: { aliases?: string[]; zeroAccessMail?: boolean }) => Promise<void>;
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

        it("Mails the key only to a booker whose copy leaves this server or is stored here zero-access encrypted", async () => {
            const key = await ctx.protectHost();
            await ctx.addDomain("corp.example");
            await ctx.addDomain("corp-alias.example", "corp.example");
            await ctx.addMailbox("alice@corp.example");
            await ctx.addMailbox("bob@corp.example", { zeroAccessMail: true });
            await ctx.addMailbox("carol@corp.example", { aliases: ["carol.alias@corp.example"], zeroAccessMail: true });
            await ctx.addMailbox("dave@corp.example", { aliases: ["dave.alias@corp.example"] });
            await ctx.addMailbox("frank@corp.example", { aliases: ["frankxb@corp.example", "frank_c@corp.example"], zeroAccessMail: true });
            const warn = vi.spyOn(ctx.route().logger, "warn");
            const cases: [string, boolean][] = [
                // A mailbox here whose mail is stored readable, by its address, an alias, or a plus tag.
                ["alice@corp.example", false],
                ["alice+booking@corp.example", false],
                ["dave.alias@corp.example", false],
                // Another address of a domain this server serves: a list or an unknown address can't be told.
                ["team@corp.example", false],
                ["alice@corp-alias.example", false],
                // A `_` in the address matches only itself, never another alias's character.
                ["frank_b@corp.example", false],
                // A mailbox here whose mail is zero-access, by its address, an alias, a plus tag or an alias domain.
                ["bob@corp.example", true],
                ["bob+booking@corp.example", true],
                ["carol.alias@corp.example", true],
                ["frank_c@corp.example", true],
                ["bob@corp-alias.example", true],
                // An address on another server.
                ["grace@example.com", true],
            ];
            try {
                for (const [index, [bookerEmail, keyed]] of cases.entries()) {
                    ctx.clearSentMail();
                    const bookingType = await ctx.createBookingType();
                    // A day each, as every booking lands on the same host calendar.
                    const day = `2099-06-${String(index + 1).padStart(2, "0")}`;
                    const result = await book(bookingType.slug, {
                        ...ctx.validBooking(`${day}T13:00:00.000Z`),
                        bookerEmail,
                        protection: bookingProtection(ctx.mailboxUid(), key.fingerprint, `${day}T14:00:00.000Z`),
                    });
                    expect(result.status, JSON.stringify(result.body)).toBe(200);
                    const [sent] = ctx.sentMail();
                    expect(sent.envelopeTo, bookerEmail).toEqual([bookerEmail]);
                    const raw = await decoded(sent.raw);
                    expect(raw, bookerEmail).toContain(`/manage/${result.body.manageToken}`);
                    expect(raw.includes(LINK_KEY), bookerEmail).toBe(keyed);
                }
                expect(warn).toHaveBeenCalledWith(expect.stringContaining("links without their key"));
                expect(JSON.stringify(warn.mock.calls)).not.toContain(LINK_KEY);
            } finally {
                warn.mockRestore();
            }
        });

        it("Mails a reschedule to a booker whose mail is stored readable here without the key", async () => {
            const key = await ctx.protectHost();
            await ctx.addDomain("corp.example");
            await ctx.addMailbox("alice@corp.example");
            const { result } = await bookProtected(key.fingerprint, { bookerEmail: "alice@corp.example" });
            ctx.clearSentMail();
            const moved = await request(ctx.app())
                .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/reschedule`)
                .send({ start: "2099-06-01T14:00:00.000Z", content: { bookerName: "Alice" }, linkKey: LINK_KEY });
            expect(moved.status, JSON.stringify(moved.body)).toBe(200);
            const raw = await decoded(ctx.sentMail()[0].raw);
            expect(raw).toContain(`/manage/${result.body.manageToken}`);
            expect(raw).not.toContain(LINK_KEY);
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

        it("Refuses to reschedule a protected booking without what the booker wrote, moving and mailing nothing", async () => {
            const key = await ctx.protectHost();
            const { result } = await bookProtected(key.fingerprint);
            const [before] = await ctx.findBookings();
            const eventsBefore = JSON.stringify(await ctx.findEvents());
            ctx.clearSentMail();
            for (const content of [undefined, {}, { bookerName: "" }, "Grace Hopper"]) {
                const refused = await request(ctx.app())
                    .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/reschedule`)
                    .send({ start: "2099-06-01T14:00:00.000Z", content, linkKey: LINK_KEY });
                expect(refused.status, JSON.stringify(refused.body)).toBe(400);
                expect(refused.body.message).toBe("Open your booking's link exactly as it was sent to you to reschedule it.");
            }
            const [after] = await ctx.findBookings();
            expect(new Date(after.startDate).toISOString()).toBe(new Date(before.startDate).toISOString());
            expect(new Date(after.keyExpiresAt).toISOString()).toBe(new Date(before.keyExpiresAt).toISOString());
            expect(JSON.stringify(await ctx.findEvents())).toBe(eventsBefore);
            expect(ctx.sentMail()).toEqual([]);
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

        it("Files a sealed host notification of a new booking with what the booker wrote", async () => {
            const key = await ctx.protectHost({ calendar: true, mail: true });
            const sealRaw = vi.spyOn(ctx.route().zeroAccessWriter, "sealRaw");
            try {
                await bookProtected(key.fingerprint);
                expect(sealRaw).toHaveBeenCalledTimes(1);
                const raw = await decoded((sealRaw.mock.calls[0] as any[])[1]);
                expect(raw).toContain("Grace Hopper");
                expect(raw).toContain("Looking forward to it.");
                expect(raw).not.toContain("end-to-end encrypted");
            } finally {
                sealRaw.mockRestore();
            }
        });

        it("Moves a rescheduled protected booking's key expiry to the new slot's end plus the grace hour, so expiry leaves it until then", async () => {
            const key = await ctx.protectHost();
            const { result } = await bookProtected(key.fingerprint);
            const moved = await request(ctx.app())
                .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/reschedule`)
                .send({ start: "2099-06-03T13:00:00.000Z", content: { bookerName: "Grace Hopper" }, linkKey: LINK_KEY });
            expect(moved.status, JSON.stringify(moved.body)).toBe(200);
            const [booking] = await ctx.findBookings();
            expect(new Date(booking.keyExpiresAt).toISOString()).toBe("2099-06-03T15:00:00.000Z");
            await ctx.runExpiry();
            expect((await ctx.findBookings())[0].guestSealedFields).toBeTruthy();

            // A key already discarded isn't brought back.
            await ctx.setKeyExpiresAt(booking.uid, new Date(Date.now() - 1000));
            await ctx.runExpiry();
            const again = await request(ctx.app())
                .post(`${ctx.baseUrl}/manage/${result.body.manageToken}/reschedule`)
                .send({ start: "2099-06-04T13:00:00.000Z", content: { bookerName: "Grace Hopper" } });
            expect(again.status, JSON.stringify(again.body)).toBe(200);
            expect(new Date((await ctx.findBookings())[0].keyExpiresAt).valueOf()).toBeLessThan(Date.now());
        });

        describe("with a protected video meeting minted for the booking", () => {
            const VIDEOCONF_PLUGIN_NAME = "@rapidmx/meet-plugin";
            /** A whole-day UTC slot `days` from now, at noon - near enough for the meeting key's five-year bound. */
            const slotIn = (days: number) => {
                const day = new Date();
                const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + days, 12));
                return { start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() };
            };
            const bookVideo = async (bookerEmail?: string, days: number = 2) => {
                PluginRegistry.setLoaded([{ name: VIDEOCONF_PLUGIN_NAME, version: "0.1.0" }]);
                const key = await ctx.protectHost();
                const bookingType = await ctx.createBookingType({
                    timezone: "UTC",
                    availability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })),
                    meetingTypes: [{ uid: "mt-default", name: "Intro Call", durationMinutes: 60, locationOptions: [{ uid: "lo-default", type: "video" }] }],
                });
                const slot = slotIn(days);
                const result = await book(bookingType.slug, {
                    ...ctx.validBooking(slot.start),
                    ...(bookerEmail ? { bookerEmail } : {}),
                    protection: bookingProtection(ctx.mailboxUid(), key.fingerprint, slot.end),
                });
                expect(result.status, JSON.stringify(result.body)).toBe(200);
                return { result, slot };
            };
            const reschedule = (token: string, start: string) =>
                request(ctx.app()).post(`${ctx.baseUrl}/manage/${token}/reschedule`).send({ start, content: { bookerName: "Grace Hopper" }, linkKey: LINK_KEY });
            const meetingExpiry = async () => new Date((await ctx.findVideoMeetings())[0].keyExpiresAt).toISOString();

            afterEach(() => {
                PluginRegistry.setLoaded([]);
                vi.restoreAllMocks();
            });

            it("Tells the booker the video link needs the key, on the confirmation and the manage page", async () => {
                const { result } = await bookVideo();
                expect(result.body).toMatchObject({ protected: true, videoLinkKeyed: true, locationVideoUrl: expect.stringMatching(/\/meet\/[A-Za-z0-9_-]{43}$/) });
                const managed = await request(ctx.app()).get(`${ctx.baseUrl}/manage/${result.body.manageToken}`);
                expect(managed.body.videoLinkKeyed).toBe(true);
                const [booking] = await ctx.findBookings();
                const listed = await host().get(`${ctx.baseUrl}/host?bookingTypeUid=${booking.bookingTypeUid}`);
                expect(listed.body[0].videoLinkKeyed).toBeUndefined();
            });

            it("Mails the keyed video link to a booker elsewhere, and leaves the key off it for a booker whose mail is stored readable here", async () => {
                const { result } = await bookVideo();
                const elsewhere = await decoded(ctx.sentMail()[0].raw);
                expect(elsewhere).toContain(`${result.body.locationVideoUrl}#${LINK_KEY}`);

                await ctx.addDomain("corp.example");
                await ctx.addMailbox("alice@corp.example");
                ctx.clearSentMail();
                const local = await bookVideo("alice@corp.example", 3);
                const raw = await decoded(ctx.sentMail()[0].raw);
                expect(raw).toContain(local.result.body.locationVideoUrl);
                expect(raw).not.toContain(LINK_KEY);
                // The confirmation page still shows the keyed link.
                expect(local.result.body.videoLinkKeyed).toBe(true);
            });

            it("Moves the meeting's key expiry with the booking's when it is rescheduled", async () => {
                const { result, slot } = await bookVideo();
                expect(await meetingExpiry()).toBe(new Date(Date.parse(slot.end) + 3_600_000).toISOString());

                const later = slotIn(5);
                const moved = await reschedule(result.body.manageToken, later.start);
                expect(moved.status, JSON.stringify(moved.body)).toBe(200);
                const expected = new Date(Date.parse(later.end) + 3_600_000).toISOString();
                expect(new Date((await ctx.findBookings())[0].keyExpiresAt).toISOString()).toBe(expected);
                expect(await meetingExpiry()).toBe(expected);

                // Best effort: not with the plugin off, nor without its backend, and a failure is logged, never answered.
                PluginRegistry.setLoaded([]);
                expect((await reschedule(result.body.manageToken, slotIn(6).start)).status).toBe(200);
                PluginRegistry.setLoaded([{ name: VIDEOCONF_PLUGIN_NAME, version: "0.1.0" }]);
                vi.spyOn(ctx.route(), "importVideoconfBackend").mockResolvedValueOnce(undefined);
                expect((await reschedule(result.body.manageToken, slotIn(7).start)).status).toBe(200);
                const warn = vi.spyOn(ctx.route().logger, "warn");
                // Past the meeting key's five-year bound, which the meeting plugin refuses.
                expect((await reschedule(result.body.manageToken, "2099-06-01T13:00:00.000Z")).status).toBe(200);
                expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed to move the key expiry of the video meeting"));
                expect(await meetingExpiry()).toBe(expected);
            });

            it("Keeps the link keyed when the host saves it again unchanged, and refuses a change it can't compose from what the booker wrote", async () => {
                const { result } = await bookVideo();
                const [booking] = await ctx.findBookings();
                const url = `${ctx.baseUrl}/host/${booking.uid}/location`;

                const refused = await host().post(url).send({ locationVideoUrl: "https://video.example/new" });
                expect(refused.status).toBe(400);
                expect(refused.body.message).toBe("Unlock your mailbox to change a protected booking's video link.");
                const [untouched] = await ctx.findBookings();
                expect(untouched.locationVideoUrl).toBe(result.body.locationVideoUrl);

                const resaved = await host().post(url).send({ locationVideoUrl: result.body.locationVideoUrl, content: { bookerName: "Grace Hopper" }, linkKey: LINK_KEY });
                expect(resaved.status, JSON.stringify(resaved.body)).toBe(200);
                expect((await ctx.findBookings())[0].videoLinkKeyed).toBe(true);
            });
        });

        it("Reaches an expired booking behind a whole batch of bookings further ahead", async () => {
            const key = await ctx.protectHost();
            const ahead = [];
            for (const day of ["02", "03", "04"]) {
                const end = `2099-06-${day}T14:00:00.000Z`;
                ahead.push(await bookProtected(key.fingerprint, { start: `2099-06-${day}T13:00:00.000Z`, protection: bookingProtection(ctx.mailboxUid(), key.fingerprint, end) }));
            }
            const { result } = await bookProtected(key.fingerprint);
            const expired = (await ctx.findBookings()).find((booking) => booking.uid === result.body.uid);
            await ctx.setKeyExpiresAt(expired.uid, new Date(Date.now() - 1000));

            await ctx.runExpiry(2);

            const bookings = await ctx.findBookings();
            expect(bookings.find((booking) => booking.uid === expired.uid).keyDiscardedAt).toBeTruthy();
            for (const { result: other } of ahead) {
                expect(bookings.find((booking) => booking.uid === other.body.uid).guestSealedFields).toBeTruthy();
            }
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
