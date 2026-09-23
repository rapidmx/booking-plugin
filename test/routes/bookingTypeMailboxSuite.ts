///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A booking type's slug is unique within its mailbox, not globally, and a booking type can be moved to another mailbox
// only while it has no bookings - identical on both backends. Run from the BookingTypeRoute test files, which supply the
// fixtures.
import { request } from "@rapidrest/service-core/test";
import { ACLAction } from "@rapidrest/service-core";

export interface BookingTypeMailboxSuiteContext {
    app: () => any;
    baseUrl: string;
    ownerUid: string;
    ownerToken: string;
    otherUserUid: string;
    otherUserToken: string;
    /** A mailbox `ownerUid` has every permission on, with a calendar folder. */
    createMailbox: (ownerUid: string) => Promise<{ uid: string }>;
    /** An ownerless mailbox with a calendar folder, whose only ACL grant is `actions` for `userUid`. */
    createSharedMailbox: (userUid: string, actions: string[]) => Promise<{ uid: string }>;
    createCalendarFolder: (mailboxUid: string) => Promise<{ uid: string }>;
    /** Saves a booking (any status) of the booking type `bookingTypeUid`. */
    createBooking: (bookingTypeUid: string, mailboxUid: string) => Promise<void>;
    /** The mounted route instance, for the few branches HTTP can't reach. */
    route: () => any;
    body: (mailboxUid: string, overrides?: any) => any;
}

