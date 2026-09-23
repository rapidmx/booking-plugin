///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import config from "../../config.js";
import { MongoConnection, MongoRepository, Server, ObjectFactory, ConnectionManager, ACLAction } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { BookingProfileMongo } from "../../../src/models/mongo/BookingProfileMongo.js";
import { MailboxMongo } from "@rapidmx/restapi/mongo";
import { MongoMemoryServer } from "mongodb-memory-server";
import { registerTestDoubles, type InMemoryBlobStore } from "../../testDoubles.js";
import { bookingProfileSuite } from "../bookingProfileSuite.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("Route:BookingProfileMongo Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-mongo", logger, objectFactory });
    const baseUrl = "/mongo/booking-profiles";
    let mailboxRepo: MongoRepository<MailboxMongo>;
    let profileRepo: MongoRepository<BookingProfileMongo>;
    let aclRepo: MongoRepository<any>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);
    const stranger: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const strangerToken = JWTUtils.createTokenSync(config.get("auth"), stranger);
    const viewer: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const viewerToken = JWTUtils.createTokenSync(config.get("auth"), viewer);
    const admin: any = { uid: uuid.v4(), roles: ["admin"], elevated: Date.now() };
    const adminToken = JWTUtils.createTokenSync(config.get("auth"), admin);

    /** A mailbox with an ACL granting `grants` (user or role id to actions), as the mailbox routes write them. */
    const createMailbox = async function (ownerUid: string | undefined, grants: { userOrRoleId: string; actions: string[] }[]): Promise<MailboxMongo> {
        const result: MailboxMongo = await mailboxRepo.save(
            new MailboxMongo({
                ...(ownerUid ? { ownerUserUid: ownerUid } : {}),
                primarySmtpAddress: `${uuid.v4()}@example.com`,
                aliasAddresses: [],
                displayName: "Test Mailbox",
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
            records: grants,
            parentUid: "Mailbox",
        });
        return result;
    };

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
            profileRepo = conn.getMongoRepository("BookingProfileMongo");
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
        for (const repo of [mailboxRepo, profileRepo]) {
            try {
                await repo.clear();
            } catch (err: any) {
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
        }
    });

    bookingProfileSuite({
        app: () => server.getApplication(),
        baseUrl,
        ownerUid: owner.uid,
        ownerToken,
        strangerToken,
        viewerUid: viewer.uid,
        viewerToken,
        adminToken,
        createMailbox: (ownerUid: string) => createMailbox(ownerUid, [{ userOrRoleId: ownerUid, actions: [ACLAction.FULL] }]),
        createSharedMailbox: (userUid: string, actions: string[]) => createMailbox(undefined, [{ userOrRoleId: userUid, actions }]),
        deleteMailboxRow: async (mailboxUid: string) => {
            await mailboxRepo.deleteOne({ uid: mailboxUid });
        },
        findProfile: async (uid: string) => (await profileRepo.findOne({ uid })) ?? undefined,
        saveProfile: async (data: any) => {
            await profileRepo.save(new BookingProfileMongo(data));
        },
        blobStore: () => objectFactory.getInstance<InMemoryBlobStore>("BlobStore")!,
        route: () => objectFactory.getInstance("routes.BookingProfileRoute"),
    });
});
