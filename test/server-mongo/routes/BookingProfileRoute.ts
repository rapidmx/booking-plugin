///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BookingProfileRouteMongo } from "../../../src/routes/mongo/BookingProfileRouteMongo.js";
const { Route } = RouteDecorators;

@Route("/mongo/booking-profiles")
export class BookingProfileRoute extends BookingProfileRouteMongo {}
