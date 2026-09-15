///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Calendly-style booking for a `@rapidmx/restapi`-based mail server: a mailbox owner publishes `BookingType`s, and an
 * anonymous visitor picks an open slot from the owner's live calendar and books it (`Booking`), then manages it through
 * an emailed token.
 *
 * This module exports only the backend-agnostic surface: the entity interfaces, the slot and availability utilities and
 * the abstract routes. The concrete Mongo/SQL classes a server loads (models and the routes mounted at
 * `/api/mail/booking-types` and `/api/mail/bookings`) come from this package's `./mongo` and `./sql` entry points.
 */
export * from "./models/types.js";
export * from "./util/BookingUtils.js";
export * from "./routes/BaseBookingRoute.js";
export * from "./routes/BaseBookingTypeRoute.js";
