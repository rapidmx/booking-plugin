///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BookingMongo } from "../../models/mongo/BookingMongo.js";
import { BookingKeyExpiryJob } from "../BookingKeyExpiryJob.js";

export class BookingKeyExpiryJobMongo extends BookingKeyExpiryJob {
    protected bookingClass: any = BookingMongo;
}
