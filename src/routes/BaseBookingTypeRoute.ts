///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
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
const { Param, Query, Request, User: AuthUser } = RouteDecorators;

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
 * A booking type may be moved to another mailbox (`update()` with a new `mailboxUid`), or deleted (`delete()`), only
 * while it has no bookings - both go through `requireNoBookings()`. A move would strand a booking's calendar event
 * in the old mailbox's calendar (its manage link resolves the mailbox from the booking, not from the still-live
 * booking type); a delete is worse - it would leave the booking's `bookingTypeUid` naming nothing at all, and every
 * one of `BaseBookingRoute`'s per-booking endpoints (`manage()`/`cancel()`/`reschedule()`/`hostListBookings()`/
 * `setBookingLocationVideoUrl()`) re-resolves the booking type by that uid and 404s the instant it's gone - an
 * existing booker would permanently lose the ability to view, cancel or reschedule a booking that is still very
 * much live on the host's calendar. A host wanting to stop new bookings without losing that ability should disable
 * the booking type (`enabled: false`) instead - that leaves existing bookings and their manage links intact while
 * making the public endpoints 404 for anyone trying to book it afresh (see `BaseBookingRoute.requireBookingType()`).
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

    /** Rejects a `409` when the booking type `uid` has any booking, cancelled ones included. `action` names what
     * the caller was attempting, worded into the error message - see the class doc comment for why both `update()`
     * (moving mailboxes) and `delete()` share this same guard. */
    private async requireNoBookings(uid: string, action: "moved to another mailbox" | "deleted"): Promise<void> {
        if (!this.bookingRepo) {
            this.bookingRepo = await this._objectFactory!.newInstance(RepoUtils, { name: this.bookingClass.name, args: [this.bookingClass] });
        }
        if ((await this.bookingRepo.count({ bookingTypeUid: ModelUtils.literal(uid) } as any, { ignoreACL: true })) > 0) {
            throw new ApiError(
                ApiErrors.IDENTIFIER_EXISTS,
                409,
                action === "deleted"
                    ? "This booking link already has bookings, so it cannot be deleted. Disable it instead so its public link stops accepting new bookings."
                    : "This booking link already has bookings, so it cannot be moved to another mailbox. Create a new link for that mailbox instead.",
            );
        }
    }

    /**
     * Assigns `crypto.randomUUID()` to any meeting type / location option in `o.meetingTypes` missing a `uid`,
     * in place - the same in-place-mutation style `normalizeSlugOf()` uses for `slug`. A uid is never trusted as
     * caller-*chosen* identity (a client could otherwise mint colliding or spoofed ones), only as
     * caller-*preserved* identity: an entry that already carries a uid (from a previous read, being edited in
     * place) keeps it, so `Booking.meetingTypeUid`/location snapshots taken before this edit still resolve. A
     * no-op when `o.meetingTypes` is absent, which `RepoUtils.update()` then reads as "leave the stored value
     * alone", same as any other omitted field.
     */
    private normalizeMeetingTypeUids(o: Partial<T>): void {
        for (const meetingType of (o as any).meetingTypes ?? []) {
            if (!meetingType?.uid) {
                meetingType.uid = crypto.randomUUID();
            }
            for (const option of meetingType?.locationOptions ?? []) {
                if (!option?.uid) {
                    option.uid = crypto.randomUUID();
                }
            }
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
            this.normalizeMeetingTypeUids(single);
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
        this.normalizeMeetingTypeUids(obj);
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
                    await this.requireNoBookings(id, "moved to another mailbox");
                }
                // The slug must be free in the mailbox the booking type ends up in, whichever of the two changed.
                if (slugSent || mailboxSent) {
                    await this.requireSlugFree((obj as any).slug ?? existing.slug, mailboxUid, id);
                }
            }
        }
        return await super.update(id, obj, req, user);
    }

    /**
     * Refuses (`409`) to delete a booking type that still has any booking, cancelled ones included - see the
     * class doc comment for why this is worse than the same restriction on a mailbox move, and why disabling
     * (`enabled: false`) is the right way to stop new bookings on a link that already has some.
     */
    public async delete(
        @Param("id") id: string,
        @Query("version") version: string | undefined,
        @Query("purge") purge: string | undefined,
        @Request req: HttpRequest,
        @AuthUser user?: JWTUser,
    ): Promise<void> {
        await this.requireNoBookings(id, "deleted");
        return await super.delete(id, version, purge, req, user);
    }
}
