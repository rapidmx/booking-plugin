///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import config from "../../config.sql.js";
import { Server, ObjectFactory, ConnectionManager, ACLAction, AccessControlListSQL, isSqlDataSource } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import { Repository } from "typeorm";
import { BookingProfileSQL } from "../../../src/models/sql/BookingProfileSQL.js";
import { MailboxSQL } from "@rapidmx/restapi/sql";
import { registerTestDoubles, type InMemoryBlobStore } from "../../testDoubles.js";
import { bookingProfileSuite } from "../bookingProfileSuite.js";

describe("Route:BookingProfileSQL Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server-sql", logger, objectFactory });
    const baseUrl = "/sql/booking-profiles";
    let mailboxRepo: Repository<MailboxSQL>;
    let profileRepo: Repository<BookingProfileSQL>;
    let aclRepo: Repository<AccessControlListSQL>;

    const owner: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const ownerToken = JWTUtils.createTokenSync(config.get("auth"), owner);
    const stranger: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const strangerToken = JWTUtils.createTokenSync(config.get("auth"), stranger);
    const viewer: any = { uid: uuid.v4(), roles: [], elevated: Date.now() };
    const viewerToken = JWTUtils.createTokenSync(config.get("auth"), viewer);
    const admin: any = { uid: uuid.v4(), roles: ["admin"], elevated: Date.now() };
    const adminToken = JWTUtils.createTokenSync(config.get("auth"), admin);

    /** A mailbox with an ACL granting `grants` (user or role id to actions), as the mailbox routes write them. */
    const createMailbox = async function (ownerUid: string | undefined, grants: { userOrRoleId: string; actions: string[] }[]): Promise<MailboxSQL> {
        const result: MailboxSQL = await mailboxRepo.save(
            new MailboxSQL({
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
            profileRepo = conn.getRepository(BookingProfileSQL);
        } else {
            throw new Error("Could not find sql connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        await profileRepo.clear();
        await mailboxRepo.clear();
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
        findProfile: async (uid: string) => (await profileRepo.findOneBy({ uid })) ?? undefined,
        saveProfile: async (data: any) => {
            await profileRepo.save(new BookingProfileSQL(data));
        },
        blobStore: () => objectFactory.getInstance<InMemoryBlobStore>("BlobStore")!,
        route: () => objectFactory.getInstance("routes.BookingProfileRoute"),
    });
});
