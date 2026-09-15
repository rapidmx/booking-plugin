///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * This plugin's `./mongo` entry point: exactly the classes a server host loads for a Mongo deployment - the booking models
 * and the routes mounted at `/api/mail/booking-types` and `/api/mail/bookings`. Anything else exported here would be
 * registered by the host too, so the abstract routes and utilities stay in the package root.
 */
export { BookingTypeMongo } from "./models/mongo/BookingTypeMongo.js";
export { BookingMongo } from "./models/mongo/BookingMongo.js";
export { BookingTypeRouteMongo } from "./routes/mongo/BookingTypeRouteMongo.js";
export { BookingRouteMongo } from "./routes/mongo/BookingRouteMongo.js";
