///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils, RouteDecorators } from "@rapidrest/service-core";
import { FolderMongo } from "@rapidmx/restapi/mongo";
import { BookingTypeMongo } from "../../models/mongo/BookingTypeMongo.js";
import { BaseBookingTypeRoute } from "../BaseBookingTypeRoute.js";
const { ApiRoute, Model } = RouteDecorators;

/** The host's booking type management endpoints (`/api/mail/booking-types`), unchanged from where they were served before this plugin. */
@ApiRoute("mail/booking-types")
@Model(BookingTypeMongo)
export class BookingTypeRouteMongo extends BaseBookingTypeRoute<BookingTypeMongo> {
    protected readonly repoUtilsClass: any = RepoUtils;
    protected folderClass: any = FolderMongo;
}
