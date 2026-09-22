///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { CalendarEventMongo, FolderMongo, MailboxMongo } from "@rapidmx/restapi/mongo";
import { BookingMongo } from "../../models/mongo/BookingMongo.js";
import { BookingProfileMongo } from "../../models/mongo/BookingProfileMongo.js";
import { BookingTypeMongo } from "../../models/mongo/BookingTypeMongo.js";
import { BaseBookingRoute } from "../BaseBookingRoute.js";
const { ApiRoute, Model } = RouteDecorators;

/**
 * The public booking endpoints (`/api/mail/bookings`).
 *
 * `@Model(BookingMongo)` is what lets `BaseBookingRoute.persistBooking()`'s `@Transactional()` resolve which datasource
 * to open a transaction against - see the `modelClass` getter there.
 */
@ApiRoute("mail/bookings")
@Model(BookingMongo)
export class BookingRouteMongo extends BaseBookingRoute<BookingTypeMongo, BookingMongo, CalendarEventMongo, FolderMongo, MailboxMongo> {
    protected bookingTypeClass: any = BookingTypeMongo;
    protected bookingClass: any = BookingMongo;
    protected bookingProfileClass: any = BookingProfileMongo;
    protected calendarEventClass: any = CalendarEventMongo;
    protected folderClass: any = FolderMongo;
    protected mailboxClass: any = MailboxMongo;

    /**
     * This backend's half of `BaseBookingRoute.importVideoconfBackend()`: a dynamic `import()` of
     * `@rapidmx/videoconf-plugin`'s own `./mongo` entry point, matching this route's own backend. Never a static
     * import - see that method's doc comment on why `@rapidmx/videoconf-plugin` (an `optionalDependencies` entry
     * of this package - see `package.json`) must only ever be loaded dynamically, guarded by
     * `PluginRegistry.isActive()`. Returns `undefined`, never throws, when the package genuinely isn't
     * resolvable - `maybeCreateVideoMeetingJoinUrl()`'s own `try`/`catch` is defense in depth on top of this.
     */
    protected async importVideoconfBackend(): Promise<{ meetingClass: any; inviteeClass: any } | undefined> {
        try {
            const mod: any = await import("@rapidmx/videoconf-plugin/mongo");
            return { meetingClass: mod.VideoMeetingMongo, inviteeClass: mod.VideoMeetingInviteeMongo };
        } catch {
            return undefined;
        }
    }
}
