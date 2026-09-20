///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// The booking profile (avatar and banner) endpoints - identical on both backends. Run from the BookingProfileRoute test
// files, which supply a started server and the fixtures.
import { request } from "@rapidrest/service-core/test";
import { ACLAction, RepoUtils } from "@rapidrest/service-core";
import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES } from "../../src/routes/BaseBookingProfileRoute.js";
import type { InMemoryBlobStore } from "../testDoubles.js";

export interface BookingProfileSuiteContext {
    app: () => any;
    baseUrl: string;
    ownerUid: string;
    ownerToken: string;
    /** A user with no access to any fixture mailbox. */
    strangerToken: string;
    viewerUid: string;
    viewerToken: string;
    /** A user with the trusted `admin` role, who passes every mailbox permission check - even for a mailbox that doesn't exist. */
    adminToken: string;
    /** A mailbox `ownerUid` has every permission on. */
    createMailbox: (ownerUid: string) => Promise<{ uid: string }>;
    /** An ownerless mailbox whose only ACL grant is `actions` for `userUid`. */
    createSharedMailbox: (userUid: string, actions: string[]) => Promise<{ uid: string }>;
    /** The stored profile row of `uid`, if any. */
    findProfile: (uid: string) => Promise<any | undefined>;
    /** Saves a profile row, with `data` on it. */
    saveProfile: (data: any) => Promise<void>;
    blobStore: () => InMemoryBlobStore;
    /** The mounted route instance, for the few branches HTTP can't reach. */
    route: () => any;
}

/** ASCII on purpose: the request helper hands the response body back as text. */
const png = (label: string = "one") => Buffer.from(`PNG-fake-image-bytes-${label}`);

