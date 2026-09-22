///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// The optional `@rapidmx/videoconf-plugin` integration (`BaseBookingRoute.maybeCreateVideoMeetingJoinUrl()`) -
// identical on both backends. Run from the BookingRoute test files, which supply a started server and fixtures
// (a mailbox with one calendar folder, recreated before every test) plus the real `@rapidmx/videoconf-plugin`
// package (an `optionalDependencies`/`devDependency` entry - see `package.json`) wired into the same test
// server's own connections (`test/server-{mongo,sql}/models/index.ts`), so this suite exercises the real
// dynamic-import-and-mint path end to end - not a mock of it. The "package listed active but the import genuinely
// fails" path is covered separately, in its own per-backend file (`BookingRouteVideoconfImportFailure.test.ts`),
// which needs a module-level `vi.mock` that would otherwise apply to every test in this file.
import { request } from "@rapidrest/service-core/test";
import { PluginRegistry } from "@rapidmx/restapi";
import { BookingLocationType } from "../../src/models/types.js";

const SLOT_1 = "2099-06-01T13:00:00.000Z";
const VIDEOCONF_PLUGIN_NAME = "@rapidmx/videoconf-plugin";

export interface BookingVideoconfIntegrationSuiteContext {
    app: () => any;
    baseUrl: string;
    /** The fixture mailbox's uid (lowercase). */
    mailboxUid: () => string;
    /** Saves a booking type in the fixture mailbox, with `data` overriding any field. */
    createBookingType: (data?: any) => Promise<{ uid: string; slug: string }>;
    findBookings: () => Promise<any[]>;
    findVideoMeetings: () => Promise<any[]>;
    findVideoMeetingInvitees: () => Promise<any[]>;
}

export function bookingVideoconfIntegrationSuite(ctx: BookingVideoconfIntegrationSuiteContext): void {
    /** A booking type whose sole location option is `VIDEO` with no preset `videoUrl` - the case this whole
     * integration exists for. */
    const noPresetUrlType = (data?: any) =>
        ctx.createBookingType({
            meetingTypes: [
                {
                    uid: "mt-default",
                    name: "Intro Call",
                    durationMinutes: 60,
                    locationOptions: [{ uid: "lo-default", type: BookingLocationType.VIDEO }],
                },
            ],
            ...data,
        });
    const validBooking = (start: string = SLOT_1) => ({
        start,
        meetingTypeUid: "mt-default",
        locationOptionUid: "lo-default",
        bookerName: "Grace Hopper",
        bookerEmail: "grace@example.com",
        bookerNotes: "Looking forward to it.",
        bookerTimezone: "America/Chicago",
    });
    const book = (slug: string, body: any = validBooking()) => request(ctx.app()).post(`${ctx.baseUrl}/types/${ctx.mailboxUid()}/${slug}`).send(body);

    describe("optional @rapidmx/videoconf-plugin integration", () => {
        afterEach(() => {
            PluginRegistry.setLoaded([]);
        });

        it("mints a real private meeting and lands its join URL on locationVideoUrl when the plugin is active and no URL was preset", async () => {
            PluginRegistry.setLoaded([{ name: VIDEOCONF_PLUGIN_NAME, version: "0.1.0" }]);
            const bookingType = await noPresetUrlType();

            const result = await book(bookingType.slug);

            expect(result.status).toBe(200);
            expect(result.body.locationType).toBe(BookingLocationType.VIDEO);
            expect(result.body.locationVideoUrl).toMatch(/^https:\/\/videoconf\.rapidmx-test\.example\.com\/meet\/[A-Za-z0-9_-]{43}$/);

            const meetings = await ctx.findVideoMeetings();
            expect(meetings).toHaveLength(1);
            expect(meetings[0].mailboxUid).toBe(ctx.mailboxUid());
            expect(meetings[0].visibility).toBe("private");

            const invitees = await ctx.findVideoMeetingInvitees();
            expect(invitees).toHaveLength(1);
            expect(invitees[0].meetingUid).toBe(meetings[0].uid);
            expect(invitees[0].mailboxUid).toBe(ctx.mailboxUid());
            expect(invitees[0].email).toBe("grace@example.com");
            expect(invitees[0].displayName).toBe("Grace Hopper");
            expect(result.body.locationVideoUrl).toBe(`https://videoconf.rapidmx-test.example.com/meet/${invitees[0].joinToken}`);

            expect((await ctx.findBookings())[0].locationVideoUrl).toBe(result.body.locationVideoUrl);
        });

        it("leaves a host-preset videoUrl untouched and never invokes the integration, even while the plugin is active", async () => {
            PluginRegistry.setLoaded([{ name: VIDEOCONF_PLUGIN_NAME, version: "0.1.0" }]);
            // The default fixture booking type's video location option already carries its own preset `videoUrl`.
            const bookingType = await ctx.createBookingType();

            const result = await book(bookingType.slug);

            expect(result.status).toBe(200);
            expect(result.body.locationVideoUrl).toBe("https://meet.example.com/ada");
            expect(await ctx.findVideoMeetings()).toHaveLength(0);
            expect(await ctx.findVideoMeetingInvitees()).toHaveLength(0);
        });

        it("leaves locationVideoUrl unset, without error, when the plugin isn't active", async () => {
            // No `PluginRegistry.setLoaded()` call: the default (nothing loaded) state.
            const bookingType = await noPresetUrlType();

            const result = await book(bookingType.slug);

            expect(result.status).toBe(200);
            expect(result.body.locationType).toBe(BookingLocationType.VIDEO);
            expect(result.body.locationVideoUrl).toBeUndefined();
            expect(await ctx.findVideoMeetings()).toHaveLength(0);
        });

        it("never touches a phone or other location, whether or not the plugin is active", async () => {
            PluginRegistry.setLoaded([{ name: VIDEOCONF_PLUGIN_NAME, version: "0.1.0" }]);
            const bookingType = await ctx.createBookingType({
                meetingTypes: [
                    {
                        uid: "mt-default",
                        name: "Intro Call",
                        durationMinutes: 60,
                        locationOptions: [{ uid: "lo-default", type: BookingLocationType.PHONE }],
                    },
                ],
            });

            const result = await book(bookingType.slug, { ...validBooking(), bookerPhone: "+1-555-0100" });

            expect(result.status).toBe(200);
            expect(result.body.locationType).toBe(BookingLocationType.PHONE);
            expect(result.body.locationVideoUrl).toBeUndefined();
            expect(await ctx.findVideoMeetings()).toHaveLength(0);
        });
    });
}
