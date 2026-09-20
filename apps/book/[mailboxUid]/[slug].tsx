///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "@rapidmx/react-shared/util/api.js";
import {
    BookingSlot,
    PublicBookingType,
    bookSlot,
    bookingManageUrl,
    getPublicBookingType,
} from "../../shared/bookingApi.js";
import useBranding from "@rapidmx/react-shared/branding/useBranding.js";
import Alert from "@rapidmx/react-shared/components/feedback/Alert.js";
import Button from "@rapidmx/react-shared/components/buttons/Button.js";
import { BookingCard, BookingPageShell } from "../_BookingChrome.js";
import { SlotCursor, appendSlots, fetchSlotPage, initialSlotCursor } from "../_slotPaging.js";

const INPUT_CLASS =
    "w-full text-base py-3 px-3.5 border border-border rounded-md bg-surface text-text focus:outline-none focus:border-primary";

/** Groups `slots` by the visitor's own local calendar date (via `toLocaleDateString()`, which reads the
 * browser's timezone) — slots themselves are absolute instants, so "today"/"tomorrow" naturally differ
 * per visitor without any manual timezone math here. */
function groupByLocalDate(slots: BookingSlot[]): Map<string, BookingSlot[]> {
    const groups = new Map<string, BookingSlot[]>();
    for (const slot of slots) {
        const key = new Date(slot.start).toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
        const existing = groups.get(key);
        if (existing) {
            existing.push(slot);
        } else {
            groups.set(key, [slot]);
        }
    }
    return groups;
}

export default function PublicBookingPage({ params }: { params: { mailboxUid: string; slug: string } }) {
    const { branding } = useBranding();
    return (
        <BookingPageShell branding={branding}>
            <BookingContent mailboxUid={params.mailboxUid} slug={params.slug} />
        </BookingPageShell>
    );
}

