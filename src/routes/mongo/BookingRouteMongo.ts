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
}
