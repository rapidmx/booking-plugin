///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { CalendarEventSQL, FolderSQL, MailboxSQL } from "@rapidmx/restapi/sql";
import { BookingSQL } from "../../models/sql/BookingSQL.js";
import { BookingProfileSQL } from "../../models/sql/BookingProfileSQL.js";
import { BookingTypeSQL } from "../../models/sql/BookingTypeSQL.js";
import { BaseBookingRoute } from "../BaseBookingRoute.js";
const { ApiRoute, Model } = RouteDecorators;

/**
 * The public booking endpoints (`/api/mail/bookings`).
 *
 * `@Model(BookingSQL)` is what lets `BaseBookingRoute.persistBooking()`'s `@Transactional()` resolve which datasource
 * to open a transaction against - see the `modelClass` getter there.
 */
@ApiRoute("mail/bookings")
@Model(BookingSQL)
export class BookingRouteSQL extends BaseBookingRoute<BookingTypeSQL, BookingSQL, CalendarEventSQL, FolderSQL, MailboxSQL> {
    protected bookingTypeClass: any = BookingTypeSQL;
    protected bookingClass: any = BookingSQL;
    protected bookingProfileClass: any = BookingProfileSQL;
    protected calendarEventClass: any = CalendarEventSQL;
    protected folderClass: any = FolderSQL;
    protected mailboxClass: any = MailboxSQL;

    /**
     * This backend's half of `BaseBookingRoute.importVideoconfBackend()`: a dynamic `import()` of
     * `@rapidmx/meet-plugin`'s own `./sql` entry point, matching this route's own backend. Never a static
     * import - see that method's doc comment on why `@rapidmx/meet-plugin` (an `optionalDependencies` entry
     * of this package - see `package.json`) must only ever be loaded dynamically, guarded by
     * `PluginRegistry.isActive()`. Returns `undefined`, never throws, when the package genuinely isn't
     * resolvable - `maybeCreateVideoMeetingJoinUrl()`'s own `try`/`catch` is defense in depth on top of this.
     */
    protected async importVideoconfBackend(): Promise<{ meetingClass: any; inviteeClass: any } | undefined> {
        try {
            const mod: any = await import("@rapidmx/meet-plugin/sql");
            return { meetingClass: mod.VideoMeetingSQL, inviteeClass: mod.VideoMeetingInviteeSQL };
        } catch {
            return undefined;
        }
    }
}
