///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// The mailbox scoping of the public booking endpoints (`/types/:mailboxUid/:slug`) and the mailbox's booking profile
// versions they return - identical on both backends. Run from the BookingRoute test files, which supply a started server
// and fixtures (a mailbox with one calendar folder, recreated before every test). Every request is anonymous.
import { request } from "@rapidrest/service-core/test";

const SLOT_1 = "2099-06-01T13:00:00.000Z";
const SLOT_2 = "2099-06-01T14:00:00.000Z";
const WINDOW_FROM = "2099-06-01T00:00:00.000Z";
const WINDOW_TO = "2099-06-02T00:00:00.000Z";

export interface BookingMailboxSuiteContext {
    app: () => any;
    baseUrl: string;
    /** The fixture mailbox's uid (lowercase). */
    mailboxUid: () => string;
    /** Saves a booking type in the fixture mailbox, with `data` overriding any field. */
    createBookingType: (data?: any) => Promise<{ uid: string; slug: string }>;
    /** Saves another mailbox with a calendar folder of its own, optionally under a chosen `uid`. */
    createOtherMailbox: (uid?: string) => Promise<{ uid: string; calendarFolderUid: string }>;
    /** Saves the booking profile row of `mailboxUid`, with `data` (blob keys and content types) on it. */
    createProfile: (mailboxUid: string, data: any) => Promise<void>;
    findBookings: () => Promise<any[]>;
    rateLimiter: () => any;
    /** The mounted route instance, for the few branches HTTP can't reach. */
    route: () => any;
}

