///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Exercises the ENTIRE anonymous booking flow with NO `Authorization` header on any request - these endpoints
// are unauthenticated by design, and a test that quietly authenticated would prove nothing about the behavior
// that actually matters. Same idiom as the anonymous share-token requests in CalendarEventRoute.test.ts.
import config from "../../config.js";
import { request } from "@rapidrest/service-core/test";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager, RateLimiter, ACLAction } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { BookingMongo } from "../../../src/models/mongo/BookingMongo.js";
import { BookingProfileMongo } from "../../../src/models/mongo/BookingProfileMongo.js";
import { BookingTypeMongo } from "../../../src/models/mongo/BookingTypeMongo.js";
import { CalendarEventMongo, FolderMongo, MailboxMongo } from "@rapidmx/restapi/mongo";
import { BusyStatus, CalendarEventStatus, FolderType, RecipientType, RecurrenceFrequency } from "@rapidmx/restapi";
import { BookingLocationType, BookingStatus } from "../../../src/models/types.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { VideoMeetingMongo, VideoMeetingInviteeMongo } from "@rapidmx/meet-plugin/mongo";
import { RecordingMailTransport, registerTestDoubles } from "../../testDoubles.js";
import { bookingSecuritySuite } from "../bookingSecuritySuite.js";
import { bookingMailboxSuite } from "../bookingMailboxSuite.js";
import { bookingVideoconfIntegrationSuite } from "../bookingVideoconfIntegrationSuite.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

// Every slot below sits on one fixed, far-future date so that it is always in the future no matter when the
// suite runs, WITHOUT freezing the clock. Freezing it with `vi.useFakeTimers({ toFake: ["Date"] })` is
// deliberately avoided here and in the SQL twin: with a mocked global `Date`, TypeORM's SQLite driver hydrates
// `datetime` columns back as raw strings rather than `Date` objects, so any date arithmetic the route performs
// on a row it just read (`expandOccurrences()`, for one) throws. The fixture booking type is available every
// day of the week, so the weekday of this date is deliberately irrelevant. New York is UTC-4 in June, so its
// 09:00-11:00 local window is 13:00Z-15:00Z.
const SLOT_1 = "2099-06-01T13:00:00.000Z";
const SLOT_2 = "2099-06-01T14:00:00.000Z";
const NEXT_DAY_SLOT_1 = "2099-06-02T13:00:00.000Z";
const NOT_A_SLOT = "2099-06-01T13:30:00.000Z";
const WINDOW_FROM = "2099-06-01T00:00:00.000Z";
const WINDOW_TO = "2099-06-02T00:00:00.000Z";
// One week before SLOT_1, for the weekly-recurrence test - a series whose own row starts outside the window.
const WEEK_BEFORE_START = "2099-05-25T13:00:00.000Z";
const WEEK_BEFORE_END = "2099-05-25T14:00:00.000Z";
// 11:00-12:00 local, immediately after the last slot - only reachable via a trailing buffer.
const AFTER_LAST_SLOT_START = "2099-06-01T15:00:00.000Z";
const AFTER_LAST_SLOT_END = "2099-06-01T16:00:00.000Z";

