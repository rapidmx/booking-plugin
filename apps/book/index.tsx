///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/** Reached only by a bare `/book` visit with no mailbox or slug (e.g. a mistyped/incomplete link) — the real booking
 * flow lives at `apps/book/[mailboxUid]/[slug].tsx`, `GET /book/:mailboxUid/:slug`. */
import React from "react";
import useBranding from "@rapidmx/react-shared/branding/useBranding.js";
import Alert from "@rapidmx/react-shared/components/feedback/Alert.js";
import { BookingCard, BookingPageShell } from "./_BookingChrome.js";

export default function NoBookingSlugPage() {
    const { branding } = useBranding();
    return (
        <BookingPageShell branding={branding}>
            <BookingCard maxWidth="max-w-2xl">
                <Alert>No booking link specified.</Alert>
            </BookingCard>
        </BookingPageShell>
    );
}
