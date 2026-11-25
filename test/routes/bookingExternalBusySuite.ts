///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// External busy sources (`BookingType.externalBusySources`, rapidmx/server#11) - identical on both backends. Run from
// the BookingRoute test files, which supply a started server and fixtures. The feeds themselves are replaced with a
// double on the mounted route instance (`readExternalBusyWindows`) - the real fetch, its SSRF posture and its
// expansion of ICS busy time are covered by `test/util/ExternalBusyUtils.test.ts`; what this suite covers is that
// whatever the feeds say reaches `slots()` and the booking re-check exactly as the mailbox's own busy time does.
import { request } from "@rapidrest/service-core/test";

const SLOT_1 = "2099-06-01T13:00:00.000Z";
const SLOT_2 = "2099-06-01T14:00:00.000Z";
const WINDOW_FROM = "2099-06-01T00:00:00.000Z";
const WINDOW_TO = "2099-06-02T00:00:00.000Z";

export interface BookingExternalBusySuiteContext {
    app: () => any;
    baseUrl: string;
    mailboxUid: () => string;
    createBookingType: (data?: any) => Promise<{ uid: string; slug: string }>;
    findBookings: () => Promise<any[]>;
    /** The mounted booking route instance, whose feed reader a test replaces with its own. */
    route: () => any;
}

export function bookingExternalBusySuite(ctx: BookingExternalBusySuiteContext): void {
    const validBooking = (start: string = SLOT_1) => ({
        start,
        meetingTypeUid: "mt-default",
        locationOptionUid: "lo-default",
        bookerName: "Grace Hopper",
        bookerEmail: "grace@example.com",
        bookerTimezone: "America/Chicago",
    });
    const typeUrl = (slug: string, suffix: string = "") => `${ctx.baseUrl}/types/${ctx.mailboxUid()}/${slug}${suffix}`;
    const slotsSuffix = `/slots?meetingTypeUid=mt-default&from=${WINDOW_FROM}&to=${WINDOW_TO}`;
    const startsOf = (response: any): string[] => response.body.map((slot: any) => new Date(slot.start).toISOString());

    /** `readExternalBusyWindows` reporting `windows` for the one source every fixture booking type lists. */
    const feedSaying = (windows: { start: string; end: string }[], error?: string) => {
        const route: any = ctx.route();
        const original = route.readExternalBusyWindows;
        route.readExternalBusyWindows = async () => ({ "src-1": { windows: windows.map(({ start, end }) => ({ start: new Date(start), end: new Date(end) })), ...(error ? { error } : {}) } });
        return () => (route.readExternalBusyWindows = original);
    };

    describe("external busy sources", () => {
        const createTypeWithFeed = async () =>
            await ctx.createBookingType({ externalBusySources: [{ uid: "src-1", label: "Spouse", url: "https://calendar.example.com/spouse/private.ics" }] });

        it("subtracts another calendar's busy windows from the offered slots, and refuses a slot it blocks", async () => {
            const bookingType = await createTypeWithFeed();
            // Without the feed's say-so, both slots are offered.
            expect(startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)))).toEqual([SLOT_1, SLOT_2]);

            const restore = feedSaying([{ start: SLOT_1, end: SLOT_2 }]);
            try {
                // The window covers SLOT_1's hour exactly; SLOT_2 (14:00) is untouched.
                expect(startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)))).toEqual([SLOT_2]);
                // The re-check a booking runs through is the same computation: the blocked slot is a 409...
                const refused = await request(ctx.app()).post(typeUrl(bookingType.slug)).send(validBooking(SLOT_1));
                expect(refused.status).toBe(409);
                expect(await ctx.findBookings()).toHaveLength(0);
                // ...and a booking in the window's wake is taken as usual.
                expect((await request(ctx.app()).post(typeUrl(bookingType.slug)).send(validBooking(SLOT_2))).status).toBe(200);
                expect(await ctx.findBookings()).toHaveLength(1);
            } finally {
                restore();
            }

            // ...and the feed saying nothing again frees SLOT_1 - SLOT_2 is now busy for real, taken by the booking above.
            expect(startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)))).toEqual([SLOT_1]);
            expect((await request(ctx.app()).post(typeUrl(bookingType.slug)).send(validBooking(SLOT_1))).status).toBe(200);
            expect(await ctx.findBookings()).toHaveLength(2);
        });

        it("blocks only the windows the feed reports, never more", async () => {
            const bookingType = await createTypeWithFeed();
            const slots = async (): Promise<string[]> => startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)));

            // Inside SLOT_1's hour only: SLOT_1 goes, SLOT_2 (14:00) stays.
            let restore = feedSaying([{ start: "2099-06-01T13:30:00.000Z", end: "2099-06-01T13:45:00.000Z" }]);
            try {
                expect(await slots()).toEqual([SLOT_2]);
            } finally {
                restore();
            }

            // Straddling both: both go.
            restore = feedSaying([{ start: "2099-06-01T13:45:00.000Z", end: "2099-06-01T14:30:00.000Z" }]);
            try {
                expect(await slots()).toEqual([]);
            } finally {
                restore();
            }

            // On another day entirely: both stay.
            restore = feedSaying([{ start: "2099-06-05T13:30:00.000Z", end: "2099-06-05T14:00:00.000Z" }]);
            try {
                expect(await slots()).toEqual([SLOT_1, SLOT_2]);
            } finally {
                restore();
            }
        });

        it("keeps the page working, and logging, when a feed can't be read", async () => {
            const bookingType = await createTypeWithFeed();
            const route: any = ctx.route();
            const warnings: string[] = [];
            const originalReader = route.readExternalBusyWindows;
            const originalWarn = route.logger.warn;
            route.logger.warn = (message: string) => warnings.push(message);
            route.readExternalBusyWindows = async () => ({ "src-1": { windows: [], error: "The calendar's address answered 503." } });
            try {
                expect(startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)))).toEqual([SLOT_1, SLOT_2]);
                expect(warnings.some((message) => message.includes("Spouse") && message.includes("503"))).toBe(true);
                expect((await request(ctx.app()).post(typeUrl(bookingType.slug)).send(validBooking(SLOT_1))).status).toBe(200);
            } finally {
                route.readExternalBusyWindows = originalReader;
                route.logger.warn = originalWarn;
            }
        });

        it("offers every slot for a booking type with no sources at all", async () => {
            const bookingType = await ctx.createBookingType();
            expect(startsOf(await request(ctx.app()).get(typeUrl(bookingType.slug, slotsSuffix)))).toEqual([SLOT_1, SLOT_2]);
        });
    });
}
