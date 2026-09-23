///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import { ApiError, ObjectDecorators, type JWTUser } from "@rapidrest/core";
import {
    ACLAction,
    ACLUtils,
    ApiErrorMessages,
    ApiErrors,
    HttpRequest,
    HttpResponse,
    ObjectFactory,
    RepoUtils,
    RouteDecorators,
} from "@rapidrest/service-core";
import type { BlobStore, Mailbox } from "@rapidmx/restapi";
import { BookingProfile } from "../models/types.js";
import { stripTrustedRoles } from "../util/RouteAccessUtils.js";
const { Inject, Logger } = ObjectDecorators;
const { Delete, Get, Param, Post, Query, Request, Response, User: AuthUser } = RouteDecorators;

/** The image types an avatar or banner may be. Not any `image/*`: an `image/svg+xml` upload is a document that can carry
 * script, served publicly from this API's own origin. */
const IMAGE_CONTENT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** The largest avatar and banner accepted, in bytes. The web pages downscale before uploading, so these are generous. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_BANNER_BYTES = 5 * 1024 * 1024;

/** The two images a profile holds. */
type ProfileImage = "avatar" | "banner";

const IMAGE_LIMITS: Record<ProfileImage, number> = { avatar: MAX_AVATAR_BYTES, banner: MAX_BANNER_BYTES };

/** The state of a mailbox's booking page profile, as returned to a caller allowed to read the mailbox. */
export interface BookingProfileView {
    mailboxUid: string;
    /** Changes whenever the avatar does; unset when there is none. The cache-busting `v` of the avatar URL. */
    avatarVersion?: string;
    /** Same as `avatarVersion`, for the banner. */
    bannerVersion?: string;
}

/**
 * The cache-busting version of a stored image: the random part of its blob key, which is new for every upload. `undefined`
 * when there is no image (the SQL backend reads an unset column back as `null`).
 */
export function profileImageVersion(blobKey: string | null | undefined): string | undefined {
    return blobKey ? blobKey.substring(blobKey.lastIndexOf("/") + 1) : undefined;
}

function firstHeader(req: HttpRequest, name: string): string | undefined {
    const value: string | string[] | undefined = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
}

