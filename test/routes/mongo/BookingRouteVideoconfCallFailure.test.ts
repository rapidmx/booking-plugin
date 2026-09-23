///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Companion to `BookingRouteVideoconfImportFailure.test.ts`: that file simulates
// `BaseBookingRoute.importVideoconfBackend()`'s OWN dynamic import failing (caught internally, by
// `BookingRouteMongo.importVideoconfBackend()`'s own `try`/`catch`, well before `maybeCreateVideoMeetingJoinUrl()`'s
// outer `try`/`catch` is ever reached). This file instead lets `importVideoconfBackend()` succeed (the real,
// installed `@rapidmx/meet-plugin/mongo` is left unmocked) and simulates the SECOND dynamic import -
// `@rapidmx/meet-plugin`'s own root entry point, where `createSingleInviteeVideoMeeting` itself lives -
// failing instead, which IS caught by `maybeCreateVideoMeetingJoinUrl()`'s own outer `try`/`catch`. Both failure
// surfaces must independently leave a booking unharmed with `locationVideoUrl` unset.
import config from "../../config.js";
import { request } from "@rapidrest/service-core/test";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import { FolderType, PluginRegistry } from "@rapidmx/restapi";
import { FolderMongo, MailboxMongo } from "@rapidmx/restapi/mongo";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as uuid from "uuid";
import { BookingMongo } from "../../../src/models/mongo/BookingMongo.js";
import { BookingTypeMongo } from "../../../src/models/mongo/BookingTypeMongo.js";
import { BookingLocationType } from "../../../src/models/types.js";
import { registerTestDoubles } from "../../testDoubles.js";

vi.mock("@rapidmx/meet-plugin", () => {
    throw new Error("Simulated: the root entry point (createSingleInviteeVideoMeeting's own module) is genuinely unresolvable.");
});

// Port must match `../../config.js`'s fixed `mongo`/`acl` port (9999) - the other Mongo-backed test files in this
// repo all use the same port for the same reason; `fileParallelism: false` guarantees only one is ever running.
const mongod: MongoMemoryServer = new MongoMemoryServer({ instance: { port: 9999, dbName: "rrst-test" } });

describe("Route:BookingMongo Tests (videoconf integration call failure)", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    // A minimal fixture WITHOUT `@rapidmx/meet-plugin`'s own models registered - see
    // `test/server-mongo-import-failure/models/index.ts`'s doc comment (this file's own real, unmocked
    // `import("@rapidmx/meet-plugin/mongo")` only needs the module's class references, not a registered
    // datastore, since `createSingleInviteeVideoMeeting()` is never actually reached in this scenario).
    const server: Server = new Server({ config, basePath: "./test/server-mongo-import-failure", logger, objectFactory });
    const baseUrl = "/mongo/bookings";
    let mailboxRepo: MongoRepository<MailboxMongo>;
    let folderRepo: MongoRepository<FolderMongo>;
    let bookingTypeRepo: MongoRepository<BookingTypeMongo>;
    let bookingRepo: MongoRepository<BookingMongo>;

    let mailbox: MailboxMongo;
    let calendarFolder: FolderMongo;

    beforeAll(async () => {
        await mongod.start();
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("mongo");
        if (conn instanceof MongoConnection) {
            mailboxRepo = conn.getMongoRepository("MailboxMongo");
            folderRepo = conn.getMongoRepository("FolderMongo");
            bookingTypeRepo = conn.getMongoRepository("BookingTypeMongo");
            bookingRepo = conn.getMongoRepository("BookingMongo");
        } else {
            throw new Error("Could not find mongo connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        for (const repo of [mailboxRepo, folderRepo, bookingTypeRepo, bookingRepo]) {
            try {
                await repo.clear();
            } catch (err: any) {
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
        }
        mailbox = await mailboxRepo.save(
            new MailboxMongo({
                ownerUserUid: uuid.v4(),
                primarySmtpAddress: `ada-${uuid.v4()}@example.com`,
                aliasAddresses: [],
                displayName: "Ada Lovelace",
                timezone: "UTC",
                quotaBytes: 1_000_000_000,
                usedBytes: 0,
            }),
        );
        calendarFolder = await folderRepo.save(
            new FolderMongo({ mailboxUid: mailbox.uid, name: "Calendar", type: FolderType.CALENDAR, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
        );
    });

    afterEach(() => {
        PluginRegistry.setLoaded([]);
    });

    it("never fails the booking when the plugin is active and its backend resolves, but the root integration module genuinely fails", async () => {
        PluginRegistry.setLoaded([{ name: "@rapidmx/meet-plugin", version: "0.1.0" }]);
        const bookingType = await bookingTypeRepo.save(
            new BookingTypeMongo({
                mailboxUid: mailbox.uid,
                calendarFolderUid: calendarFolder.uid,
                slug: `intro-${uuid.v4()}`,
                name: "Intro Call",
                hostDisplayName: "Ada Lovelace",
                meetingTypes: [
                    {
                        uid: "mt-default",
                        name: "Intro Call",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-default", type: BookingLocationType.VIDEO }],
                    },
                ],
                timezone: "America/New_York",
                availability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: 540, endMinute: 660 })),
                dateOverrides: [],
                bufferBeforeMinutes: 0,
                bufferAfterMinutes: 0,
                minimumNoticeMinutes: 0,
                bookingWindowDays: 100_000,
                requiresApproval: false,
                enabled: true,
            }),
        );

        const result = await request(server.getApplication())
            .post(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}`)
            .send({
                start: "2099-06-01T13:00:00.000Z",
                meetingTypeUid: "mt-default",
                locationOptionUid: "lo-default",
                bookerName: "Grace Hopper",
                bookerEmail: "grace@example.com",
            });

        expect(result.status).toBe(200);
        expect(result.body.locationType).toBe(BookingLocationType.VIDEO);
        expect(result.body.locationVideoUrl).toBeUndefined();

        const bookings = await bookingRepo.find({}).toArray();
        expect(bookings).toHaveLength(1);
        expect(bookings[0].locationVideoUrl).toBeUndefined();
    });
});
