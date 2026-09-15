///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { CalendarEventSQL, FolderSQL, MailboxSQL } from "@rapidmx/restapi/sql";
import { BookingSQL } from "../../models/sql/BookingSQL.js";
import { BookingTypeSQL } from "../../models/sql/BookingTypeSQL.js";
import { BaseBookingRoute } from "../BaseBookingRoute.js";
const { ApiRoute, Model } = RouteDecorators;

/**
 * The public booking endpoints (`/api/mail/bookings`), unchanged from where they were served before this plugin.
 *
 * `@Model(BookingSQL)` is what lets `BaseBookingRoute.persistBooking()`'s `@Transactional()` resolve which datasource
 * to open a transaction against - see the `modelClass` getter there.
 */
@ApiRoute("mail/bookings")
@Model(BookingSQL)
export class BookingRouteSQL extends BaseBookingRoute<BookingTypeSQL, BookingSQL, CalendarEventSQL, FolderSQL, MailboxSQL> {
    protected bookingTypeClass: any = BookingTypeSQL;
    protected bookingClass: any = BookingSQL;
    protected calendarEventClass: any = CalendarEventSQL;
    protected folderClass: any = FolderSQL;
    protected mailboxClass: any = MailboxSQL;
}
