///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { BookingSQL } from "../../models/sql/BookingSQL.js";
import { BookingKeyExpiryJob } from "../BookingKeyExpiryJob.js";

export class BookingKeyExpiryJobSQL extends BookingKeyExpiryJob {
    protected bookingClass: any = BookingSQL;
}
