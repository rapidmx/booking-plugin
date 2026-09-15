///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/** Reached only by a bare `/book` visit with no slug (e.g. a mistyped/incomplete link) — the real booking
 * flow lives at `apps/book/[slug].tsx`, `GET /book/:slug`. */
import React from "react";
import useBranding from "@rapidmx/react-shared/branding/useBranding.js";
import Alert from "@rapidmx/react-shared/components/feedback/Alert.js";
import { BrandingFooter, BrandingHeader } from "@rapidmx/web-client/shared/components/layout/BrandingChrome.js";

export default function NoBookingSlugPage() {
    const { branding } = useBranding();
    return (
        <>
            <BrandingHeader branding={branding} />
            <div className="min-h-screen flex items-center justify-center p-8">
                <Alert>No booking link specified.</Alert>
            </div>
            <BrandingFooter branding={branding} />
        </>
    );
}
