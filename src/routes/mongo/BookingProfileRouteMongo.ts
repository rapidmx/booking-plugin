///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { MailboxMongo } from "@rapidmx/restapi/mongo";
import { BookingProfileMongo } from "../../models/mongo/BookingProfileMongo.js";
import { BaseBookingProfileRoute } from "../BaseBookingProfileRoute.js";
const { ApiRoute } = RouteDecorators;

/** The avatar and banner endpoints of the public booking pages (`/api/mail/booking-profiles`). */
@ApiRoute("mail/booking-profiles")
export class BookingProfileRouteMongo extends BaseBookingProfileRoute<BookingProfileMongo, MailboxMongo> {
    protected bookingProfileClass: any = BookingProfileMongo;
    protected mailboxClass: any = MailboxMongo;
}
