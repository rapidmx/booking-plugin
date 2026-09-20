///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError, type JWTUser } from "@rapidrest/core";
import {
    ACLAction,
    ApiErrorMessages,
    ApiErrors,
    HttpRequest,
    ModelUtils,
    RepoUtils,
    RouteDecorators,
    type UpdateObject,
} from "@rapidrest/service-core";
import { BaseScopedChildRoute, Folder, FolderType } from "@rapidmx/restapi";
import { normalizeSlug, validateAvailability } from "../util/BookingUtils.js";
import { Booking, BookingType } from "../models/types.js";
const { Param, Request, User: AuthUser } = RouteDecorators;

/**
 * Extends `BaseScopedChildRoute` (scoped by `mailboxUid`, the `ContactList`/`MailFilterRule` shape) for
 * `BookingType`, so all ordinary CRUD is permission-checked against the owning mailbox's `AccessControlList`
 * for free. This is the HOST's view of their bookable offerings; the anonymous booker's view is
 * `BaseBookingRoute`, a deliberately separate class exposing no CRUD at all.
 *
 * `create()`/`update()` add exactly two things on top of the inherited behavior: `slug` is normalized and
 * collision-checked within its mailbox (a `409`, mirroring `BaseDomainRoute.assignUidAndCheckCollision()`), and the
 * availability configuration is validated (a `400`) so an unbookable or non-expandable configuration can't be
 * persisted and then silently produce zero slots forever.
 *
 * A booking type may be moved to another mailbox (`update()` with a new `mailboxUid`) only while it has no bookings:
 * each booking's calendar event lives in the old mailbox's calendar and its manage link resolves that mailbox, so a
 * move would strand them.
 *
 * Unlike `Domain`, whose `uid` *is* its normalized name, `slug` here is an ordinary mutable indexed field. That
 * is deliberate: `RepoUtils.update()` requires `obj.uid === existing.uid` (an identity match, not a rename), so
 * a uid-derived slug could never be changed without deleting and re-creating the booking type - and unlike a
 * mail domain, renaming a public booking link is an ordinary thing to want to do.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseBookingTypeRoute<T extends BookingType> extends BaseScopedChildRoute<T> {
    protected readonly scopeProperty: string = "mailboxUid";

    /** The concrete `Folder` entity class, supplied by the Mongo/SQL concrete subclass - used to check
     * `calendarFolderUid` (see `requireBookableFolder()`). */
    protected abstract folderClass: any;

    /** The concrete `Booking` entity class, supplied by the Mongo/SQL concrete subclass - used to refuse moving a
     * booking type that has bookings to another mailbox (see `requireNoBookings()`). */
    protected abstract bookingClass: any;

    private folderRepo?: RepoUtils<Folder>;
    private bookingRepo?: RepoUtils<Booking>;

    /** Normalizes `o.slug` in place, rejecting a `400` if nothing usable is left of it. */
    private normalizeSlugOf(o: Partial<T>): string {
        const slug: string = normalizeSlug(o.slug ?? "");
        if (!slug) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, "slug is required and must contain at least one letter or digit.");
        }
        (o as any).slug = slug;
        return slug;
    }

    /**
     * Rejects a `409` if another `BookingType` of `mailboxUid` already holds `slug` - slugs are only unique within
     * a mailbox. `excludeUid` is the row being updated, if any - a booking type never collides with itself.
     */
    private async requireSlugFree(slug: string, mailboxUid: unknown, excludeUid?: string): Promise<void> {
        // `literal()`: a mailbox uid is an address, so it must never be read as query syntax (`,()`).
        const existing: T[] = await this.repoUtils!.find({ mailboxUid: ModelUtils.literal(String(mailboxUid ?? "")), slug } as any, {
            ignoreACL: true,
            limit: 1,
        });
        if (existing.length > 0 && existing[0].uid !== excludeUid) {
            throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 409, "This booking slug is already in use.");
        }
    }

    /** Rejects a `409` when the booking type `uid` has any booking, cancelled ones included. */
    private async requireNoBookings(uid: string): Promise<void> {
        if (!this.bookingRepo) {
            this.bookingRepo = await this._objectFactory!.newInstance(RepoUtils, { name: this.bookingClass.name, args: [this.bookingClass] });
        }
        if ((await this.bookingRepo.count({ bookingTypeUid: ModelUtils.literal(uid) } as any, { ignoreACL: true })) > 0) {
            throw new ApiError(
                ApiErrors.IDENTIFIER_EXISTS,
                409,
                "This booking link already has bookings, so it cannot be moved to another mailbox. Create a new link for that mailbox instead.",
            );
        }
    }

    /** Turns `validateAvailability()`'s message-or-`undefined` result into a `400`. */
    private requireValidAvailability(o: Partial<T>): void {
        const problem: string | undefined = validateAvailability(o);
        if (problem) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, problem);
        }
    }

    /**
     * `calendarFolderUid` is where anonymous bookings are written and whose events block slots, so it must be a
     * calendar folder of the booking type's own mailbox that the caller can read - otherwise a caller managing
     * their own mailbox's booking types could point one at somebody else's calendar, publishing its free/busy
     * through the public slots endpoint and planting booking events in it. `400` for a folder of the wrong
     * mailbox or type (or no such folder), `403` when the caller can't read it.
     */
    private async requireBookableFolder(mailboxUid: unknown, calendarFolderUid: unknown, user: JWTUser | undefined): Promise<void> {
        if (typeof calendarFolderUid !== "string" || !calendarFolderUid) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, "calendarFolderUid is required.");
        }
        if (!this.folderRepo) {
            this.folderRepo = await this._objectFactory!.newInstance(RepoUtils, { name: this.folderClass.name, args: [this.folderClass] });
        }
        const folder: Folder | undefined = await this.folderRepo.findOne(calendarFolderUid, { ignoreACL: true });
        // Permission first, so a caller who can't read the folder learns nothing about which mailbox it belongs to.
        if (folder && !(await this.aclUtils!.hasPermission(user, folder.uid, ACLAction.READ))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        if (!folder || (folder as any).deleted || folder.mailboxUid !== mailboxUid || folder.type !== FolderType.CALENDAR) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, "calendarFolderUid must name a calendar folder of the booking type's own mailbox.");
        }
    }

    public async create(obj: T | T[], @Request req: HttpRequest, @AuthUser user?: JWTUser): Promise<T | T[]> {
        const objs: T[] = Array.isArray(obj) ? obj : [obj];
        const seenSlugs: Set<string> = new Set();
        for (const single of objs) {
            this.requireValidAvailability(single);
            await this.requireBookableFolder(single?.mailboxUid, single?.calendarFolderUid, user);
            await this.requireSlugFree(this.normalizeSlugOf(single), single.mailboxUid);
            // Slugs only collide within one mailbox, so the same slug for two mailboxes in one request is fine.
            const seenKey: string = `${single.mailboxUid}\n${single.slug}`;
            if (seenSlugs.has(seenKey)) {
                throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 409, "Duplicate booking slug within the same request.");
            }
            seenSlugs.add(seenKey);
        }
        return await super.create(obj, req, user);
    }

    public async update(
        @Param("id") id: string,
        obj: UpdateObject<T>,
        @Request req?: HttpRequest,
        @AuthUser user?: JWTUser,
    ): Promise<T> {
        // Validate/normalize only what the caller actually sent - `RepoUtils.update()` is a genuine partial
        // patch on both backends, so an absent `slug`/`availability` means "leave it alone", not "clear it".
        this.requireValidAvailability(obj);
        const slugSent: boolean = (obj as any).slug !== undefined;
        if (slugSent) {
            this.normalizeSlugOf(obj);
        }
        const mailboxSent: boolean = (obj as any).mailboxUid !== undefined;
        // `super.update()` still does its own permission checks (UPDATE on the current mailbox, CREATE on a new one)
        // afterwards, and a missing row is its 404 to report - so nothing here applies to one.
        if (slugSent || mailboxSent || (obj as any).calendarFolderUid !== undefined) {
            const existing: T | undefined = await this.repoUtils!.findOne(id, { ignoreACL: true });
            if (existing) {
                const mailboxUid: unknown = (obj as any).mailboxUid ?? existing.mailboxUid;
                // Re-checked whenever either half of the folder/mailbox pairing changes.
                if ((obj as any).calendarFolderUid !== undefined || mailboxSent) {
                    await this.requireBookableFolder(mailboxUid, (obj as any).calendarFolderUid ?? existing.calendarFolderUid, user);
                }
                if (mailboxSent && mailboxUid !== existing.mailboxUid) {
                    await this.requireNoBookings(id);
                }
                // The slug must be free in the mailbox the booking type ends up in, whichever of the two changed.
                if (slugSent || mailboxSent) {
                    await this.requireSlugFree((obj as any).slug ?? existing.slug, mailboxUid, id);
                }
            }
        }
        return await super.update(id, obj, req, user);
    }
}
