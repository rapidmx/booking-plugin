///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderSQL } from "@rapidmx/restapi/sql";
import { BookingSQL } from "../../models/sql/BookingSQL.js";
import { BookingTypeSQL } from "../../models/sql/BookingTypeSQL.js";
import { BaseBookingTypeRoute } from "../BaseBookingTypeRoute.js";
const { ApiRoute, Model } = RouteDecorators;

/** The host's booking type management endpoints (`/api/mail/booking-types`). */
@ApiRoute("mail/booking-types")
@Model(BookingTypeSQL)
export class BookingTypeRouteSQL extends BaseBookingTypeRoute<BookingTypeSQL> {
    protected readonly repoUtilsClass: any = RepoUtils;
    protected folderClass: any = FolderSQL;
    protected bookingClass: any = BookingSQL;
}