describe("Route:BookingMongo Tests (anonymous)", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-mongo", logger, objectFactory });
    const baseUrl = "/mongo/bookings";
    let mailboxRepo: MongoRepository<MailboxMongo>;
    let folderRepo: MongoRepository<FolderMongo>;
    let bookingTypeRepo: MongoRepository<BookingTypeMongo>;
    let bookingRepo: MongoRepository<BookingMongo>;
    let bookingProfileRepo: MongoRepository<BookingProfileMongo>;
    let calendarEventRepo: MongoRepository<CalendarEventMongo>;
    // `@rapidmx/meet-plugin`'s own models, registered via `test/server-mongo/models/index.ts` - used only by
    // `bookingVideoconfIntegrationSuite`'s real, end-to-end coverage of the optional video meeting integration.
    let videoMeetingRepo: MongoRepository<VideoMeetingMongo>;
    let videoMeetingInviteeRepo: MongoRepository<VideoMeetingInviteeMongo>;
    let aclRepo: MongoRepository<any>;
    let mailTransport: RecordingMailTransport;

    let mailbox: MailboxMongo;
    let calendarFolder: FolderMongo;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);
    const otherUser: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const otherUserToken = JWTUtils.createTokenSync(config.get("auth"), otherUser);

    const createBookingType = async function (data?: any): Promise<BookingTypeMongo> {
        return await bookingTypeRepo.save(
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
                        locationOptions: [{ uid: "lo-default", type: BookingLocationType.VIDEO, videoUrl: "https://meet.example.com/ada" }],
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
                ...data,
            }),
        );
    };

    const createEvent = async function (data?: any): Promise<CalendarEventMongo> {
        return await calendarEventRepo.save(
            new CalendarEventMongo({
                folderUid: calendarFolder.uid,
                mailboxUid: mailbox.uid,
                title: "Existing",
                startDate: new Date(SLOT_1),
                endDate: new Date(SLOT_2),
                allDay: false,
                timezone: "UTC",
                organizer: { address: mailbox.primarySmtpAddress, type: RecipientType.TO },
                attendees: [],
                status: CalendarEventStatus.CONFIRMED,
                busyStatus: BusyStatus.BUSY,
                icalUid: uuid.v4(),
                sequence: 0,
                ...data,
            }),
        );
    };

    const book = (slug: string, body: any) => request(server.getApplication()).post(`${baseUrl}/types/${mailbox.uid}/${slug}`).send(body);

    const validBooking = (start: string = SLOT_1) => ({
        start,
        meetingTypeUid: "mt-default",
        locationOptionUid: "lo-default",
        bookerName: "Grace Hopper",
        bookerEmail: "Grace@Example.com",
        bookerNotes: "Looking forward to it.",
        bookerTimezone: "America/Chicago",
    });

    beforeAll(async () => {
        await mongod.start();
        registerTestDoubles(objectFactory);
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getMongoRepository("AccessControlListMongo");
        }
        conn = connMgr?.connections.get("mongo");
        if (conn instanceof MongoConnection) {
            mailboxRepo = conn.getMongoRepository("MailboxMongo");
            folderRepo = conn.getMongoRepository("FolderMongo");
            bookingTypeRepo = conn.getMongoRepository("BookingTypeMongo");
            bookingRepo = conn.getMongoRepository("BookingMongo");
            bookingProfileRepo = conn.getMongoRepository("BookingProfileMongo");
            calendarEventRepo = conn.getMongoRepository("CalendarEventMongo");
            videoMeetingRepo = conn.getMongoRepository("VideoMeetingMongo");
            videoMeetingInviteeRepo = conn.getMongoRepository("VideoMeetingInviteeMongo");
        } else {
            throw new Error("Could not find mongo connection");
        }
        mailTransport = objectFactory.getInstance<RecordingMailTransport>("MailTransport")!;
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        for (const repo of [
            mailboxRepo,
            folderRepo,
            bookingTypeRepo,
            bookingRepo,
            bookingProfileRepo,
            calendarEventRepo,
            videoMeetingRepo,
            videoMeetingInviteeRepo,
        ]) {
            try {
                await repo.clear();
            } catch (err: any) {
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
        }
        mailTransport.sent = [];

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
            new FolderMongo({
                mailboxUid: mailbox.uid,
                name: "Calendar",
                type: FolderType.CALENDAR,
                unreadCount: 0,
                totalCount: 0,
                syncKeyVersion: 0,
            }),
        );
        // Grants `owner` access to the fixture mailbox, for the host-only `/host` endpoint tests below - every
        // other test in this file is anonymous and never touches the ACL.
        await aclRepo.save({
            uid: mailbox.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records: [{ userOrRoleId: owner.uid, actions: [ACLAction.FULL] }],
            parentUid: "Mailbox",
        });
    });

    describe("GET /types/:mailboxUid/:slug", () => {
        it("Returns the public details of an enabled booking type, and no internal identifier (the mailbox address is part of the link).", async () => {
            const bookingType = await createBookingType();

            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}`);

            expect(result.status).toBe(200);
            expect(result.body.name).toBe("Intro Call");
            expect(result.body.hostDisplayName).toBe("Ada Lovelace");
            expect(result.body.meetingTypes).toEqual([
                {
                    uid: "mt-default",
                    name: "Intro Call",
                    durationMinutes: 60,
                    locationOptions: [{ uid: "lo-default", type: BookingLocationType.VIDEO }],
                },
            ]);
            expect(result.body.mailboxUid).toBe(mailbox.uid);
            expect(result.body.calendarFolderUid).toBeUndefined();
        });

        it("Returns 404 for a slug that does not exist.", async () => {
            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/nope`);

            expect(result.status).toBe(404);
        });

        it("Returns 404 for a disabled booking type, so a paused link looks like one that never existed.", async () => {
            const bookingType = await createBookingType({ enabled: false });

            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}`);

            expect(result.status).toBe(404);
        });
    });

    describe("GET /types/:mailboxUid/:slug/slots", () => {
        it("Lists the slots the booking type's availability allows.", async () => {
            const bookingType = await createBookingType();

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.status).toBe(200);
            expect(result.body.map((slot: any) => slot.start)).toEqual([SLOT_1, SLOT_2]);
        });

        it("Omits a slot the host is already busy for.", async () => {
            const bookingType = await createBookingType();
            await createEvent();

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.body.map((slot: any) => slot.start)).toEqual([SLOT_2]);
        });

        it("Ignores an event marked free, which does not really occupy the host.", async () => {
            const bookingType = await createBookingType();
            await createEvent({ busyStatus: BusyStatus.FREE });

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.body.map((slot: any) => slot.start)).toEqual([SLOT_1, SLOT_2]);
        });

        it("Expands a recurring busy series so a later occurrence blocks its slot too.", async () => {
            const bookingType = await createBookingType();
            // A weekly 09:00-10:00 New York series starting the Monday BEFORE the window - query 1 can never
            // see it, so this only passes because the recurring-master query exists.
            await createEvent({
                startDate: new Date(WEEK_BEFORE_START),
                endDate: new Date(WEEK_BEFORE_END),
                recurrenceRule: { freq: RecurrenceFrequency.WEEKLY, interval: 1 },
            });

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.body.map((slot: any) => slot.start)).toEqual([SLOT_2]);
        });

        it("Applies the configured buffers, which can knock out an otherwise free adjacent slot.", async () => {
            const bookingType = await createBookingType({ bufferAfterMinutes: 30 });
            // Busy 11:00-12:00 local (15:00-16:00Z) - only the 10:00 slot's trailing buffer reaches it.
            await createEvent({
                startDate: new Date(AFTER_LAST_SLOT_START),
                endDate: new Date(AFTER_LAST_SLOT_END),
            });

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.body.map((slot: any) => slot.start)).toEqual([SLOT_1]);
        });

        it("Defaults the window when no from/to is supplied.", async () => {
            const bookingType = await createBookingType();

            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default`);

            expect(result.status).toBe(200);
            expect(result.body.length).toBeGreaterThan(0);
        });

        it("Returns an empty list, without touching the calendar, when the configuration allows nothing.", async () => {
            const bookingType = await createBookingType({ availability: [] });

            const result = await request(server.getApplication()).get(
                `${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
            );

            expect(result.body).toEqual([]);
        });

        it("Rejects an unparseable from (400).", async () => {
            const bookingType = await createBookingType();

            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&from=yesterday`);

            expect(result.status).toBe(400);
        });

        it("Rejects an unparseable to (400).", async () => {
            const bookingType = await createBookingType();

            const result = await request(server.getApplication()).get(`${baseUrl}/types/${mailbox.uid}/${bookingType.slug}/slots?meetingTypeUid=mt-default&to=someday`);

            expect(result.status).toBe(400);
        });
    });

    describe("POST /types/:mailboxUid/:slug", () => {
        it("Books a slot, creating the calendar event and mailing the booker an invite with their manage link.", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(200);
            expect(result.body.status).toBe(BookingStatus.CONFIRMED);
            expect(result.body.startDate).toBe(SLOT_1);
            expect(result.body.manageToken).toBeTruthy();
            // The address is normalized on the way in.
            expect(result.body.bookerEmail).toBe("grace@example.com");
            expect(result.body.meetingTypeUid).toBe("mt-default");
            expect(result.body.meetingTypeName).toBe("Intro Call");
            expect(result.body.locationType).toBe(BookingLocationType.VIDEO);
            expect(result.body.locationVideoUrl).toBe("https://meet.example.com/ada");

            const events = await calendarEventRepo.find({}).toArray();
            expect(events).toHaveLength(1);
            expect(events[0].title).toBe("Intro Call with Grace Hopper");
            expect(events[0].status).toBe(CalendarEventStatus.CONFIRMED);
            expect(events[0].busyStatus).toBe(BusyStatus.BUSY);
            expect(events[0].icalUid).not.toBe("");
            expect(events[0].attendees[0].address).toBe("grace@example.com");
            // Stamped so MeetingSchedulingJob doesn't send a second, generic invite for the same revision.
            expect(events[0].inviteSequenceSent).toBe(events[0].sequence);

            expect(mailTransport.sent).toHaveLength(1);
            expect(mailTransport.sent[0].envelopeTo).toEqual(["grace@example.com"]);
            const raw: string = mailTransport.sent[0].raw.toString();
            expect(raw).toContain(`/manage/${result.body.manageToken}`);
            expect(raw).toMatch(/^From: "?Ada Lovelace"? </m);
        });

        it("Leaves an address-like host display name out of the booking mail's From, organizer name and text.", async () => {
            const bookingType = await createBookingType({ hostDisplayName: "ceo＠bank.example" });

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(200);
            const raw: string = mailTransport.sent[0].raw.toString();
            expect(raw).toMatch(new RegExp(`^From: <?${mailbox.primarySmtpAddress}>?\\r?$`, "m"));
            expect(raw).toContain(`ORGANIZER:mailto:${mailbox.primarySmtpAddress}`);
            expect(raw).not.toContain("bank.example");
            expect(raw).not.toContain("=EF=BC=A0");
        });

        it("Leaves a booking pending and its event tentative when the booking type requires approval.", async () => {
            const bookingType = await createBookingType({ requiresApproval: true });

            const result = await book(bookingType.slug, validBooking());

            expect(result.body.status).toBe(BookingStatus.PENDING);
            const events = await calendarEventRepo.find({}).toArray();
            expect(events[0].status).toBe(CalendarEventStatus.TENTATIVE);
            expect(events[0].busyStatus).toBe(BusyStatus.TENTATIVE);
        });

        it("Rejects a start that is not one of the offered slots (409).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, validBooking(NOT_A_SLOT));

            expect(result.status).toBe(409);
        });

        it("Rejects a slot the host became busy for after the page was loaded (409).", async () => {
            const bookingType = await createBookingType();
            await createEvent();

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(409);
        });

        it("Rejects a second booking of the very same slot (409).", async () => {
            const bookingType = await createBookingType();
            expect((await book(bookingType.slug, validBooking())).status).toBe(200);

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(409);
        });

        it("Rejects a booking on a day already at maxPerDay (409).", async () => {
            const bookingType = await createBookingType({ maxPerDay: 1 });
            expect((await book(bookingType.slug, validBooking(SLOT_1))).status).toBe(200);

            const result = await book(bookingType.slug, validBooking(SLOT_2));

            expect(result.status).toBe(409);
        });

        it("Still allows a booking on the next day when the previous day is at maxPerDay.", async () => {
            const bookingType = await createBookingType({ maxPerDay: 1 });
            expect((await book(bookingType.slug, validBooking(SLOT_1))).status).toBe(200);

            const result = await book(bookingType.slug, validBooking(NEXT_DAY_SLOT_1));

            expect(result.status).toBe(200);
        });

        it("Rejects a missing bookerName (400).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, { ...validBooking(), bookerName: "   " });

            expect(result.status).toBe(400);
        });

        it("Rejects a malformed bookerEmail (400).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, { ...validBooking(), bookerEmail: "not-an-address" });

            expect(result.status).toBe(400);
        });

        it("Rejects a missing start (400).", async () => {
            const bookingType = await createBookingType();
            const body: any = validBooking();
            delete body.start;

            const result = await book(bookingType.slug, body);

            expect(result.status).toBe(400);
        });

        it("Rejects a request with no body at all (400).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, undefined);

            expect(result.status).toBe(400);
        });

        it("Returns 404 for a disabled booking type.", async () => {
            const bookingType = await createBookingType({ enabled: false });

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(404);
        });

        it("Returns 500 when the booking type points at a mailbox that no longer exists.", async () => {
            const bookingType = await createBookingType();
            await mailboxRepo.clear();

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(500);
        });
    });

    describe("meeting types and locations", () => {
        it("Rejects a missing meetingTypeUid (400).", async () => {
            const bookingType = await createBookingType();
            const body: any = validBooking();
            delete body.meetingTypeUid;

            const result = await book(bookingType.slug, body);

            expect(result.status).toBe(400);
        });

        it("Rejects a meetingTypeUid that names none of the booking type's meeting types (400).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, { ...validBooking(), meetingTypeUid: "no-such-meeting-type" });

            expect(result.status).toBe(400);
        });

        it("Rejects a missing locationOptionUid (400).", async () => {
            const bookingType = await createBookingType();
            const body: any = validBooking();
            delete body.locationOptionUid;

            const result = await book(bookingType.slug, body);

            expect(result.status).toBe(400);
        });

        it("Rejects a locationOptionUid that names none of the meeting type's location options (400).", async () => {
            const bookingType = await createBookingType();

            const result = await book(bookingType.slug, { ...validBooking(), locationOptionUid: "no-such-location" });

            expect(result.status).toBe(400);
        });

        it("Rejects booking a phone location without a bookerPhone (400).", async () => {
            const bookingType = await createBookingType({
                meetingTypes: [
                    {
                        uid: "mt-phone",
                        name: "Phone Call",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-phone", type: BookingLocationType.PHONE }],
                    },
                ],
            });

            const result = await book(bookingType.slug, { ...validBooking(), meetingTypeUid: "mt-phone", locationOptionUid: "lo-phone" });

            expect(result.status).toBe(400);
        });

        it("Books a phone location when bookerPhone is supplied.", async () => {
            const bookingType = await createBookingType({
                meetingTypes: [
                    {
                        uid: "mt-phone",
                        name: "Phone Call",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-phone", type: BookingLocationType.PHONE }],
                    },
                ],
            });

            const result = await book(bookingType.slug, {
                ...validBooking(),
                meetingTypeUid: "mt-phone",
                locationOptionUid: "lo-phone",
                bookerPhone: "555-123-4567",
            });

            expect(result.status).toBe(200);
            expect(result.body.locationType).toBe(BookingLocationType.PHONE);
            expect(result.body.bookerPhone).toBe("555-123-4567");
        });

        it("Rejects booking an other location without bookerLocationInstructions (400).", async () => {
            const bookingType = await createBookingType({
                meetingTypes: [
                    {
                        uid: "mt-other",
                        name: "In Person",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-other", type: BookingLocationType.OTHER }],
                    },
                ],
            });

            const result = await book(bookingType.slug, { ...validBooking(), meetingTypeUid: "mt-other", locationOptionUid: "lo-other" });

            expect(result.status).toBe(400);
        });

        it("Books an other location when bookerLocationInstructions is supplied.", async () => {
            const bookingType = await createBookingType({
                meetingTypes: [
                    {
                        uid: "mt-other",
                        name: "In Person",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-other", type: BookingLocationType.OTHER }],
                    },
                ],
            });

            const result = await book(bookingType.slug, {
                ...validBooking(),
                meetingTypeUid: "mt-other",
                locationOptionUid: "lo-other",
                bookerLocationInstructions: "Meet at the coffee shop on 5th.",
            });

            expect(result.status).toBe(200);
            expect(result.body.locationType).toBe(BookingLocationType.OTHER);
            expect(result.body.bookerLocationInstructions).toBe("Meet at the coffee shop on 5th.");
        });
    });

    describe("GET /manage/:token", () => {
        it("Returns the booker's own view of their booking, without re-issuing the token.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());

            const result = await request(server.getApplication()).get(`${baseUrl}/manage/${created.body.manageToken}`);

            expect(result.status).toBe(200);
            expect(result.body.uid).toBe(created.body.uid);
            expect(result.body.bookingTypeSlug).toBe(bookingType.slug);
            expect(result.body.bookerNotes).toBe("Looking forward to it.");
            expect(result.body.manageToken).toBeUndefined();
        });

        it("Returns 404 for a token that matches nothing.", async () => {
            const result = await request(server.getApplication()).get(`${baseUrl}/manage/${uuid.v4()}`);

            expect(result.status).toBe(404);
        });

        it("Returns 404 when the booking's own booking type has been deleted.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await bookingTypeRepo.clear();

            const result = await request(server.getApplication()).get(`${baseUrl}/manage/${created.body.manageToken}`);

            expect(result.status).toBe(404);
        });
    });

    describe("POST /manage/:token/cancel", () => {
        it("Cancels the booking and marks its event cancelled, leaving the iTIP CANCEL to MeetingSchedulingJob.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());

            const result = await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            expect(result.status).toBe(200);
            expect(result.body.status).toBe(BookingStatus.CANCELLED);

            const booking = (await bookingRepo.find({ uid: created.body.uid }).toArray())[0];
            expect(booking.cancelledAt).toBeTruthy();
            const events = await calendarEventRepo.find({}).toArray();
            expect(events[0].status).toBe(CalendarEventStatus.CANCELLED);
            expect(events[0].cancelNoticeSentAt).toBeFalsy();
        });

        it("Frees the slot up again for someone else.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            const result = await book(bookingType.slug, validBooking());

            expect(result.status).toBe(200);
        });

        it("Is idempotent - a second cancel returns the same answer rather than an error.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            const result = await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            expect(result.status).toBe(200);
            expect(result.body.status).toBe(BookingStatus.CANCELLED);
        });

        it("Returns 404 for a token that matches nothing.", async () => {
            const result = await request(server.getApplication()).post(`${baseUrl}/manage/${uuid.v4()}/cancel`);

            expect(result.status).toBe(404);
        });

        it("Returns 404 when the booking's own booking type has been deleted.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await bookingTypeRepo.clear();

            const result = await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            expect(result.status).toBe(404);
        });

        it("Still cancels the booking when its calendar event has already been deleted.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await calendarEventRepo.clear();

            const result = await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            expect(result.status).toBe(200);
            expect(result.body.status).toBe(BookingStatus.CANCELLED);
        });
    });

    describe("POST /manage/:token/reschedule", () => {
        const reschedule = (token: string, body: any) =>
            request(server.getApplication()).post(`${baseUrl}/manage/${token}/reschedule`).send(body);

        it("Moves the booking and its event to the new slot, bumps the sequence and re-sends the invite.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking(SLOT_1));
            mailTransport.sent = [];

            const result = await reschedule(created.body.manageToken, { start: SLOT_2 });

            expect(result.status).toBe(200);
            expect(result.body.startDate).toBe(SLOT_2);

            const events = await calendarEventRepo.find({}).toArray();
            expect(events).toHaveLength(1);
            expect(events[0].startDate.toISOString()).toBe(SLOT_2);
            expect(events[0].sequence).toBe(1);
            expect(events[0].inviteSequenceSent).toBe(1);
            expect(mailTransport.sent).toHaveLength(1);
        });

        it("Does not treat the booking's own event as a conflict with itself.", async () => {
            const bookingType = await createBookingType({ bufferBeforeMinutes: 120, bufferAfterMinutes: 120 });
            const created = await book(bookingType.slug, validBooking(SLOT_1));

            // Rescheduling onto the very same slot would collide with its own event were it not excluded.
            const result = await reschedule(created.body.manageToken, { start: SLOT_1 });

            expect(result.status).toBe(200);
        });

        it("Rejects a new start that is not an offered slot (409).", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());

            const result = await reschedule(created.body.manageToken, { start: NOT_A_SLOT });

            expect(result.status).toBe(409);
        });

        it("Rejects a missing start (400).", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());

            const result = await reschedule(created.body.manageToken, {});

            expect(result.status).toBe(400);
        });

        it("Rejects rescheduling a cancelled booking (400).", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await request(server.getApplication()).post(`${baseUrl}/manage/${created.body.manageToken}/cancel`);

            const result = await reschedule(created.body.manageToken, { start: SLOT_2 });

            expect(result.status).toBe(400);
        });

        it("Returns 404 for a token that matches nothing.", async () => {
            const result = await reschedule(uuid.v4(), { start: SLOT_2 });

            expect(result.status).toBe(404);
        });

        it("Returns 404 once the booking type has been disabled.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await bookingTypeRepo.updateOne({ uid: bookingType.uid }, { $set: { enabled: false } });

            const result = await reschedule(created.body.manageToken, { start: SLOT_2 });

            expect(result.status).toBe(404);
        });

        it("Returns 404 when the booking's calendar event has been deleted out from under it.", async () => {
            const bookingType = await createBookingType();
            const created = await book(bookingType.slug, validBooking());
            await calendarEventRepo.clear();

            const result = await reschedule(created.body.manageToken, { start: SLOT_2 });

            expect(result.status).toBe(404);
        });
    });

    it("Provisions the calendar folder itself when the mailbox does not have one yet.", async () => {
        const bookingType = await createBookingType();
        await folderRepo.clear();

        const result = await book(bookingType.slug, validBooking());

        expect(result.status).toBe(200);
        const folders = await folderRepo.find({}).toArray();
        expect(folders).toHaveLength(1);
        expect(folders[0].type).toBe(FolderType.CALENDAR);
    });

    it("Rate limits repeated booking attempts against the same booking type (429).", async () => {
        // Proves `@RateLimit()` is actually wired onto this endpoint. The shared `rateLimit` config is set
        // deliberately high for the rest of the suite (see test/config-defaults.ts), so this narrows it for
        // one test only, and disables the per-IP layer so the counter under test is unambiguously the
        // per-`METHOD path` one the decorator keys on.
        const rateLimiter: any = objectFactory.getInstance(RateLimiter);
        const original = rateLimiter.config;
        rateLimiter.config = { enabled: true, maxAttempts: 2, windowSeconds: 300, ip: { enabled: false } };
        try {
            const bookingType = await createBookingType();

            expect((await book(bookingType.slug, validBooking(SLOT_1))).status).toBe(200);
            expect((await book(bookingType.slug, validBooking(SLOT_2))).status).toBe(200);
            const third = await book(bookingType.slug, validBooking(NEXT_DAY_SLOT_1));

            expect(third.status).toBe(429);
        } finally {
            rateLimiter.config = original;
        }
    });

    it("Logs rather than throws when the mail transport refuses the confirmation's recipient.", async () => {
        const bookingType = await createBookingType();

        const result = await book(bookingType.slug, { ...validBooking(), bookerEmail: "reject@example.com" });

        // The booking itself has already been committed - a mail failure must not be surfaced to the booker.
        expect(result.status).toBe(200);
        expect(mailTransport.sent).toHaveLength(0);
    });

    it("Logs rather than throws when sending the confirmation fails outright.", async () => {
        const bookingType = await createBookingType();
        vi.spyOn(mailTransport, "send").mockRejectedValueOnce(new Error("smtp is down"));

        const result = await book(bookingType.slug, validBooking());

        // Same reasoning as above, for the harder failure: the write has already been committed by the time
        // the mail is attempted, so there is nothing a thrown error could usefully undo.
        expect(result.status).toBe(200);
        expect(mailTransport.sent).toHaveLength(0);
    });

    describe("host endpoints", () => {
        describe("GET /host", () => {
            it("Lists the booking type's bookings for the mailbox owner.", async () => {
                const bookingType = await createBookingType();
                const created = await book(bookingType.slug, validBooking());
                expect(created.status).toBe(200);

                const result = await request(server.getApplication())
                    .get(`${baseUrl}/host?bookingTypeUid=${bookingType.uid}`)
                    .set("Authorization", "jwt " + ownerToken);

                expect(result.status).toBe(200);
                expect(result.body).toHaveLength(1);
                expect(result.body[0].uid).toBe(created.body.uid);
            });

            it("Rejects a caller without access to the booking type's mailbox (403).", async () => {
                const bookingType = await createBookingType();

                const result = await request(server.getApplication())
                    .get(`${baseUrl}/host?bookingTypeUid=${bookingType.uid}`)
                    .set("Authorization", "jwt " + otherUserToken);

                expect(result.status).toBe(403);
            });
        });

        describe("POST /host/:uid/location", () => {
            it("Lets the mailbox owner set a video booking's location URL.", async () => {
                const bookingType = await createBookingType();
                const created = await book(bookingType.slug, validBooking());

                const result = await request(server.getApplication())
                    .post(`${baseUrl}/host/${created.body.uid}/location`)
                    .set("Authorization", "jwt " + ownerToken)
                    .send({ locationVideoUrl: "https://meet.example.com/new" });

                expect(result.status).toBe(200);
                expect(result.body.locationVideoUrl).toBe("https://meet.example.com/new");
            });

            it("Rejects a caller without access to the booking's mailbox (403).", async () => {
                const bookingType = await createBookingType();
                const created = await book(bookingType.slug, validBooking());

                const result = await request(server.getApplication())
                    .post(`${baseUrl}/host/${created.body.uid}/location`)
                    .set("Authorization", "jwt " + otherUserToken)
                    .send({ locationVideoUrl: "https://meet.example.com/new" });

                expect(result.status).toBe(403);
            });

            it("Rejects setting a video URL on a booking whose location is not video (400).", async () => {
                const bookingType = await createBookingType({
                    meetingTypes: [
                        {
                            uid: "mt-phone",
                            name: "Phone Call",
                            durationMinutes: 60,
                            locationOptions: [{ uid: "lo-phone", type: BookingLocationType.PHONE }],
                        },
                    ],
                });
                const created = await book(bookingType.slug, {
                    ...validBooking(),
                    meetingTypeUid: "mt-phone",
                    locationOptionUid: "lo-phone",
                    bookerPhone: "555-123-4567",
                });

                const result = await request(server.getApplication())
                    .post(`${baseUrl}/host/${created.body.uid}/location`)
                    .set("Authorization", "jwt " + ownerToken)
                    .send({ locationVideoUrl: "https://meet.example.com/new" });

                expect(result.status).toBe(400);
            });
        });
    });

    bookingSecuritySuite({
        app: () => server.getApplication(),
        baseUrl,
        mailboxUid: () => mailbox.uid,
        calendarFolderUid: () => calendarFolder.uid,
        createBookingType,
        createEvent,
        createEvents: async (data: any[]) => {
            for (let i = 0; i < data.length; i += 50) {
                await Promise.all(data.slice(i, i + 50).map((d) => createEvent(d)));
            }
        },
        createFolder: async (data: any) =>
            await folderRepo.save(new FolderMongo({ unreadCount: 0, totalCount: 0, syncKeyVersion: 0, ...data })),
        findEvents: async () => await calendarEventRepo.find({}).toArray(),
        updateEvent: async (uid: string, patch: any) => {
            await calendarEventRepo.updateOne({ uid }, { $set: patch });
        },
        findBookings: async () => await bookingRepo.find({}).toArray(),
        rateLimiter: () => objectFactory.getInstance(RateLimiter),
    });
    bookingMailboxSuite({
        app: () => server.getApplication(),
        baseUrl,
        mailboxUid: () => mailbox.uid,
        createBookingType,
        createOtherMailbox: async (uid?: string) => {
            const other: MailboxMongo = await mailboxRepo.save(
                new MailboxMongo({
                    ...(uid ? { uid } : {}),
                    ownerUserUid: uuid.v4(),
                    primarySmtpAddress: `grace-${uuid.v4()}@example.com`,
                    aliasAddresses: [],
                    displayName: "Grace Hopper",
                    timezone: "UTC",
                    quotaBytes: 1_000_000_000,
                    usedBytes: 0,
                }),
            );
            const folder: FolderMongo = await folderRepo.save(
                new FolderMongo({ mailboxUid: other.uid, name: "Calendar", type: FolderType.CALENDAR, unreadCount: 0, totalCount: 0, syncKeyVersion: 0 }),
            );
            return { uid: other.uid, calendarFolderUid: folder.uid };
        },
        createProfile: async (mailboxUid: string, data: any) => {
            await bookingProfileRepo.save(new BookingProfileMongo({ uid: mailboxUid, mailboxUid, ...data }));
        },
        findBookings: async () => await bookingRepo.find({}).toArray(),
        rateLimiter: () => objectFactory.getInstance(RateLimiter),
        route: () => objectFactory.getInstance("routes.BookingRoute"),
    });
    bookingVideoconfIntegrationSuite({
        app: () => server.getApplication(),
        baseUrl,
        mailboxUid: () => mailbox.uid,
        createBookingType,
        findBookings: async () => await bookingRepo.find({}).toArray(),
        findVideoMeetings: async () => await videoMeetingRepo.find({}).toArray(),
        findVideoMeetingInvitees: async () => await videoMeetingInviteeRepo.find({}).toArray(),
    });
});
