///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Companion to `BookingRouteVideoconfImportFailure.test.ts`: that file simulates
// `BaseBookingRoute.importVideoconfBackend()`'s OWN dynamic import failing (caught internally, by
// `BookingRouteSQL.importVideoconfBackend()`'s own `try`/`catch`, well before `maybeCreateVideoMeetingJoinUrl()`'s
// outer `try`/`catch` is ever reached). This file instead lets `importVideoconfBackend()` succeed (the real,
// installed `@rapidmx/meet-plugin/sql` is left unmocked) and simulates the SECOND dynamic import -
// `@rapidmx/meet-plugin`'s own root entry point, where `createSingleInviteeVideoMeeting` itself lives -
// failing instead, which IS caught by `maybeCreateVideoMeetingJoinUrl()`'s own outer `try`/`catch`. Both failure
// surfaces must independently leave a booking unharmed with `locationVideoUrl` unset.
import config from "../../config.sql.js";
import { request } from "@rapidrest/service-core/test";
import { Server, ObjectFactory, ConnectionManager, isSqlDataSource } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import { FolderType, PluginRegistry } from "@rapidmx/restapi";
import { FolderSQL, MailboxSQL } from "@rapidmx/restapi/sql";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { BookingSQL } from "../../../src/models/sql/BookingSQL.js";
import { BookingTypeSQL } from "../../../src/models/sql/BookingTypeSQL.js";
import { BookingLocationType } from "../../../src/models/types.js";
import { registerTestDoubles } from "../../testDoubles.js";

vi.mock("@rapidmx/meet-plugin", () => {
    throw new Error("Simulated: the root entry point (createSingleInviteeVideoMeeting's own module) is genuinely unresolvable.");
});

describe("Route:BookingSQL Tests (videoconf integration call failure)", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    // A minimal fixture WITHOUT `@rapidmx/meet-plugin`'s own models registered - see
    // `test/server-sql-import-failure/models/index.ts`'s doc comment (this file's own real, unmocked
    // `import("@rapidmx/meet-plugin/sql")` only needs the module's class references, not a registered
    // datastore, since `createSingleInviteeVideoMeeting()` is never actually reached in this scenario).
    const server: Server = new Server({ config, basePath: "./test/server-sql-import-failure", logger, objectFactory });
    const baseUrl = "/sql/bookings";
    let mailboxRepo: Repository<MailboxSQL>;
    let folderRepo: Repository<FolderSQL>;
    let bookingTypeRepo: Repository<BookingTypeSQL>;
    let bookingRepo: Repository<BookingSQL>;

    let mailbox: MailboxSQL;
    let calendarFolder: FolderSQL;

    beforeAll(async () => {
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("sql");
        if (isSqlDataSource(conn)) {
            mailboxRepo = conn.getRepository(MailboxSQL);
            folderRepo = conn.getRepository(FolderSQL);
            bookingTypeRepo = conn.getRepository(BookingTypeSQL);
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
        // Child rows first - these tables are shared on disk with every other SQL test file in the run.
        for (const repo of [bookingRepo, bookingTypeRepo, folderRepo, mailboxRepo]) {
            await repo.clear();
        }
        mailbox = await mailboxRepo.save(
            new MailboxSQL({
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
            new FolderSQL({ mailboxUid: mailbox.uid, name: "Calendar", type: FolderType.CALENDAR, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
        );
    });

    afterEach(() => {
        PluginRegistry.setLoaded([]);
    });

    it("never fails the booking when the plugin is active and its backend resolves, but the root integration module genuinely fails", async () => {
        PluginRegistry.setLoaded([{ name: "@rapidmx/meet-plugin", version: "0.1.0" }]);
        const bookingType = await bookingTypeRepo.save(
            new BookingTypeSQL({
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

        const bookings = await bookingRepo.find();
        expect(bookings).toHaveLength(1);
        expect(bookings[0].locationVideoUrl).toBeFalsy();
    });
});
