///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BookingProfileRouteSQL } from "../../../src/routes/sql/BookingProfileRouteSQL.js";
const { Route } = RouteDecorators;

@Route("/sql/booking-profiles")
export class BookingProfileRoute extends BookingProfileRouteSQL {}
