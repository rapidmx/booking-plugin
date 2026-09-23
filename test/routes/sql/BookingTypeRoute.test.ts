///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import config from "../../config.sql.js";
import { request } from "@rapidrest/service-core/test";
import { Server, ObjectFactory, ConnectionManager, ACLAction, AccessControlListSQL, isSqlDataSource } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { BookingSQL } from "../../../src/models/sql/BookingSQL.js";
import { BookingTypeSQL } from "../../../src/models/sql/BookingTypeSQL.js";
import { FolderSQL, MailboxSQL } from "@rapidmx/restapi/sql";
import { FolderType } from "@rapidmx/restapi";
import { registerTestDoubles } from "../../testDoubles.js";
import { bookingTypeFolderSuite } from "../bookingTypeFolderSuite.js";
import { bookingTypeMailboxSuite } from "../bookingTypeMailboxSuite.js";

describe("Route:BookingTypeSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/booking-types";
    let mailboxRepo: Repository<MailboxSQL>;
    let bookingTypeRepo: Repository<BookingTypeSQL>;
    let folderRepo: Repository<FolderSQL>;
    let bookingRepo: Repository<BookingSQL>;
    let aclRepo: Repository<AccessControlListSQL>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);
    const otherUser: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const otherUserToken = JWTUtils.createTokenSync(config.get("auth"), otherUser);

    const createMailbox = async function (ownerUid: string): Promise<MailboxSQL> {
        const obj: MailboxSQL = new MailboxSQL({
            ownerUserUid: ownerUid,
            primarySmtpAddress: `${uuid.v4()}@example.com`,
            aliasAddresses: [],
            displayName: "Test Mailbox",
            timezone: "UTC",
            quotaBytes: 1_000_000_000,
            usedBytes: 0,
        });
        const result: MailboxSQL = await mailboxRepo.save(obj);
        await aclRepo.save({
            uid: result.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [{ userOrRoleId: ownerUid, actions: [ACLAction.FULL] }],
            parentUid: "Mailbox",
        });
        await createCalendarFolder(result.uid);
        return result;
    };

    /** Every test mailbox gets a calendar folder (its ACL parented to the mailbox, as `BaseFolderRoute` creates
     * them), which `body()` uses as the booking type's `calendarFolderUid`. */
    const calendarFolders: Map<string, string> = new Map();
    const createCalendarFolder = async function (mailboxUid: string, type: FolderType = FolderType.CALENDAR): Promise<FolderSQL> {
        const folder: FolderSQL = await folderRepo.save(
            new FolderSQL({ mailboxUid, name: "Calendar", type, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
        );
        await aclRepo.save({
            uid: folder.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [],
            parentUid: mailboxUid,
        });
        if (type === FolderType.CALENDAR && !calendarFolders.has(mailboxUid)) {
            calendarFolders.set(mailboxUid, folder.uid);
        }
        return folder;
    };

    /** A valid create body - every test varies one field of it. */
    const body = (mailboxUid: string, overrides?: any) => ({
        mailboxUid,
        calendarFolderUid: calendarFolders.get(mailboxUid) ?? uuid.v4(),
        slug: `intro-${uuid.v4()}`,
        name: "Intro Call",
        hostDisplayName: "Ada Lovelace",
        meetingTypes: [{ name: "Intro Call", durationMinutes: 30, locationOptions: [{ type: "video" }] }],
        timezone: "America/New_York",
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }],
        dateOverrides: [],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 0,
        bookingWindowDays: 30,
        requiresApproval: false,
        enabled: true,
        ...overrides,
    });

    beforeAll(async () => {
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        if (isSqlDataSource(conn)) {
            aclRepo = conn.getRepository(AccessControlListSQL);
        } else {
            throw new Error("Could not find sql acl connection");
        }
        conn = connMgr?.connections.get("sql");
        if (isSqlDataSource(conn)) {
            mailboxRepo = conn.getRepository(MailboxSQL);
            bookingTypeRepo = conn.getRepository(BookingTypeSQL);
            folderRepo = conn.getRepository(FolderSQL);
            bookingRepo = conn.getRepository(BookingSQL);
        } else {
            throw new Error("Could not find sql connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        await bookingRepo.clear();
        await bookingTypeRepo.clear();
        await folderRepo.clear();
        await mailboxRepo.clear();
    });

    it("Owner can create a booking type, with the slug normalized.", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { slug: "  30 Minute // Intro Call!  " }));

        expect(result.status).toBe(200);
        expect(result.body.slug).toBe("30-minute-intro-call");
    });

    it("A user with no access to the mailbox cannot create a booking type (403).", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + otherUserToken)
            .send(body(mailbox.uid));

        expect(result.status).toBe(403);
    });

    it("Rejects a slug that normalizes to nothing (400).", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { slug: "!!!" }));

        expect(result.status).toBe(400);
    });

    it("Rejects a slug already in use by another booking type (409).", async () => {
        const mailbox = await createMailbox(owner.uid);
        await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { slug: "taken" }));

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { slug: "Taken" }));

        expect(result.status).toBe(409);
    });

    it("Rejects two identical slugs within a single bulk create (409).", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send([body(mailbox.uid, { slug: "dupe" }), body(mailbox.uid, { slug: "dupe" })]);

        expect(result.status).toBe(409);
    });

    it("Accepts a bulk create of distinct booking types.", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send([body(mailbox.uid, { slug: "first" }), body(mailbox.uid, { slug: "second" })]);

        expect(result.status).toBe(200);
        expect(result.body.map((row: any) => row.slug).sort()).toEqual(["first", "second"]);
    });

    it("Rejects an unrecognized timezone (400).", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { timezone: "Mars/Olympus_Mons" }));

        expect(result.status).toBe(400);
    });

    it("Rejects an availability window that ends before it starts (400).", async () => {
        const mailbox = await createMailbox(owner.uid);

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid, { availability: [{ dayOfWeek: 1, startMinute: 660, endMinute: 540 }] }));

        expect(result.status).toBe(400);
    });

    it("Owner can list their booking types.", async () => {
        const mailbox = await createMailbox(owner.uid);
        await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + ownerToken)
            .send(body(mailbox.uid));

        const result = await request(server.getApplication())
            .get(`${baseUrl}?mailboxUid=${mailbox.uid}`)
            .set("Authorization", "jwt " + ownerToken);

        expect(result.status).toBe(200);
        expect(result.body).toHaveLength(1);
    });

    describe("update()", () => {
        it("Owner can rename the slug, which is normalized on the way in.", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid, { slug: "before" }));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: created.body.uid, version: created.body.version, slug: "After Rename" });

            expect(result.status).toBe(200);
            expect(result.body.slug).toBe("after-rename");
        });

        it("A booking type keeping its own slug does not collide with itself.", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid, { slug: "stable" }));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: created.body.uid, version: created.body.version, slug: "stable", name: "Renamed" });

            expect(result.status).toBe(200);
            expect(result.body.name).toBe("Renamed");
        });

        it("Rejects renaming onto a slug another booking type already holds (409).", async () => {
            const mailbox = await createMailbox(owner.uid);
            await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid, { slug: "occupied" }));
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid, { slug: "mine" }));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: created.body.uid, version: created.body.version, slug: "occupied" });

            expect(result.status).toBe(409);
        });

        it("A patch that does not mention the slug leaves it alone.", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid, { slug: "untouched" }));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({ uid: created.body.uid, version: created.body.version, enabled: false });

            expect(result.status).toBe(200);
            expect(result.body.slug).toBe("untouched");
            expect(result.body.enabled).toBe(false);
        });

        it("Rejects an update carrying an invalid availability window (400).", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({
                    uid: created.body.uid,
                    version: created.body.version,
                    availability: [{ dayOfWeek: 9, startMinute: 540, endMinute: 660 }],
                });

            expect(result.status).toBe(400);
        });

        it("A user with no access to the mailbox cannot update a booking type (403).", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid));

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + otherUserToken)
                .send({ uid: created.body.uid, version: created.body.version, name: "Hijacked" });

            expect(result.status).toBe(403);
        });

        it("An update keeps an edited-in-place meeting type's and location option's existing uid, and mints one for a brand-new sibling.", async () => {
            const mailbox = await createMailbox(owner.uid);
            const created = await request(server.getApplication())
                .post(baseUrl)
                .set("Authorization", "jwt " + ownerToken)
                .send(body(mailbox.uid));
            const existingMeetingType = created.body.meetingTypes[0];
            const existingLocationOption = existingMeetingType.locationOptions[0];

            const result = await request(server.getApplication())
                .put(`${baseUrl}/${created.body.uid}`)
                .set("Authorization", "jwt " + ownerToken)
                .send({
                    uid: created.body.uid,
                    version: created.body.version,
                    meetingTypes: [
                        {
                            ...existingMeetingType,
                            name: "Intro Call (renamed)",
                            locationOptions: [{ ...existingLocationOption, label: "Video" }],
                        },
                        { name: "Follow-up", durationMinutes: 15, locationOptions: [{ type: "phone" }] },
                    ],
                });

            expect(result.status).toBe(200);
            expect(result.body.meetingTypes).toHaveLength(2);
            expect(result.body.meetingTypes[0].uid).toBe(existingMeetingType.uid);
            expect(result.body.meetingTypes[0].locationOptions[0].uid).toBe(existingLocationOption.uid);
            expect(result.body.meetingTypes[1].uid).toBeTruthy();
            expect(result.body.meetingTypes[1].uid).not.toBe(existingMeetingType.uid);
            expect(result.body.meetingTypes[1].locationOptions[0].uid).toBeTruthy();
        });
    });
    bookingTypeMailboxSuite({
        app: () => server.getApplication(),
        baseUrl,
        ownerUid: owner.uid,
        ownerToken,
        otherUserUid: otherUser.uid,
        otherUserToken,
        createMailbox,
        createSharedMailbox: async (userUid: string, actions: string[]) => {
            const result: MailboxSQL = await mailboxRepo.save(
                new MailboxSQL({
                    primarySmtpAddress: `shared-${uuid.v4()}@example.com`,
                    aliasAddresses: [],
                    displayName: "Shared",
                    timezone: "UTC",
                    quotaBytes: 1_000_000_000,
                    usedBytes: 0,
                }),
            );
            await aclRepo.save({
                uid: result.uid,
                dateCreated: new Date(),
                dateModified: new Date(),
                version: 0,
                records: [{ userOrRoleId: userUid, actions }],
                parentUid: "Mailbox",
            });
            await createCalendarFolder(result.uid);
            return result;
        },
        createCalendarFolder,
        route: () => objectFactory.getInstance("routes.BookingTypeRoute"),
        createBooking: async (bookingTypeUid: string, mailboxUid: string) => {
            await bookingRepo.save(new BookingSQL({ bookingTypeUid, mailboxUid, manageToken: uuid.v4() }));
        },
        body,
    });
    bookingTypeFolderSuite({
        app: () => server.getApplication(),
        baseUrl,
        ownerUid: owner.uid,
        ownerToken,
        otherUserUid: otherUser.uid,
        createMailbox,
        createCalendarFolder,
        body,
    });
});
