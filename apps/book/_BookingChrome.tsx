///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * The frame shared by the public booking pages: the deployment's branding header and footer around a wide card that opens
 * with the host's banner and avatar. Not a page: `_`-prefixed files in `apps/` aren't routed.
 *
 * The branding header already carries the deployment's logo, so the page adds none of its own.
 */
import React, { PropsWithChildren } from "react";
import { Branding } from "@rapidmx/react-shared/branding/brandingApi.js";
import { BrandingFooter, BrandingHeader } from "@rapidmx/web-client/shared/components/layout/BrandingChrome.js";
import { bookingProfileImageUrl } from "../shared/bookingApi.js";

/** Who the page is with: the mailbox owner as a booker sees them. */
export interface BookingHost {
    mailboxUid: string;
    /** The host's name as shown to the booker (`hostDisplayName`). */
    name: string;
    /** Set when the mailbox has an avatar (see `PublicBookingType.avatarVersion`). */
    avatarVersion?: string;
    /** Set when the mailbox has a banner. */
    bannerVersion?: string;
}

/** The page: branding header on top, footer below, and the content filling what is left of the window. */
export function BookingPageShell({ branding, children }: PropsWithChildren<{ branding: Branding | null }>) {
    return (
        <div className="min-h-screen flex flex-col">
            <BrandingHeader branding={branding} />
            <main className="flex-1 bg-surface-alt px-4 py-6 sm:py-10 lg:py-14">{children}</main>
            <BrandingFooter branding={branding} />
        </div>
    );
}

/** The first letter of `name`, for an avatar the host hasn't set. */
function initialOf(name: string): string {
    return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}

/**
 * The white card every booking page is drawn in. Given a `host` it opens with their banner (or a plain gradient when
 * they have none) and their avatar (or their initial) overlapping the banner's lower edge, and leaves room below for it.
 */
export function BookingCard({
    host,
    maxWidth = "max-w-5xl",
    children,
}: PropsWithChildren<{ host?: BookingHost; maxWidth?: string }>) {
    return (
        <div className={`mx-auto w-full ${maxWidth} overflow-hidden rounded-lg border border-border bg-surface shadow-sm`}>
            {host && (
                <div className="relative">
                    <div className="h-36 sm:h-48 lg:h-56 bg-gradient-to-r from-primary-dark to-primary">
                        {host.bannerVersion && (
                            <img
                                src={bookingProfileImageUrl(host.mailboxUid, "banner", host.bannerVersion)}
                                alt=""
                                className="h-full w-full object-cover"
                            />
                        )}
                    </div>
                    <div className="absolute -bottom-12 left-6 sm:-bottom-16 sm:left-10 h-24 w-24 sm:h-32 sm:w-32 overflow-hidden rounded-full border-4 border-surface bg-primary text-white flex items-center justify-center text-4xl sm:text-5xl font-bold">
                        {host.avatarVersion ? (
                            <img
                                src={bookingProfileImageUrl(host.mailboxUid, "avatar", host.avatarVersion)}
                                alt=""
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <span aria-hidden="true">{initialOf(host.name)}</span>
                        )}
                    </div>
                </div>
            )}
            <div className={host ? "px-6 pb-8 pt-16 sm:px-10 sm:pb-10 sm:pt-20" : "p-6 sm:p-10"}>{children}</div>
        </div>
    );
}