function BookingContent({ mailboxUid, slug }: { mailboxUid: string; slug: string }) {
    const [bookingType, setBookingType] = useState<PublicBookingType | null>(null);
    const [slots, setSlots] = useState<BookingSlot[]>([]);
    const [nextSlots, setNextSlots] = useState<SlotCursor | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [moreError, setMoreError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
    const [bookerName, setBookerName] = useState("");
    const [bookerEmail, setBookerEmail] = useState("");
    const [bookerNotes, setBookerNotes] = useState("");
    const [booking, setBooking] = useState(false);
    const [bookError, setBookError] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [manageUrl, setManageUrl] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setLoadError(null);
        setMoreError(null);
        // The booking type says how far ahead it can be booked; slots are then paged through that whole window
        // (see _slotPaging.ts), not just the first response's 30 days / 500 slots.
        getPublicBookingType(mailboxUid, slug)
            .then(async (type) => {
                const page = type
                    ? await fetchSlotPage(mailboxUid, slug, initialSlotCursor(type.bookingWindowDays))
                    : { slots: [], next: null };
                setBookingType(type);
                setSlots(page.slots);
                setNextSlots(page.next);
            })
            .catch((err) => setLoadError(err instanceof ApiRequestError ? err.message : "Could not load this booking page."))
            .finally(() => setLoading(false));
    }, [mailboxUid, slug]);

    /** Only reachable from the "Show later times" button, which renders only while a `nextSlots` cursor exists. */
    async function handleLoadMore(cursor: SlotCursor) {
        setLoadingMore(true);
        setMoreError(null);
        try {
            const page = await fetchSlotPage(mailboxUid, slug, cursor);
            setSlots((current) => appendSlots(current, page.slots));
            setNextSlots(page.next);
        } catch (err) {
            setMoreError(err instanceof ApiRequestError ? err.message : "Could not load more times.");
        } finally {
            setLoadingMore(false);
        }
    }

    const grouped = useMemo(() => groupByLocalDate(slots), [slots]);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setBookError(null);
        if (!bookerName.trim() || !bookerEmail.trim()) {
            setBookError("Your name and email are both required.");
            return;
        }
        setBooking(true);
        try {
            const result = await bookSlot(mailboxUid, slug, {
                start: selectedSlot!.start,
                bookerName: bookerName.trim(),
                bookerEmail: bookerEmail.trim(),
                bookerNotes: bookerNotes.trim() || undefined,
                bookerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            setManageUrl(result.manageToken ? bookingManageUrl(result.manageToken) : null);
            setConfirmed(true);
        } catch (err) {
            setBookError(err instanceof ApiRequestError ? err.message : "Could not book this slot.");
        } finally {
            setBooking(false);
        }
    }

    if (loading) {
        return (
            <BookingCard maxWidth="max-w-2xl">
                <p className="text-base text-text-muted">Loading&hellip;</p>
            </BookingCard>
        );
    }
    if (loadError || !bookingType) {
        return (
            <BookingCard maxWidth="max-w-2xl">
                <Alert>{loadError ?? "This booking link is not available."}</Alert>
            </BookingCard>
        );
    }

    return (
        <BookingCard
            host={{
                mailboxUid: bookingType.mailboxUid,
                name: bookingType.hostDisplayName,
                avatarVersion: bookingType.avatarVersion,
                bannerVersion: bookingType.bannerVersion,
            }}
        >
            <div className="lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{bookingType.hostDisplayName}</h1>
                    <h2 className="text-lg sm:text-xl font-semibold mt-3">{bookingType.name}</h2>
                    <p className="text-base text-text-muted mt-1">{bookingType.durationMinutes} minutes</p>
                    {bookingType.requiresApproval && (
                        <p className="text-sm text-text-muted mt-1">{bookingType.hostDisplayName} confirms each booking.</p>
                    )}
                    {bookingType.description && (
                        <p className="text-base text-text mt-4 whitespace-pre-line">{bookingType.description}</p>
                    )}
                </div>

                <div className="mt-8 lg:mt-0 min-w-0">
                    {confirmed && selectedSlot ? (
                        <div>
                            <h2 className="text-xl font-bold tracking-tight mb-2">You&rsquo;re booked!</h2>
                            <p className="text-base text-text mb-4">
                                {bookingType.name} with {bookingType.hostDisplayName} on{" "}
                                {new Date(selectedSlot.start).toLocaleString()}.
                            </p>
                            {manageUrl && (
                                <>
                                    <p className="text-sm text-text-muted mb-1">Save this link to cancel or reschedule later:</p>
                                    {/* Only ever rendered after a client-side `bookSlot()` success (`confirmed` starts
                                    `false` and is never true on the server), so `window` is always defined here. */}
                                    <a href={manageUrl} className="text-sm text-primary-dark hover:underline break-all">
                                        {window.location.origin}
                                        {manageUrl}
                                    </a>
                                </>
                            )}
                        </div>
                    ) : !selectedSlot ? (
                        slots.length === 0 && !nextSlots ? (
                            <p className="text-base text-text-muted">No open slots right now — please check back later.</p>
                        ) : (
                            <div>
                                <h2 className="text-lg font-semibold mb-1">Select a time</h2>
                                {/* The slots themselves are absolute instants shown in the visitor's own zone. */}
                                <p className="text-sm text-text-muted mb-4">
                                    Times are shown in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                                </p>
                                <div className="flex flex-col gap-6 max-h-[28rem] lg:max-h-[36rem] overflow-y-auto pr-1">
                                    {/* fetchSlotPage() stops after a couple of fully booked windows, leaving the rest to the button. */}
                                    {slots.length === 0 && <p className="text-base text-text-muted">No open times in the next few weeks.</p>}
                                    {[...grouped.entries()].map(([date, daySlots]) => (
                                        <div key={date}>
                                            <h3 className="text-base font-semibold mb-2">{date}</h3>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                                                {daySlots.map((slot) => (
                                                    <button
                                                        key={slot.start}
                                                        type="button"
                                                        onClick={() => setSelectedSlot(slot)}
                                                        className="text-base py-2.5 px-3 border border-border rounded-md font-medium hover:border-primary hover:text-primary-dark"
                                                    >
                                                        {new Date(slot.start).toLocaleTimeString(undefined, {
                                                            hour: "numeric",
                                                            minute: "2-digit",
                                                        })}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                    {moreError && <Alert>{moreError}</Alert>}
                                    {nextSlots && (
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            className="!w-auto self-start"
                                            loading={loadingMore}
                                            disabled={loadingMore}
                                            onClick={() => handleLoadMore(nextSlots)}
                                        >
                                            Show later times
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )
                    ) : (
                        <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-lg">
                            <p className="text-lg">
                                <strong>{new Date(selectedSlot.start).toLocaleString()}</strong>
                            </p>
                            {bookError && <Alert>{bookError}</Alert>}
                            <input
                                aria-label="Your name"
                                type="text"
                                placeholder="Your name"
                                className={INPUT_CLASS}
                                value={bookerName}
                                onChange={(e) => setBookerName(e.target.value)}
                            />
                            <input
                                aria-label="Your email"
                                type="email"
                                placeholder="Your email"
                                className={INPUT_CLASS}
                                value={bookerEmail}
                                onChange={(e) => setBookerEmail(e.target.value)}
                            />
                            <textarea
                                aria-label="Notes (optional)"
                                placeholder="Notes (optional)"
                                rows={3}
                                className={INPUT_CLASS}
                                value={bookerNotes}
                                onChange={(e) => setBookerNotes(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-2">
                                <Button type="submit" loading={booking} disabled={booking} className="!w-auto">
                                    Confirm booking
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={booking}
                                    className="!w-auto"
                                    onClick={() => setSelectedSlot(null)}
                                >
                                    Choose a different time
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </BookingCard>
    );
}