export function bookingTypeMailboxSuite(ctx: BookingTypeMailboxSuiteContext): void {
    const post = (payload: any, token: string = ctx.ownerToken) =>
        request(ctx.app()).post(ctx.baseUrl).set("Authorization", "jwt " + token).send(payload);
    const put = (created: any, patch: any, token: string = ctx.ownerToken) =>
        request(ctx.app())
            .put(`${ctx.baseUrl}/${created.uid}`)
            .set("Authorization", "jwt " + token)
            .send({ uid: created.uid, version: created.version, ...patch });

    describe("slugs are unique per mailbox", () => {
        it("allows the same slug in two mailboxes, and refuses it a second time within one (409)", async () => {
            const first = await ctx.createMailbox(ctx.ownerUid);
            const second = await ctx.createMailbox(ctx.ownerUid);

            const inFirst = await post(ctx.body(first.uid, { slug: "intro" }));
            const inSecond = await post(ctx.body(second.uid, { slug: "intro" }));

            expect(inFirst.status).toBe(200);
            expect(inSecond.status).toBe(200);
            expect(inFirst.body.uid).not.toBe(inSecond.body.uid);
            expect(inFirst.body.slug).toBe("intro");
            expect(inSecond.body.slug).toBe("intro");
            expect((await post(ctx.body(first.uid, { slug: "Intro" }))).status).toBe(409);
            expect((await post(ctx.body(second.uid, { slug: " intro " }))).status).toBe(409);
        });

        it("doesn't let a slug held in someone else's mailbox refuse (or reveal) a caller's own", async () => {
            const victim = await ctx.createMailbox(ctx.otherUserUid);
            const mine = await ctx.createMailbox(ctx.ownerUid);
            expect((await post(ctx.body(victim.uid, { slug: "intro" }), ctx.otherUserToken)).status).toBe(200);

            const result = await post(ctx.body(mine.uid, { slug: "intro" }));

            expect(result.status).toBe(200);
        });

        it("accepts the same slug for different mailboxes in one bulk create, and refuses it for one mailbox (409)", async () => {
            const first = await ctx.createMailbox(ctx.ownerUid);
            const second = await ctx.createMailbox(ctx.ownerUid);

            const different = await post([ctx.body(first.uid, { slug: "same" }), ctx.body(second.uid, { slug: "same" })]);
            expect(different.status).toBe(200);
            expect(different.body.map((row: any) => row.mailboxUid).sort()).toEqual([first.uid, second.uid].sort());

            const identical = await post([ctx.body(first.uid, { slug: "twice" }), ctx.body(first.uid, { slug: "Twice" })]);
            expect(identical.status).toBe(409);
        });

        it("lets a booking type be renamed onto a slug another mailbox holds, but not one its own mailbox holds (409)", async () => {
            const first = await ctx.createMailbox(ctx.ownerUid);
            const second = await ctx.createMailbox(ctx.ownerUid);
            await post(ctx.body(first.uid, { slug: "taken-here" }));
            await post(ctx.body(second.uid, { slug: "taken-there" }));
            const mine = (await post(ctx.body(first.uid, { slug: "mine" }))).body;

            expect((await put(mine, { slug: "taken-here" })).status).toBe(409);
            const renamed = await put(mine, { slug: "taken-there" });

            expect(renamed.status).toBe(200);
            expect(renamed.body.slug).toBe("taken-there");
        });
    });

    describe("slug and folder edits within one mailbox", () => {
        it("requires a slug on create (400)", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const payload = ctx.body(mailbox.uid);
            delete payload.slug;

            expect((await post(payload)).status).toBe(400);
        });

        it("lets a booking type switch to another calendar folder of its own mailbox without touching its slug", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const secondCalendar = await ctx.createCalendarFolder(mailbox.uid);
            const created = (await post(ctx.body(mailbox.uid, { slug: "intro" }))).body;

            const result = await put(created, { calendarFolderUid: secondCalendar.uid });

            expect(result.status).toBe(200);
            expect(result.body.calendarFolderUid).toBe(secondCalendar.uid);
            expect(result.body.slug).toBe("intro");
            expect(result.body.mailboxUid).toBe(mailbox.uid);
        });

        it("reads a missing mailbox as none when checking whether a slug is free, since a slug can be held in no mailbox", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            await post(ctx.body(mailbox.uid, { slug: "intro" }));

            await expect(ctx.route().requireSlugFree("intro", undefined)).resolves.toBeUndefined();
            await expect(ctx.route().requireSlugFree("intro", mailbox.uid)).rejects.toMatchObject({ status: 409 });
        });
    });

    describe("moving a booking type to another mailbox", () => {
        /** Two mailboxes the owner has every permission on, each with a calendar folder, and a booking type in the first. */
        const setup = async (slug: string = "intro") => {
            const from = await ctx.createMailbox(ctx.ownerUid);
            const to = await ctx.createMailbox(ctx.ownerUid);
            const toFolder = await ctx.createCalendarFolder(to.uid);
            const created = (await post(ctx.body(from.uid, { slug }))).body;
            return { from, to, toFolder, created };
        };

        it("moves it, along with a calendar folder of the new mailbox", async () => {
            const { from, to, toFolder, created } = await setup();

            const result = await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid });

            expect(result.status).toBe(200);
            expect(result.body.mailboxUid).toBe(to.uid);
            expect(result.body.calendarFolderUid).toBe(toFolder.uid);
            expect(result.body.slug).toBe("intro");
            // The old mailbox no longer holds the slug, so another booking type there may take it.
            expect((await post(ctx.body(from.uid, { slug: "intro" }))).status).toBe(200);
        });

        it("moves it under a new slug in the same request, checking that one in the new mailbox", async () => {
            const { to, toFolder, created } = await setup();
            await post(ctx.body(to.uid, { slug: "held" }));

            expect((await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid, slug: "Held" })).status).toBe(409);
            const result = await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid, slug: "Fresh Slug" });

            expect(result.status).toBe(200);
            expect(result.body.slug).toBe("fresh-slug");
            expect(result.body.mailboxUid).toBe(to.uid);
        });

        it("requires a calendar folder of the new mailbox (400)", async () => {
            const { from, to, toFolder, created } = await setup();
            const fromFolder = await ctx.createCalendarFolder(from.uid);

            // Left pointing at the old mailbox's calendar.
            expect((await put(created, { mailboxUid: to.uid })).status).toBe(400);
            // Explicitly the old mailbox's calendar.
            expect((await put(created, { mailboxUid: to.uid, calendarFolderUid: fromFolder.uid })).status).toBe(400);
            // No such folder.
            expect((await put(created, { mailboxUid: to.uid, calendarFolderUid: "no-such-folder" })).status).toBe(400);
            // Unchanged by all of the above, and still movable with the right folder.
            expect((await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid })).status).toBe(200);
        });

        it("refuses it when the slug is already taken in the new mailbox (409)", async () => {
            const { to, toFolder, created } = await setup("intro");
            await post(ctx.body(to.uid, { slug: "intro" }));

            const result = await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid });

            expect(result.status).toBe(409);
        });

        it("refuses it when the booking type has any booking (409), and leaves it where it was", async () => {
            const { from, to, toFolder, created } = await setup();
            await ctx.createBooking(created.uid, from.uid);

            const result = await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid });

            expect(result.status).toBe(409);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${from.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body.map((row: any) => row.uid)).toEqual([created.uid]);
        });

        it("only counts the booking type's own bookings, and lets one with bookings stay in its mailbox", async () => {
            const { from, to, toFolder, created } = await setup();
            const sibling = (await post(ctx.body(from.uid, { slug: "sibling" }))).body;
            await ctx.createBooking(sibling.uid, from.uid);

            // Another booking type's bookings don't matter.
            expect((await put(created, { mailboxUid: to.uid, calendarFolderUid: toFolder.uid })).status).toBe(200);
            // Sending the mailbox it already has isn't a move, so its own bookings don't matter either.
            const renamed = await put(sibling, { mailboxUid: from.uid, name: "Still here" });
            expect(renamed.status).toBe(200);
            expect(renamed.body.name).toBe("Still here");
            expect(renamed.body.mailboxUid).toBe(from.uid);
        });

        it("refuses a caller who cannot create booking types in the new mailbox (403)", async () => {
            const from = await ctx.createMailbox(ctx.ownerUid);
            // The owner may read (so the new mailbox's calendar folder passes its check) but not create.
            const viewed = await ctx.createSharedMailbox(ctx.ownerUid, [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS]);
            const viewedFolder = await ctx.createCalendarFolder(viewed.uid);
            const created = (await post(ctx.body(from.uid, { slug: "intro" }))).body;

            const result = await put(created, { mailboxUid: viewed.uid, calendarFolderUid: viewedFolder.uid });

            expect(result.status).toBe(403);
        });

        it("refuses a caller who cannot read the new mailbox's calendar at all (403)", async () => {
            const from = await ctx.createMailbox(ctx.ownerUid);
            const victim = await ctx.createMailbox(ctx.otherUserUid);
            const victimFolder = await ctx.createCalendarFolder(victim.uid);
            const created = (await post(ctx.body(from.uid, { slug: "intro" }))).body;

            const result = await put(created, { mailboxUid: victim.uid, calendarFolderUid: victimFolder.uid });

            expect(result.status).toBe(403);
        });

        it("reports a booking type that does not exist as missing, whatever else the patch says", async () => {
            const { to, toFolder } = await setup();

            const result = await request(ctx.app())
                .put(`${ctx.baseUrl}/no-such-booking-type`)
                .set("Authorization", "jwt " + ctx.ownerToken)
                .send({ uid: "no-such-booking-type", version: 0, mailboxUid: to.uid, calendarFolderUid: toFolder.uid, slug: "x" });

            expect(result.status).toBe(404);
        });
    });

    describe("deleting a booking type", () => {
        const del = (created: any, token: string = ctx.ownerToken) =>
            request(ctx.app())
                .delete(`${ctx.baseUrl}/${created.uid}?version=${created.version}`)
                .set("Authorization", "jwt " + token);

        it("refuses it when the booking type has any booking (409), and leaves it in place", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const created = (await post(ctx.body(mailbox.uid, { slug: "intro" }))).body;
            await ctx.createBooking(created.uid, mailbox.uid);

            const result = await del(created);

            expect(result.status).toBe(409);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body.map((row: any) => row.uid)).toEqual([created.uid]);
        });

        it("only counts the booking type's own bookings, and still deletes one with none (204)", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const created = (await post(ctx.body(mailbox.uid, { slug: "intro" }))).body;
            const sibling = (await post(ctx.body(mailbox.uid, { slug: "sibling" }))).body;
            await ctx.createBooking(sibling.uid, mailbox.uid);

            // Another booking type's bookings don't matter.
            const result = await del(created);

            expect(result.status).toBe(204);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body.map((row: any) => row.uid)).toEqual([sibling.uid]);
        });

        it("refuses a caller without DELETE on the mailbox (403), whether or not it has bookings", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const created = (await post(ctx.body(mailbox.uid, { slug: "intro" }))).body;

            const result = await del(created, ctx.otherUserToken);

            expect(result.status).toBe(403);
        });
    });

    describe("truncating (bulk-deleting) a mailbox's booking types", () => {
        const truncate = (mailboxUid: string, token: string = ctx.ownerToken) =>
            request(ctx.app())
                .delete(`${ctx.baseUrl}?mailboxUid=${mailboxUid}`)
                .set("Authorization", "jwt " + token);

        it("refuses the WHOLE truncate (409) when any matched booking type has a booking, leaving ALL of them in place", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const withBooking = (await post(ctx.body(mailbox.uid, { slug: "intro" }))).body;
            const withoutBooking = (await post(ctx.body(mailbox.uid, { slug: "sibling" }))).body;
            await ctx.createBooking(withBooking.uid, mailbox.uid);

            const result = await truncate(mailbox.uid);

            expect(result.status).toBe(409);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            // Neither the offending row NOR its bookingless sibling was deleted - a partial truncate would be a
            // surprising result for a bulk "delete everything matching this filter" request.
            expect(list.body.map((row: any) => row.uid).sort()).toEqual([withBooking.uid, withoutBooking.uid].sort());
        });

        it("still truncates every booking type with no bookings at all (204/200)", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            await post(ctx.body(mailbox.uid, { slug: "intro" }));
            await post(ctx.body(mailbox.uid, { slug: "sibling" }));

            const result = await truncate(mailbox.uid);

            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body).toEqual([]);
        });

        it("only counts each matched booking type's own bookings, not another mailbox's", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            const other = await ctx.createMailbox(ctx.ownerUid);
            const otherWithBooking = (await post(ctx.body(other.uid, { slug: "intro" }))).body;
            await ctx.createBooking(otherWithBooking.uid, other.uid);
            await post(ctx.body(mailbox.uid, { slug: "clean" }));

            // The other mailbox's booked booking type doesn't block truncating THIS mailbox.
            const result = await truncate(mailbox.uid);

            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body).toEqual([]);
            // The other mailbox's booking type - which DOES have a booking - is still refused on its own truncate.
            expect((await truncate(other.uid)).status).toBe(409);
        });

        it("refuses a caller without TRUNCATE on the mailbox (403), whether or not it has bookings", async () => {
            const mailbox = await ctx.createMailbox(ctx.ownerUid);
            await post(ctx.body(mailbox.uid, { slug: "intro" }));

            const result = await truncate(mailbox.uid, ctx.otherUserToken);

            expect(result.status).toBe(403);
            const list = await request(ctx.app())
                .get(`${ctx.baseUrl}?mailboxUid=${mailbox.uid}`)
                .set("Authorization", "jwt " + ctx.ownerToken);
            expect(list.body.length).toBe(1);
        });

        it("strips the shareToken/scope selectors and any $-segment key from the pre-check's own filter, mirroring BaseScopedChildRoute's own stripUnsafeQueryKeys()", () => {
            const stripped = ctx.route().stripUnsafeTruncateQueryKeys({
                mailboxUid: "mbx",
                shareToken: "t",
                scope: "admin",
                $or: "widen",
                "a.$b": "z",
                enabled: "true",
            });

            expect(stripped).toEqual({ mailboxUid: "mbx", enabled: "true" });
        });
    });
}