/**
 * The avatar and banner of a mailbox's public booking pages (`BookingProfile`): uploaded, removed and read back by callers
 * allowed to manage the mailbox, and served to everyone, since the booking pages are anonymous.
 *
 * Like `BaseBookingRoute` this is a bespoke class, not a `CRUDRoute`: the entity keeps a deny-all class ACL, the caller's
 * permission is checked against the *mailbox* (`UPDATE` to change the images, `READ` to see them), and every repo call
 * passes `ignoreACL: true`. The images live in the server's `BlobStore` and are uploaded as the raw request body, the same
 * way `Branding`'s logo is.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseBookingProfileRoute<P extends BookingProfile, M extends Mailbox> {
    protected abstract bookingProfileClass: any;
    protected abstract mailboxClass: any;

    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    private profileRepo?: RepoUtils<P>;
    private mailboxRepo?: RepoUtils<M>;

    @Inject(ACLUtils)
    private aclUtils?: ACLUtils;

    @Inject("BlobStore")
    private blobStore?: BlobStore;

    @Logger
    private logger: any;

    /** Roles `@rapidrest/service-core`'s `ACLUtils.hasPermission()` treats as always-permitted - which must never
     * apply to another user's mailbox. `requireMailboxPermission()` below strips these via `stripTrustedRoles()`
     * before ever consulting `hasPermission()`, so an admin-role caller with no actual grant on a mailbox is
     * denied exactly like a stranger - see `util/RouteAccessUtils.ts` for why this package can't just import
     * `@rapidmx/restapi`'s own equivalent fix. */
    private trustedRoles: string[] = ["admin"];

    private async init(): Promise<void> {
        if (!this.profileRepo) {
            this.profileRepo = await this._objectFactory!.newInstance(RepoUtils, {
                name: this.bookingProfileClass.name,
                args: [this.bookingProfileClass],
            });
        }
        if (!this.mailboxRepo) {
            this.mailboxRepo = await this._objectFactory!.newInstance(RepoUtils, {
                name: this.mailboxClass.name,
                args: [this.mailboxClass],
            });
        }
    }

    /** Mailbox uids are lowercased addresses; the profile's own `uid` is the same string. */
    private normalizeMailboxUid(mailboxUid: string): string {
        return typeof mailboxUid === "string" ? mailboxUid.trim().toLowerCase() : "";
    }

    /** Rejects a caller without `action` on the mailbox with a `403`, and an unknown mailbox with a `404`. `user` is
     * stripped of its trusted roles first (see `trustedRoles`'s own doc comment) so an admin-role caller with no
     * grant on this mailbox is refused exactly like anyone else. */
    private async requireMailboxPermission(mailboxUid: string, user: JWTUser | undefined, action: string): Promise<void> {
        if (!mailboxUid || !(await this.aclUtils!.hasPermission(stripTrustedRoles(user, this.trustedRoles), mailboxUid, action))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        // Permission first, so a caller who can't read the mailbox learns nothing about which ones exist. A trusted caller
        // passes the check above for any uid at all, so this is also what keeps a profile from being made for nothing.
        if (!(await this.mailboxRepo!.findOne(mailboxUid, { ignoreACL: true }))) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }
    }

    private toView(mailboxUid: string, profile: P | undefined): BookingProfileView {
        return {
            mailboxUid,
            avatarVersion: profileImageVersion(profile?.avatarBlobKey),
            bannerVersion: profileImageVersion(profile?.bannerBlobKey),
        };
    }

    /** Deletes `key` if set, swallowing any failure: a blob that is already gone must never fail the request. */
    private async deleteBlobIfSet(key: string | null | undefined): Promise<void> {
        if (!key) {
            return;
        }
        try {
            await this.blobStore!.delete(key);
        } catch (err: any) {
            this.logger?.warn(`BookingProfileRoute: failed to delete blob ${key}: ${err.message}`);
        }
    }

    @Get("/:mailboxUid")
    public async get(@Param("mailboxUid") rawMailboxUid: string, @AuthUser user?: JWTUser): Promise<BookingProfileView> {
        await this.init();
        const mailboxUid: string = this.normalizeMailboxUid(rawMailboxUid);
        await this.requireMailboxPermission(mailboxUid, user, ACLAction.READ);
        return this.toView(mailboxUid, await this.profileRepo!.findOne(mailboxUid, { ignoreACL: true }));
    }

    @Post("/:mailboxUid/avatar")
    public async uploadAvatar(
        @Param("mailboxUid") mailboxUid: string,
        @Request req: HttpRequest,
        @AuthUser user?: JWTUser,
    ): Promise<BookingProfileView> {
        return await this.upload(mailboxUid, "avatar", req, user);
    }

    @Post("/:mailboxUid/banner")
    public async uploadBanner(
        @Param("mailboxUid") mailboxUid: string,
        @Request req: HttpRequest,
        @AuthUser user?: JWTUser,
    ): Promise<BookingProfileView> {
        return await this.upload(mailboxUid, "banner", req, user);
    }

    @Delete("/:mailboxUid/avatar")
    public async deleteAvatar(@Param("mailboxUid") mailboxUid: string, @AuthUser user?: JWTUser): Promise<BookingProfileView> {
        return await this.remove(mailboxUid, "avatar", user);
    }

    @Delete("/:mailboxUid/banner")
    public async deleteBanner(@Param("mailboxUid") mailboxUid: string, @AuthUser user?: JWTUser): Promise<BookingProfileView> {
        return await this.remove(mailboxUid, "banner", user);
    }

    @Get("/:mailboxUid/avatar")
    public async getAvatar(
        @Param("mailboxUid") mailboxUid: string,
        @Query("v") version: string | undefined,
        @Response res: HttpResponse,
    ): Promise<void> {
        await this.serve(mailboxUid, "avatar", version, res);
    }

    @Get("/:mailboxUid/banner")
    public async getBanner(
        @Param("mailboxUid") mailboxUid: string,
        @Query("v") version: string | undefined,
        @Response res: HttpResponse,
    ): Promise<void> {
        await this.serve(mailboxUid, "banner", version, res);
    }

    /**
     * Replaces the mailbox's avatar or banner with the request body. The media type must be exactly one of
     * `IMAGE_CONTENT_TYPES` - see there for why that is a fixed list rather than any `image/*`.
     */
    private async upload(rawMailboxUid: string, image: ProfileImage, req: HttpRequest, user: JWTUser | undefined): Promise<BookingProfileView> {
        await this.init();
        const mailboxUid: string = this.normalizeMailboxUid(rawMailboxUid);
        await this.requireMailboxPermission(mailboxUid, user, ACLAction.UPDATE);

        // Only the media type itself, lowercased, is compared and stored - parameters (`; charset=...`) dropped.
        const contentType: string = (firstHeader(req, "content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!IMAGE_CONTENT_TYPES.includes(contentType)) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, `Content-Type must be one of: ${IMAGE_CONTENT_TYPES.join(", ")}.`);
        }
        const raw: Buffer | undefined = req.rawBody;
        if (!raw || raw.length === 0) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
        }
        if (raw.length > IMAGE_LIMITS[image]) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, `The ${image} must be at most ${IMAGE_LIMITS[image] / (1024 * 1024)} MB.`);
        }

        const existing: P = await this.findOrCreate(mailboxUid);
        const previousKey: string | undefined = (existing as any)[`${image}BlobKey`];
        const blobKey: string = `booking-profiles/${image}/${crypto.randomUUID()}`;
        await this.blobStore!.put(blobKey, raw, { contentType });

        let updated: P;
        try {
            updated = await this.profileRepo!.update(
                { uid: existing.uid, version: (existing as any).version, [`${image}BlobKey`]: blobKey, [`${image}ContentType`]: contentType } as any,
                existing,
                { user, ignoreACL: true },
            );
        } catch (err) {
            // A lost race or a failed write: the new blob is unreferenced, so it must not be left behind.
            await this.deleteBlobIfSet(blobKey);
            throw err;
        }
        await this.deleteBlobIfSet(previousKey);
        return this.toView(mailboxUid, updated);
    }

    private async remove(rawMailboxUid: string, image: ProfileImage, user: JWTUser | undefined): Promise<BookingProfileView> {
        await this.init();
        const mailboxUid: string = this.normalizeMailboxUid(rawMailboxUid);
        await this.requireMailboxPermission(mailboxUid, user, ACLAction.UPDATE);

        const existing: P | undefined = await this.profileRepo!.findOne(mailboxUid, { ignoreACL: true });
        const previousKey: string | undefined = existing ? (existing as any)[`${image}BlobKey`] : undefined;
        if (!existing || !previousKey) {
            return this.toView(mailboxUid, existing);
        }
        // `null`, not `undefined`: an undefined value is dropped from the generated SQL `UPDATE`, leaving the column stale.
        const updated: P = await this.profileRepo!.update(
            { uid: existing.uid, version: (existing as any).version, [`${image}BlobKey`]: null, [`${image}ContentType`]: null } as any,
            existing,
            { user, ignoreACL: true },
        );
        await this.deleteBlobIfSet(previousKey);
        return this.toView(mailboxUid, updated);
    }

    /**
     * Streams the image to any caller. A request carrying the current `v` (see `BookingProfileView`) can never see a different
     * image at that URL, so it is cached for good; one without it, or with a stale one, is revalidated every time.
     */
    private async serve(rawMailboxUid: string, image: ProfileImage, version: string | undefined, res: HttpResponse): Promise<void> {
        await this.init();
        const mailboxUid: string = this.normalizeMailboxUid(rawMailboxUid);
        const profile: P | undefined = mailboxUid ? await this.profileRepo!.findOne(mailboxUid, { ignoreACL: true }) : undefined;
        const blobKey: string | undefined = profile ? (profile as any)[`${image}BlobKey`] : undefined;
        if (!profile || !blobKey) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }
        let content: Buffer;
        try {
            content = await this.blobStore!.get(blobKey);
        } catch {
            // The row names a blob that is gone (an image removed straight from the store).
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }
        res.setHeader("content-type", (profile as any)[`${image}ContentType`] ?? "application/octet-stream");
        res.setHeader("cache-control", version && version === profileImageVersion(blobKey) ? "public, max-age=31536000, immutable" : "no-cache");
        // Served from this API's own origin, publicly: never let a browser sniff an upload into something active, and
        // sandbox it if opened directly.
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-security-policy", "sandbox");
        res.send(content);
    }

    /** The mailbox's profile row, created empty on first use. Its `uid` is the mailbox's own, so it can never be duplicated. */
    private async findOrCreate(mailboxUid: string): Promise<P> {
        const existing: P | undefined = await this.profileRepo!.findOne(mailboxUid, { ignoreACL: true });
        if (existing) {
            return existing;
        }
        return await this.profileRepo!.create(new this.bookingProfileClass({ uid: mailboxUid, mailboxUid }), { ignoreACL: true });
    }
}
