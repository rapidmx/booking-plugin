///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// The `./purge` hook a server runs when the plugin is uninstalled with its data: it deletes the profile images kept in the
// BlobStore by their recorded keys, and refuses to let the purge go on when it can't.
import fs from "fs";
import { onPurge, type PurgeContext } from "../src/purge.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const mongoModel = { className: "BookingProfileMongo", datastore: "mongo", kind: "mongo" as const, name: "booking_profile_mongo" };
const sqlModel = { className: "BookingProfileSQL", datastore: "sql", kind: "sql" as const, name: "booking_profile_sql" };
const otherModel = { className: "BookingMongo", datastore: "mongo", kind: "mongo" as const, name: "booking_mongo" };

/** A MongoConnection whose one collection holds `rows`. */
function mongoConnection(rows: Record<string, unknown>[]) {
    const find = vi.fn((_filter: unknown, _options: unknown) => ({ toArray: async () => rows }));
    const collection = vi.fn((_name: string) => ({ find }));
    return { connection: { db: { collection } }, collection, find };
}

/** A TypeORM DataSource with one table holding `rows` (or none at all). */
function sqlConnection(rows: Record<string, unknown>[], exists: boolean = true) {
    const release = vi.fn(async () => undefined);
    const query = vi.fn(async (_sql: string) => rows);
    const connection = {
        driver: { escape: (name: string) => `"${name}"` },
        createQueryRunner: () => ({ hasTable: async () => exists, release }),
        query,
    };
    return { connection, query, release };
}

function context(connections: Record<string, any>, models: PurgeContext["models"], blobStore?: PurgeContext["blobStore"]): PurgeContext {
    return { models, connection: (name: string) => connections[name], blobStore, logger: { info: vi.fn() } };
}

describe("onPurge", () => {
    it("deletes each image of every profile in a MongoDB collection, by its recorded key", async () => {
        const { connection, collection, find } = mongoConnection([
            { avatarBlobKey: "booking-profiles/avatar/1", bannerBlobKey: "booking-profiles/banner/1" },
            { avatarBlobKey: "booking-profiles/avatar/2", bannerBlobKey: null },
            { bannerBlobKey: "" },
            {},
        ]);
        const blobStore = { delete: vi.fn(async () => undefined) };
        const ctx = context({ mongo: connection }, [otherModel, mongoModel], blobStore);

        await onPurge(ctx);

        expect(collection).toHaveBeenCalledTimes(1);
        expect(collection).toHaveBeenCalledWith("booking_profile_mongo");
        expect(find).toHaveBeenCalledWith({}, { projection: { avatarBlobKey: 1, bannerBlobKey: 1 } });
        expect(blobStore.delete.mock.calls.map(([key]) => key)).toEqual(["booking-profiles/avatar/1", "booking-profiles/banner/1", "booking-profiles/avatar/2"]);
        expect(ctx.logger!.info).toHaveBeenCalledWith("Deleted 3 booking profile images.");
    });

    it("reads the keys of a SQL table with the driver's own quoting, including a schema, and closes the query runner", async () => {
        const { connection, query, release } = sqlConnection([{ avatarBlobKey: "booking-profiles/avatar/9", bannerBlobKey: null }]);
        const blobStore = { delete: vi.fn(async () => undefined) };
        await onPurge(context({ sql: connection }, [{ ...sqlModel, name: "booking.booking_profile_sql" }], blobStore));
        expect(query).toHaveBeenCalledWith('SELECT "avatarBlobKey", "bannerBlobKey" FROM "booking"."booking_profile_sql"');
        expect(blobStore.delete).toHaveBeenCalledWith("booking-profiles/avatar/9");
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("has nothing to do for a SQL table that doesn't exist, or when no profile model is recorded", async () => {
        const { connection, query, release } = sqlConnection([], false);
        const blobStore = { delete: vi.fn(async () => undefined) };
        await onPurge(context({ sql: connection }, [sqlModel], blobStore));
        expect(query).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
        await onPurge(context({}, [otherModel], blobStore));
        await onPurge({ models: [], connection: () => undefined });
        expect(blobStore.delete).not.toHaveBeenCalled();
    });

    it("needs no BlobStore when there are no images", async () => {
        const { connection } = mongoConnection([{ avatarBlobKey: null }]);
        await expect(onPurge({ models: [mongoModel], connection: () => connection })).resolves.toBeUndefined();
    });

    it("aborts the purge, keeping the rows, when there are images and no BlobStore", async () => {
        const { connection } = mongoConnection([{ avatarBlobKey: "booking-profiles/avatar/1" }]);
        const error: any = await onPurge({ models: [mongoModel], connection: () => connection }).catch((err) => err);
        expect(error.name).toBe("AbortPurgeError");
        expect(error.message).toBe("1 booking profile images are stored, but the server has no BlobStore to delete them from.");
    });

    it("aborts the purge when an image can't be deleted, after trying every one", async () => {
        const { connection } = mongoConnection([{ avatarBlobKey: "a", bannerBlobKey: "b" }, { avatarBlobKey: "c", bannerBlobKey: "d" }, { avatarBlobKey: "e", bannerBlobKey: "f" }]);
        const blobStore = {
            delete: vi.fn(async (key: string) => {
                if (key !== "a" && key !== "e") {
                    throw new Error(`no access to ${key}`);
                }
            }),
        };
        const ctx = context({ mongo: connection }, [mongoModel], blobStore);
        const error: any = await onPurge(ctx).catch((err) => err);
        expect(error.name).toBe("AbortPurgeError");
        expect(error.message).toBe("Could not delete 4 of 6 booking profile images (b: no access to b; c: no access to c; d: no access to d).");
        expect(blobStore.delete).toHaveBeenCalledTimes(6);
        expect(ctx.logger!.info).not.toHaveBeenCalled();
    });

    it("works without a logger", async () => {
        const { connection } = mongoConnection([{ avatarBlobKey: "a" }]);
        await expect(onPurge({ models: [mongoModel], connection: () => connection, blobStore: { delete: async () => undefined } })).resolves.toBeUndefined();
    });
});

describe("the package", () => {
    it("exports the hook as ./purge, where the server looks for it", () => {
        expect(pkg.exports["./purge"]).toEqual({ import: "./dist/lib/purge.js", types: "./dist/types/purge.d.ts" });
    });
});