export function bookingMailboxSuite(ctx: BookingMailboxSuiteContext): void {
    const validBooking = (start: string = SLOT_1) => ({
        start,
        meetingTypeUid: "mt-default",
        locationOptionUid: "lo-default",
        bookerName: "Grace Hopper",
        bookerEmail: "grace@example.com",
        bookerNotes: "Looking forward to it.",
        bookerTimezone: "America/Chicago",
    });
    const typeUrl = (mailboxUid: string, slug: string, suffix: string = "") => `${ctx.baseUrl}/types/${mailboxUid}/${slug}${suffix}`;
    const slotsSuffix = `/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`;
    const book = (mailboxUid: string, slug: string, body: any = validBooking()) => request(ctx.app()).post(typeUrl(mailboxUid, slug)).send(body);

    describe("mailbox scoping", () => {
        it("resolves a booking type only under the mailbox that owns it, on every public endpoint", async () => {
            const bookingType = await ctx.createBookingType();
            const other = await ctx.createOtherMailbox();

            expect((await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug))).status).toBe(200);
            expect((await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug, slotsSuffix))).status).toBe(200);
            expect((await book(ctx.mailboxUid(), bookingType.slug)).status).toBe(200);

            expect((await request(ctx.app()).get(typeUrl(other.uid, bookingType.slug))).status).toBe(404);
            expect((await request(ctx.app()).get(typeUrl(other.uid, bookingType.slug, slotsSuffix))).status).toBe(404);
            expect((await book(other.uid, bookingType.slug, validBooking(SLOT_2))).status).toBe(404);
            expect((await request(ctx.app()).get(typeUrl("no-such-mailbox", bookingType.slug))).status).toBe(404);
            // Only the one booking made under the right mailbox exists.
            expect(await ctx.findBookings()).toHaveLength(1);
        });

        it("resolves an uppercase or whitespace-padded mailbox, since mailbox uids are lowercased addresses", async () => {
            const bookingType = await ctx.createBookingType();

            for (const param of [ctx.mailboxUid().toUpperCase(), ` ${ctx.mailboxUid()} `, `  ${ctx.mailboxUid().toUpperCase()}\t`]) {
                const result = await request(ctx.app()).get(typeUrl(encodeURIComponent(param), bookingType.slug));
                expect(result.status).toBe(200);
                expect(result.body.mailboxUid).toBe(ctx.mailboxUid());
            }
        });

        it("resolves a mailbox address whether its @ is left as is or percent-encoded", async () => {
            const uid: string = `grace-${Date.now()}@example.com`;
            const other = await ctx.createOtherMailbox(uid);
            const bookingType = await ctx.createBookingType({ mailboxUid: other.uid, calendarFolderUid: other.calendarFolderUid });

            for (const param of [uid, encodeURIComponent(uid), uid.toUpperCase()]) {
                const result = await request(ctx.app()).get(typeUrl(param, bookingType.slug));
                expect(result.status).toBe(200);
                expect(result.body.mailboxUid).toBe(uid);
            }
        });

        it("never reads a mailbox param as query syntax", async () => {
            const bookingType = await ctx.createBookingType();

            for (const param of ["a,b()", "like(*)", "regex(^.*)", "in(a,b)", "ne(x)", "*", "%25", ctx.mailboxUid() + ",slug()"]) {
                const encoded: string = encodeURIComponent(param);
                expect((await request(ctx.app()).get(typeUrl(encoded, bookingType.slug))).status).toBe(404);
                expect((await request(ctx.app()).get(typeUrl(param, bookingType.slug))).status).toBe(404);
                expect((await request(ctx.app()).get(typeUrl(encoded, bookingType.slug, slotsSuffix))).status).toBe(404);
                expect((await book(encoded, bookingType.slug)).status).toBe(404);
            }
            // A mailbox param of only whitespace can never name a mailbox either.
            expect((await request(ctx.app()).get(typeUrl("%20", bookingType.slug))).status).toBe(404);
            expect(await ctx.findBookings()).toHaveLength(0);
        });

        it("lets two mailboxes each own the same slug, each resolving to its own booking type", async () => {
            const mine = await ctx.createBookingType({ slug: "intro", name: "My Intro" });
            const other = await ctx.createOtherMailbox();
            const theirs = await ctx.createBookingType({
                slug: "intro",
                name: "Their Intro",
                mailboxUid: other.uid,
                calendarFolderUid: other.calendarFolderUid,
            });
            expect(mine.uid).not.toBe(theirs.uid);

            const mineResult = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), "intro"));
            const theirsResult = await request(ctx.app()).get(typeUrl(other.uid, "intro"));
            expect(mineResult.body).toEqual(expect.objectContaining({ mailboxUid: ctx.mailboxUid(), slug: "intro", name: "My Intro" }));
            expect(theirsResult.body).toEqual(expect.objectContaining({ mailboxUid: other.uid, slug: "intro", name: "Their Intro" }));

            // Slots and bookings follow the same scoping: each booking lands in its own mailbox's calendar.
            expect((await request(ctx.app()).get(typeUrl(other.uid, "intro", slotsSuffix))).status).toBe(200);
            const bookedMine = await book(ctx.mailboxUid(), "intro");
            const bookedTheirs = await book(other.uid, "intro");
            expect(bookedMine.status).toBe(200);
            expect(bookedTheirs.status).toBe(200);
            expect(bookedMine.body).toEqual(expect.objectContaining({ mailboxUid: ctx.mailboxUid(), name: "My Intro" }));
            expect(bookedTheirs.body).toEqual(expect.objectContaining({ mailboxUid: other.uid, name: "Their Intro" }));
            const bookings = await ctx.findBookings();
            expect(bookings.map((booking: any) => booking.mailboxUid).sort()).toEqual([ctx.mailboxUid(), other.uid].sort());
            expect(bookings.find((booking: any) => booking.mailboxUid === other.uid).folderUid).toBe(other.calendarFolderUid);
            expect(bookings.find((booking: any) => booking.mailboxUid === other.uid).bookingTypeUid).toBe(theirs.uid);
        });

        it("keeps a disabled booking type invisible without hiding the same slug in another mailbox", async () => {
            await ctx.createBookingType({ slug: "intro", enabled: false });
            const other = await ctx.createOtherMailbox();
            await ctx.createBookingType({ slug: "intro", mailboxUid: other.uid, calendarFolderUid: other.calendarFolderUid });

            expect((await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), "intro"))).status).toBe(404);
            expect((await request(ctx.app()).get(typeUrl(other.uid, "intro"))).status).toBe(200);
        });

        it("counts the same slug in two mailboxes on separate rate limiter counters", async () => {
            const rateLimiter: any = ctx.rateLimiter();
            const original = rateLimiter.config;
            rateLimiter.config = { enabled: true, maxAttempts: 1, windowSeconds: 300, ip: { enabled: false } };
            try {
                await ctx.createBookingType({ slug: "intro" });
                const other = await ctx.createOtherMailbox();
                await ctx.createBookingType({ slug: "intro", mailboxUid: other.uid, calendarFolderUid: other.calendarFolderUid });
                const slots = (mailboxUid: string) => request(ctx.app()).get(typeUrl(mailboxUid, "intro", slotsSuffix));

                expect((await slots(ctx.mailboxUid())).status).toBe(200);
                expect((await slots(ctx.mailboxUid())).status).toBe(429);
                expect((await slots(other.uid)).status).toBe(200);
                expect((await slots(other.uid)).status).toBe(429);
            } finally {
                rateLimiter.config = original;
            }
        });
    });

    describe("params that are not text", () => {
        it("can never name a booking type, which HTTP path params never produce but a direct caller could", async () => {
            const route = ctx.route();

            await expect(route.publicBookingType(undefined, undefined)).rejects.toMatchObject({ status: 404 });
            await expect(route.publicBookingType(ctx.mailboxUid(), undefined)).rejects.toMatchObject({ status: 404 });
            await expect(route.publicBookingType(undefined, "intro")).rejects.toMatchObject({ status: 404 });
        });
    });

    describe("booking profile versions", () => {
        it("omits the avatar and banner versions when the mailbox has no profile", async () => {
            const bookingType = await ctx.createBookingType();

            const result = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug));

            expect(result.status).toBe(200);
            expect(result.body.mailboxUid).toBe(ctx.mailboxUid());
            expect(result.body).not.toHaveProperty("avatarVersion");
            expect(result.body).not.toHaveProperty("bannerVersion");
        });

        it("omits the versions when the profile holds no images, or an image was cleared", async () => {
            const bookingType = await ctx.createBookingType();
            await ctx.createProfile(ctx.mailboxUid(), { avatarBlobKey: null, avatarContentType: null, bannerBlobKey: null, bannerContentType: null });

            const result = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug));

            expect(result.status).toBe(200);
            expect(result.body).not.toHaveProperty("avatarVersion");
            expect(result.body).not.toHaveProperty("bannerVersion");
        });

        it("returns the version of each image the mailbox's profile has, the last segment of its blob key", async () => {
            const bookingType = await ctx.createBookingType();
            await ctx.createProfile(ctx.mailboxUid(), {
                avatarBlobKey: "booking-profiles/avatar/aaaa-1111",
                avatarContentType: "image/png",
                bannerBlobKey: "booking-profiles/banner/bbbb-2222",
                bannerContentType: "image/webp",
            });

            const result = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug));

            expect(result.status).toBe(200);
            expect(result.body.avatarVersion).toBe("aaaa-1111");
            expect(result.body.bannerVersion).toBe("bbbb-2222");
            // Only the versions are exposed - never the blob keys or content types themselves.
            expect(JSON.stringify(result.body)).not.toContain("booking-profiles/");
            expect(result.body.calendarFolderUid).toBeUndefined();
        });

        it("returns just the versions that are set", async () => {
            const bookingType = await ctx.createBookingType();
            await ctx.createProfile(ctx.mailboxUid(), { bannerBlobKey: "booking-profiles/banner/only-banner", bannerContentType: "image/gif" });

            const result = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug));

            expect(result.body).not.toHaveProperty("avatarVersion");
            expect(result.body.bannerVersion).toBe("only-banner");
        });

        it("never shows another mailbox's images", async () => {
            const bookingType = await ctx.createBookingType();
            const other = await ctx.createOtherMailbox();
            await ctx.createProfile(other.uid, { avatarBlobKey: "booking-profiles/avatar/theirs", avatarContentType: "image/png" });

            const result = await request(ctx.app()).get(typeUrl(ctx.mailboxUid(), bookingType.slug));

            expect(result.body).not.toHaveProperty("avatarVersion");
        });

        it("returns the mailbox and versions on a booking, both when it is made and on every later lookup", async () => {
            const bookingType = await ctx.createBookingType();
            await ctx.createProfile(ctx.mailboxUid(), {
                avatarBlobKey: "booking-profiles/avatar/av-1",
                avatarContentType: "image/png",
                bannerBlobKey: "booking-profiles/banner/bn-1",
                bannerContentType: "image/png",
            });
            const expected = { mailboxUid: ctx.mailboxUid(), avatarVersion: "av-1", bannerVersion: "bn-1" };

            const created = await book(ctx.mailboxUid(), bookingType.slug);
            expect(created.status).toBe(200);
            expect(created.body).toEqual(expect.objectContaining(expected));
            const token: string = created.body.manageToken;

            const fetched = await request(ctx.app()).get(`${ctx.baseUrl}/manage/${token}`);
            expect(fetched.status).toBe(200);
            expect(fetched.body).toEqual(expect.objectContaining(expected));
            expect(fetched.body.manageToken).toBeUndefined();

            const rescheduled = await request(ctx.app()).post(`${ctx.baseUrl}/manage/${token}/reschedule`).send({ start: SLOT_2 });
            expect(rescheduled.status).toBe(200);
            expect(rescheduled.body).toEqual(expect.objectContaining(expected));

            const cancelled = await request(ctx.app()).post(`${ctx.baseUrl}/manage/${token}/cancel`);
            expect(cancelled.status).toBe(200);
            expect(cancelled.body).toEqual(expect.objectContaining(expected));
        });

        it("omits the versions from a booking whose mailbox has no profile", async () => {
            const bookingType = await ctx.createBookingType();

            const created = await book(ctx.mailboxUid(), bookingType.slug);

            expect(created.status).toBe(200);
            expect(created.body.mailboxUid).toBe(ctx.mailboxUid());
            expect(created.body).not.toHaveProperty("avatarVersion");
            expect(created.body).not.toHaveProperty("bannerVersion");
        });
    });
}