export function bookingProfileSuite(ctx: BookingProfileSuiteContext): void {
    let mailbox: { uid: string };

    /** `null` is an anonymous caller (`undefined` would fall back to the default owner token). */
    const authed = (chain: any, token: string | null) => (token ? chain.set("Authorization", "jwt " + token) : chain);
    const view = (mailboxUid: string, token: string | null = ctx.ownerToken) =>
        authed(request(ctx.app()).get(`${ctx.baseUrl}/${mailboxUid}`), token);
    const upload = (mailboxUid: string, image: string, data: Buffer, contentType: string = "image/png", token: string | null = ctx.ownerToken) =>
        authed(request(ctx.app()).post(`${ctx.baseUrl}/${mailboxUid}/${image}`), token).set("Content-Type", contentType).send(data);
    const remove = (mailboxUid: string, image: string, token: string | null = ctx.ownerToken) =>
        authed(request(ctx.app()).delete(`${ctx.baseUrl}/${mailboxUid}/${image}`), token);
    const serve = (mailboxUid: string, image: string, query: string = "") => request(ctx.app()).get(`${ctx.baseUrl}/${mailboxUid}/${image}${query}`);
    const blobKeys = (image: string): string[] => [...ctx.blobStore().blobs.keys()].filter((key) => key.startsWith(`booking-profiles/${image}/`));
    const versionOf = (key: string): string => key.substring(key.lastIndexOf("/") + 1);

    beforeEach(async () => {
        mailbox = await ctx.createMailbox(ctx.ownerUid);
        ctx.blobStore().blobs.clear();
        ctx.blobStore().failNextDelete = false;
    });

    describe("permissions", () => {
        it("refuses a caller with no access to the mailbox, and an anonymous one, on every endpoint (403)", async () => {
            for (const token of [ctx.strangerToken, null]) {
                expect((await view(mailbox.uid, token)).status).toBe(403);
                for (const image of ["avatar", "banner"]) {
                    expect((await upload(mailbox.uid, image, png(), "image/png", token)).status).toBe(403);
                    expect((await remove(mailbox.uid, image, token)).status).toBe(403);
                }
            }
            expect(ctx.blobStore().blobs.size).toBe(0);
            expect(await ctx.findProfile(mailbox.uid)).toBeUndefined();
        });

        it("lets a caller who can only read the mailbox see the profile, but not change it (403)", async () => {
            const shared = await ctx.createSharedMailbox(ctx.viewerUid, [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS]);

            const seen = await view(shared.uid, ctx.viewerToken);
            expect(seen.status).toBe(200);
            expect(seen.body).toEqual({ mailboxUid: shared.uid });
            for (const image of ["avatar", "banner"]) {
                expect((await upload(shared.uid, image, png(), "image/png", ctx.viewerToken)).status).toBe(403);
                expect((await remove(shared.uid, image, ctx.viewerToken)).status).toBe(403);
            }
        });

        it("lets a caller who can update the mailbox change the profile", async () => {
            const shared = await ctx.createSharedMailbox(ctx.viewerUid, [ACLAction.READ, ACLAction.UPDATE]);

            expect((await upload(shared.uid, "avatar", png(), "image/png", ctx.viewerToken)).status).toBe(200);
            expect((await remove(shared.uid, "avatar", ctx.viewerToken)).status).toBe(200);
        });

        it("reports a mailbox that doesn't exist as missing (404) - but only to a caller the permission check lets through", async () => {
            const missing: string = "no-such-mailbox@example.com";

            expect((await view(missing, ctx.adminToken)).status).toBe(404);
            expect((await upload(missing, "avatar", png(), "image/png", ctx.adminToken)).status).toBe(404);
            expect((await remove(missing, "banner", ctx.adminToken)).status).toBe(404);
            // Everyone else can't tell it from one they can't access.
            expect((await view(missing)).status).toBe(403);
            expect((await upload(missing, "avatar", png())).status).toBe(403);
            // Nothing was made for a mailbox that isn't there.
            expect(ctx.blobStore().blobs.size).toBe(0);
            expect(await ctx.findProfile(missing)).toBeUndefined();
        });

        it("refuses a mailbox param that is only whitespace (403), and serves nothing for it (404)", async () => {
            expect((await view("%20")).status).toBe(403);
            expect((await upload("%20", "avatar", png())).status).toBe(403);
            expect((await remove("%20", "avatar")).status).toBe(403);
            expect((await serve("%20", "avatar")).status).toBe(404);
        });
    });

    describe("GET /:mailboxUid", () => {
        it("returns just the mailbox for one with no profile", async () => {
            const result = await view(mailbox.uid);

            expect(result.status).toBe(200);
            expect(result.body).toEqual({ mailboxUid: mailbox.uid });
        });

        it("returns the version of each image the profile holds", async () => {
            await upload(mailbox.uid, "avatar", png("a"));
            await upload(mailbox.uid, "banner", png("b"), "image/jpeg");

            const result = await view(mailbox.uid);

            expect(result.status).toBe(200);
            expect(result.body.mailboxUid).toBe(mailbox.uid);
            expect(result.body.avatarVersion).toBe(versionOf(blobKeys("avatar")[0]));
            expect(result.body.bannerVersion).toBe(versionOf(blobKeys("banner")[0]));
            expect(result.body.avatarVersion).not.toBe(result.body.bannerVersion);
        });

        it("returns only the versions that are set", async () => {
            await ctx.saveProfile({ uid: mailbox.uid, mailboxUid: mailbox.uid, bannerBlobKey: "booking-profiles/banner/xyz", bannerContentType: "image/png" });

            const result = await view(mailbox.uid);

            expect(result.body).toEqual({ mailboxUid: mailbox.uid, bannerVersion: "xyz" });
        });

        it("resolves an uppercase or whitespace-padded mailbox to the lowercase one", async () => {
            for (const param of [mailbox.uid.toUpperCase(), ` ${mailbox.uid} `]) {
                const result = await view(encodeURIComponent(param));
                expect(result.status).toBe(200);
                expect(result.body.mailboxUid).toBe(mailbox.uid);
            }
        });
    });

    describe.each(["avatar", "banner"])("%s", (image) => {
        const limit: number = image === "avatar" ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES;
        const otherImage: string = image === "avatar" ? "banner" : "avatar";
        const key = (row: any): string | undefined => row?.[`${image}BlobKey`] ?? undefined;

        describe(`POST /:mailboxUid/${image}`, () => {
            it("rejects anything but a png, jpeg, gif or webp image (400), storing nothing", async () => {
                for (const contentType of ["text/plain", "image/svg+xml", "image/bmp", "application/json", "application/octet-stream", "image/pngx", "image"]) {
                    expect((await upload(mailbox.uid, image, png(), contentType)).status).toBe(400);
                }
                // No Content-Type at all.
                const bare = await authed(request(ctx.app()).post(`${ctx.baseUrl}/${mailbox.uid}/${image}`), ctx.ownerToken);
                expect(bare.status).toBe(400);

                expect(ctx.blobStore().blobs.size).toBe(0);
                expect(await ctx.findProfile(mailbox.uid)).toBeUndefined();
            });

            it("rejects an empty body (400), storing nothing", async () => {
                const result = await upload(mailbox.uid, image, Buffer.alloc(0));

                expect(result.status).toBe(400);
                expect(ctx.blobStore().blobs.size).toBe(0);
                expect(await ctx.findProfile(mailbox.uid)).toBeUndefined();
            });

            it(`rejects an image over ${limit / (1024 * 1024)} MB (400) but accepts one of exactly that size`, async () => {
                const tooBig = await upload(mailbox.uid, image, Buffer.alloc(limit + 1, 1));
                expect(tooBig.status).toBe(400);
                expect(ctx.blobStore().blobs.size).toBe(0);
                expect(await ctx.findProfile(mailbox.uid)).toBeUndefined();

                const exact = await upload(mailbox.uid, image, Buffer.alloc(limit, 1));
                expect(exact.status).toBe(200);
                expect(ctx.blobStore().blobs.get(blobKeys(image)[0])!.data.length).toBe(limit);
            });

            it("keeps a separate size limit for each image", async () => {
                // 3 MB: over the avatar's limit, under the banner's.
                const threeMb: Buffer = Buffer.alloc(3 * 1024 * 1024, 1);

                expect((await upload(mailbox.uid, image, threeMb)).status).toBe(image === "avatar" ? 400 : 200);
            });

            it("stores the image in the blob store, creating the profile row on first use", async () => {
                const result = await upload(mailbox.uid, image, png("first"), "image/webp");

                expect(result.status).toBe(200);
                const keys: string[] = blobKeys(image);
                expect(keys).toHaveLength(1);
                expect(keys[0]).toMatch(new RegExp(`^booking-profiles/${image}/[0-9a-f-]{36}$`));
                expect(ctx.blobStore().blobs.get(keys[0])).toEqual({ data: png("first"), contentType: "image/webp" });
                expect(result.body).toEqual({ mailboxUid: mailbox.uid, [`${image}Version`]: versionOf(keys[0]) });
                const row = await ctx.findProfile(mailbox.uid);
                expect(row.uid).toBe(mailbox.uid);
                expect(row.mailboxUid).toBe(mailbox.uid);
                expect(key(row)).toBe(keys[0]);
                expect(row[`${image}ContentType`]).toBe("image/webp");
                expect(row[`${otherImage}BlobKey`] ?? undefined).toBeUndefined();
            });

            it("accepts every allowed media type, ignoring case and parameters, and stores it normalized", async () => {
                for (const [sent, stored] of [
                    ["image/png", "image/png"],
                    ["image/jpeg", "image/jpeg"],
                    ["image/gif", "image/gif"],
                    ["image/webp", "image/webp"],
                    ["Image/PNG; charset=binary", "image/png"],
                    ["  IMAGE/JPEG ", "image/jpeg"],
                ]) {
                    const result = await upload(mailbox.uid, image, png(), sent);
                    expect(result.status).toBe(200);
                    expect((await ctx.findProfile(mailbox.uid))[`${image}ContentType`]).toBe(stored);
                }
            });

            it("replaces the previous image, deleting its blob", async () => {
                const first = await upload(mailbox.uid, image, png("first"), "image/png");
                const firstKey: string = blobKeys(image)[0];

                const second = await upload(mailbox.uid, image, png("second"), "image/jpeg");

                expect(second.status).toBe(200);
                const keys: string[] = blobKeys(image);
                expect(keys).toHaveLength(1);
                expect(keys[0]).not.toBe(firstKey);
                expect(ctx.blobStore().blobs.has(firstKey)).toBe(false);
                expect(ctx.blobStore().blobs.get(keys[0])).toEqual({ data: png("second"), contentType: "image/jpeg" });
                expect(second.body[`${image}Version`]).toBe(versionOf(keys[0]));
                expect(second.body[`${image}Version`]).not.toBe(first.body[`${image}Version`]);
                const row = await ctx.findProfile(mailbox.uid);
                expect(key(row)).toBe(keys[0]);
                expect(row[`${image}ContentType`]).toBe("image/jpeg");
            });

            it("leaves the other image alone", async () => {
                await upload(mailbox.uid, otherImage, png("other"));
                const otherKey: string = blobKeys(otherImage)[0];

                const result = await upload(mailbox.uid, image, png("mine"));

                expect(result.status).toBe(200);
                expect(result.body[`${otherImage}Version`]).toBe(versionOf(otherKey));
                expect(result.body[`${image}Version`]).toBe(versionOf(blobKeys(image)[0]));
                expect(ctx.blobStore().blobs.get(otherKey)!.data).toEqual(png("other"));
            });

            it("still succeeds when deleting the previous blob fails, leaving the row pointing at the new image", async () => {
                await upload(mailbox.uid, image, png("first"));
                const firstKey: string = blobKeys(image)[0];
                ctx.blobStore().failNextDelete = true;

                const second = await upload(mailbox.uid, image, png("second"));

                expect(second.status).toBe(200);
                expect(ctx.blobStore().failNextDelete).toBe(false);
                // The old blob is orphaned rather than the request failed.
                expect(ctx.blobStore().blobs.has(firstKey)).toBe(true);
                const row = await ctx.findProfile(mailbox.uid);
                expect(key(row)).not.toBe(firstKey);
                expect(ctx.blobStore().blobs.get(key(row)!)!.data).toEqual(png("second"));
            });

            it("resolves an uppercase or whitespace-padded mailbox param to the lowercase mailbox", async () => {
                const result = await upload(encodeURIComponent(`  ${mailbox.uid.toUpperCase()} `), image, png());

                expect(result.status).toBe(200);
                expect(result.body.mailboxUid).toBe(mailbox.uid);
                expect(key(await ctx.findProfile(mailbox.uid))).toBeTruthy();
            });

            it("deletes the new blob, and keeps the old image, when saving the profile fails", async () => {
                await upload(mailbox.uid, image, png("first"));
                const firstKey: string = blobKeys(image)[0];
                const spy = vi.spyOn(RepoUtils.prototype, "update").mockRejectedValueOnce(new Error("write failed"));
                try {
                    const result = await upload(mailbox.uid, image, png("second"));

                    expect(result.status).toBe(500);
                    expect(spy).toHaveBeenCalledTimes(1);
                    expect(blobKeys(image)).toEqual([firstKey]);
                    expect(key(await ctx.findProfile(mailbox.uid))).toBe(firstKey);
                } finally {
                    spy.mockRestore();
                }
            });

            it("deletes the new blob on a failed first upload too, and even when that cleanup itself fails", async () => {
                const spy = vi.spyOn(RepoUtils.prototype, "update").mockRejectedValueOnce(new Error("write failed"));
                try {
                    ctx.blobStore().failNextDelete = true;
                    const result = await upload(mailbox.uid, image, png("first"));

                    // The original failure is what's reported, not the failed cleanup.
                    expect(result.status).toBe(500);
                    expect(ctx.blobStore().failNextDelete).toBe(false);
                    // The cleanup failed, so the blob is orphaned - but the profile never points at it.
                    expect(blobKeys(image)).toHaveLength(1);
                    expect(key(await ctx.findProfile(mailbox.uid))).toBeUndefined();
                } finally {
                    spy.mockRestore();
                }
            });

            it("loses a race to a concurrent update without leaving the new blob behind", async () => {
                await upload(mailbox.uid, image, png("first"));
                // Another writer bumps the row's version between this upload's read and its write.
                const original = RepoUtils.prototype.update;
                const spy = vi.spyOn(RepoUtils.prototype, "update").mockImplementationOnce(async function (this: any, obj: any, existing: any, options: any) {
                    await original.call(this, { uid: existing.uid, version: existing.version, mailboxUid: existing.mailboxUid }, existing, options);
                    return await original.call(this, obj, existing, options);
                });
                try {
                    const result = await upload(mailbox.uid, image, png("second"));

                    expect(result.status).toBeGreaterThanOrEqual(400);
                    expect(blobKeys(image)).toHaveLength(1);
                    expect(ctx.blobStore().blobs.get(blobKeys(image)[0])!.data).toEqual(png("first"));
                } finally {
                    spy.mockRestore();
                }
            });
        });

        describe(`DELETE /:mailboxUid/${image}`, () => {
            it("clears the image and deletes its blob", async () => {
                await upload(mailbox.uid, image, png("mine"));
                await upload(mailbox.uid, otherImage, png("other"));
                const otherKey: string = blobKeys(otherImage)[0];

                const result = await remove(mailbox.uid, image);

                expect(result.status).toBe(200);
                expect(result.body).toEqual({ mailboxUid: mailbox.uid, [`${otherImage}Version`]: versionOf(otherKey) });
                expect(blobKeys(image)).toHaveLength(0);
                const row = await ctx.findProfile(mailbox.uid);
                expect(key(row)).toBeUndefined();
                expect(row[`${image}ContentType`] ?? undefined).toBeUndefined();
                expect(row[`${otherImage}BlobKey`]).toBe(otherKey);
                expect((await serve(mailbox.uid, image)).status).toBe(404);
                expect((await view(mailbox.uid)).body).toEqual({ mailboxUid: mailbox.uid, [`${otherImage}Version`]: versionOf(otherKey) });
            });

            it("is a no-op for an image that was never set, whether or not the profile row exists", async () => {
                const none = await remove(mailbox.uid, image);
                expect(none.status).toBe(200);
                expect(none.body).toEqual({ mailboxUid: mailbox.uid });
                expect(await ctx.findProfile(mailbox.uid)).toBeUndefined();

                await upload(mailbox.uid, otherImage, png("other"));
                const before = await ctx.findProfile(mailbox.uid);
                const unset = await remove(mailbox.uid, image);
                expect(unset.status).toBe(200);
                expect(unset.body).toEqual({ mailboxUid: mailbox.uid, [`${otherImage}Version`]: versionOf(before[`${otherImage}BlobKey`]) });
                expect((await ctx.findProfile(mailbox.uid)).version).toBe(before.version);
                expect(blobKeys(otherImage)).toHaveLength(1);
            });

            it("still succeeds when deleting the blob fails, having cleared the image", async () => {
                await upload(mailbox.uid, image, png("mine"));
                ctx.blobStore().failNextDelete = true;

                const result = await remove(mailbox.uid, image);

                expect(result.status).toBe(200);
                expect(result.body).toEqual({ mailboxUid: mailbox.uid });
                expect(ctx.blobStore().failNextDelete).toBe(false);
                expect(key(await ctx.findProfile(mailbox.uid))).toBeUndefined();
                // The blob is orphaned rather than the request failed.
                expect(blobKeys(image)).toHaveLength(1);
            });

            it("resolves an uppercase or whitespace-padded mailbox param to the lowercase mailbox", async () => {
                await upload(mailbox.uid, image, png());

                const result = await remove(encodeURIComponent(` ${mailbox.uid.toUpperCase()}`), image);

                expect(result.status).toBe(200);
                expect(key(await ctx.findProfile(mailbox.uid))).toBeUndefined();
            });
        });

        describe(`GET /:mailboxUid/${image} (public)`, () => {
            it("serves the image to an anonymous caller with its stored content type and the safety headers", async () => {
                await upload(mailbox.uid, image, png("mine"), "image/webp");

                const result = await serve(mailbox.uid, image);

                expect(result.status).toBe(200);
                expect(result.text).toBe(png("mine").toString());
                expect(result.headers["content-type"]).toBe("image/webp");
                expect(result.headers["x-content-type-options"]).toBe("nosniff");
                expect(result.headers["content-security-policy"]).toBe("sandbox");
            });

            it("caches an image requested with its current version for good", async () => {
                const uploaded = await upload(mailbox.uid, image, png("mine"));
                const version: string = uploaded.body[`${image}Version`];

                const result = await serve(mailbox.uid, image, `?v=${version}`);

                expect(result.status).toBe(200);
                expect(result.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
            });

            it("revalidates an image requested without a version, or with a stale or wrong one", async () => {
                const first = await upload(mailbox.uid, image, png("first"));
                await upload(mailbox.uid, image, png("second"));

                for (const query of ["", "?v=", `?v=${first.body[`${image}Version`]}`, "?v=nonsense", `?v=${versionOf(blobKeys(image)[0])}x`]) {
                    const result = await serve(mailbox.uid, image, query);
                    expect(result.status).toBe(200);
                    expect(result.text).toBe(png("second").toString());
                    expect(result.headers["cache-control"]).toBe("no-cache");
                }
            });

            it("doesn't accept the other image's version as its own", async () => {
                await upload(mailbox.uid, image, png("mine"));
                const other = await upload(mailbox.uid, otherImage, png("other"));

                const result = await serve(mailbox.uid, image, `?v=${other.body[`${otherImage}Version`]}`);

                expect(result.headers["cache-control"]).toBe("no-cache");
            });

            it("resolves an uppercase or whitespace-padded mailbox param to the lowercase mailbox", async () => {
                await upload(mailbox.uid, image, png("mine"));

                const result = await serve(encodeURIComponent(` ${mailbox.uid.toUpperCase()} `), image);

                expect(result.status).toBe(200);
                expect(result.text).toBe(png("mine").toString());
            });

            it("falls back to a generic content type when the row recorded none", async () => {
                ctx.blobStore().blobs.set("booking-profiles/x/raw", { data: png("raw") });
                await ctx.saveProfile({ uid: mailbox.uid, mailboxUid: mailbox.uid, [`${image}BlobKey`]: "booking-profiles/x/raw" });

                const result = await serve(mailbox.uid, image);

                expect(result.status).toBe(200);
                expect(result.headers["content-type"]).toBe("application/octet-stream");
                expect(result.headers["cache-control"]).toBe("no-cache");
            });

            it("is 404 for a mailbox with no profile, an unknown mailbox, and a profile without this image", async () => {
                expect((await serve(mailbox.uid, image)).status).toBe(404);
                expect((await serve("no-such-mailbox@example.com", image)).status).toBe(404);

                await upload(mailbox.uid, otherImage, png("other"));
                expect((await serve(mailbox.uid, image)).status).toBe(404);
                expect((await serve(mailbox.uid, otherImage)).status).toBe(200);
            });

            it("is 404 when the profile names a blob that is gone from the store", async () => {
                await upload(mailbox.uid, image, png("mine"));
                ctx.blobStore().blobs.delete(blobKeys(image)[0]);

                const result = await serve(mailbox.uid, image);

                expect(result.status).toBe(404);
            });
        });
    });

    describe("branches HTTP cannot reach", () => {
        it("takes the first value when a header arrives as a list, reads a missing one as empty, and refuses a mailbox param that isn't text", async () => {
            const route = ctx.route();
            const user: any = { uid: ctx.ownerUid, roles: [], elevated: Date.now() };
            const listed: any = { headers: { "content-type": ["image/png", "text/plain"] }, rawBody: png("listed") };

            const result = await route.uploadAvatar(mailbox.uid, listed, user);

            expect(result.mailboxUid).toBe(mailbox.uid);
            expect(result.avatarVersion).toBeTruthy();
            await expect(route.uploadBanner(mailbox.uid, { headers: {}, rawBody: png() }, user)).rejects.toMatchObject({ status: 400 });
            await expect(route.get(undefined, user)).rejects.toMatchObject({ status: 403 });
            await expect(route.getAvatar(undefined, undefined, { setHeader: () => undefined, send: () => undefined })).rejects.toMatchObject({ status: 404 });
        });
    });
}
