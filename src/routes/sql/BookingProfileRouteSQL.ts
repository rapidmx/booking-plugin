///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { MailboxSQL } from "@rapidmx/restapi/sql";
import { BookingProfileSQL } from "../../models/sql/BookingProfileSQL.js";
import { BaseBookingProfileRoute } from "../BaseBookingProfileRoute.js";
const { ApiRoute } = RouteDecorators;

/** The avatar and banner endpoints of the public booking pages (`/api/mail/booking-profiles`). */
@ApiRoute("mail/booking-profiles")
export class BookingProfileRouteSQL extends BaseBookingProfileRoute<BookingProfileSQL, MailboxSQL> {
    protected bookingProfileClass: any = BookingProfileSQL;
    protected mailboxClass: any = MailboxSQL;
}
