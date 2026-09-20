///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * This plugin's `./sql` entry point: exactly the classes a server host loads for a SQL deployment - the booking models
 * and the routes mounted at `/api/mail/booking-types`, `/api/mail/booking-profiles` and `/api/mail/bookings`. Anything
 * else exported here would be registered by the host too, so the abstract routes and utilities stay in the package root.
 */
export { BookingTypeSQL } from "./models/sql/BookingTypeSQL.js";
export { BookingSQL } from "./models/sql/BookingSQL.js";
export { BookingProfileSQL } from "./models/sql/BookingProfileSQL.js";
export { BookingTypeRouteSQL } from "./routes/sql/BookingTypeRouteSQL.js";
export { BookingRouteSQL } from "./routes/sql/BookingRouteSQL.js";
export { BookingProfileRouteSQL } from "./routes/sql/BookingProfileRouteSQL.js";
