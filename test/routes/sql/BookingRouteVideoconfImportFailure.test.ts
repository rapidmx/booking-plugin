///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Simulates `PluginRegistry.isActive("@rapidmx/videoconf-plugin")` reporting true while the actual dynamic
// `import("@rapidmx/videoconf-plugin/sql")` genuinely fails (an incompatible version installed, a corrupted
// install, or any other reason the active flag and reality disagree) - `BaseBookingRoute
// .maybeCreateVideoMeetingJoinUrl()`'s own `try`/`catch` must still let the booking succeed with
// `locationVideoUrl` left unset, exactly as if the plugin were never installed at all. A module-level `vi.mock()`
// on the dynamically-imported module is used rather than actually uninstalling the package (impossible to
// simulate honestly now that it's a real, present `devDependency`/`optionalDependencies` entry - see
// `package.json`) - kept in its own file (separate from `BookingRoute.test.ts`) because a `vi.mock()` this broad
// would otherwise apply to every test sharing the same module graph, including the real-success tests in
// `bookingVideoconfIntegrationSuite.ts`.
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

vi.mock("@rapidmx/videoconf-plugin/sql", () => {
    throw new Error("Simulated: package listed active but genuinely unresolvable.");
});

describe("Route:BookingSQL Tests (videoconf dynamic-import failure)", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    // A minimal fixture WITHOUT `@rapidmx/videoconf-plugin`'s own models registered - see
    // `test/server-sql-import-failure/models/index.ts`'s doc comment for why this can't reuse `test/server-sql`.
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

    it("never fails the booking when the plugin is listed active but the dynamic import genuinely throws", async () => {
        PluginRegistry.setLoaded([{ name: "@rapidmx/videoconf-plugin", version: "0.1.0" }]);
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
