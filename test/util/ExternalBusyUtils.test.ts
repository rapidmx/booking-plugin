///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { EventEmitter } from "events";
import {
    checkExternalBusyFeedUrl,
    externalBusyWindows,
    fetchIcsFeed,
    isPublicAddress,
    parseIcsBusyFeed,
    validateExternalBusySources,
    FEED_CACHE_MS,
    FEED_STALE_MS,
    MAX_EXTERNAL_BUSY_SOURCES,
    type BusyEventRow,
} from "../../src/util/ExternalBusyUtils.js";
import { BusyStatus, CalendarEventStatus } from "@rapidmx/restapi";

/** A feed with whatever `vevents` holds inside one VCALENDAR. */
const feed = (...vevents: string[]): string => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", ...vevents, "END:VCALENDAR"].join("\r\n");

/** One `VEVENT` from `lines`, with the usual identity fields filled in. */
const vevent = (uid: string, ...lines: string[]): string => ["BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20260501T120000Z", ...lines, "END:VEVENT"].join("\r\n");

describe("checkExternalBusyFeedUrl() Tests", () => {
    it("takes an https address on a public host", () => {
        expect(checkExternalBusyFeedUrl("https://calendar.example.com/d/4f9a1/plain.ics")).toBeUndefined();
        expect(checkExternalBusyFeedUrl("https://addressbook.calendar.google.com/calendar/feeds/x/private/basic")).toBeUndefined();
        expect(checkExternalBusyFeedUrl("https://[2606:4700:4700::1111]/cal.ics")).toBeUndefined();
        expect(checkExternalBusyFeedUrl("https://8.8.8.8/cal.ics")).toBeUndefined();
    });

    it("refuses anything but https on the public internet, with a message naming what to fix", () => {
        expect(checkExternalBusyFeedUrl("http://cal.example.com/x")).toMatch(/https:\/\//);
        expect(checkExternalBusyFeedUrl("cal.example.com/x")).toMatch(/full URL/);
        expect(checkExternalBusyFeedUrl("")).toMatch(/1 to 2000/);
        expect(checkExternalBusyFeedUrl(`https://cal.example.com/${"x".repeat(2000)}`)).toMatch(/1 to 2000/);
        expect(checkExternalBusyFeedUrl("https://user:pass@cal.example.com/x")).toMatch(/user name or password/);
        expect(checkExternalBusyFeedUrl("https://10.0.0.5/cal.ics")).toMatch(/public internet/);
        expect(checkExternalBusyFeedUrl("https://169.254.169.254/latest/meta-data")).toMatch(/public internet/);
        expect(checkExternalBusyFeedUrl("https://[::1]/cal.ics")).toMatch(/public internet/);
        for (const host of ["localhost", "nas.localhost", "printer.local", "db.internal", "box.lan", "home.server.home"]) {
            expect(checkExternalBusyFeedUrl(`https://${host}/cal.ics`)).toMatch(/public internet/);
        }
        expect(checkExternalBusyFeedUrl(undefined)).toMatch(/string/);
        expect(checkExternalBusyFeedUrl(42)).toMatch(/string/);
    });
});

describe("isPublicAddress() Tests", () => {
    it.each([
        ["8.8.8.8", true],
        ["172.32.0.1", true],
        ["10.1.2.3", false],
        ["127.0.0.1", false],
        ["169.254.169.254", false],
        ["172.20.0.1", false],
        ["192.168.1.1", false],
        ["100.64.0.1", false],
        ["0.0.0.0", false],
        ["224.0.0.1", false],
        ["2606:4700:4700::1111", true],
        ["::1", false],
        ["fd00::1", false],
        ["fe80::1", false],
        ["ff02::1", false],
        ["2001:db8::1", false],
        ["::ffff:10.0.0.1", false],
        ["::ffff:8.8.8.8", true],
        ["not-an-ip", false],
    ])("knows whether %s is public", (address, expected) => {
        expect(isPublicAddress(address)).toBe(expected);
    });
});

describe("validateExternalBusySources() Tests", () => {
    it("accepts an absent list and well-formed entries", () => {
        expect(validateExternalBusySources(undefined)).toBeUndefined();
        expect(validateExternalBusySources(null)).toBeUndefined();
        expect(validateExternalBusySources([])).toBeUndefined();
        expect(validateExternalBusySources([{ uid: "a", url: "https://cal.example.com/a.ics" }])).toBeUndefined();
        expect(validateExternalBusySources([{ uid: "a", label: "Spouse", url: "https://cal.example.com/a.ics" }])).toBeUndefined();
    });

    it("bounds the list, the address and the label", () => {
        const many = Array.from({ length: MAX_EXTERNAL_BUSY_SOURCES + 1 }, (_, i) => ({ uid: `s${i}`, url: `https://cal.example.com/${i}.ics` }));
        expect(validateExternalBusySources(many)).toMatch(/at most 10/);
        expect(validateExternalBusySources([{ url: "http://cal.example.com/a.ics" }])).toMatch(/https:\/\//);
        expect(validateExternalBusySources([{ url: "https://cal.example.com/a.ics", label: "x".repeat(201) }])).toMatch(/label/);
    });

    it("refuses a repeated uid or a repeated address", () => {
        expect(validateExternalBusySources([{ uid: "a", url: "https://x.example/a.ics" }, { uid: "a", url: "https://x.example/b.ics" }])).toMatch(/uid 'a'/);
        expect(validateExternalBusySources([{ uid: "a", url: "https://x.example/a.ics" }, { uid: "b", url: "https://x.example/A.ics" }])).toMatch(/same calendar address/);
        expect(validateExternalBusySources([{ uid: "", url: "https://x.example/a.ics" }])).toMatch(/non-empty string/);
    });
});

describe("parseIcsBusyFeed() Tests", () => {
    it("reads a timed event's absolute instants", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(feed(vevent("u1", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z")), "src");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            uid: "src:u1",
            icalUid: "src:u1",
            startDate: new Date("2026-06-01T13:00:00Z"),
            endDate: new Date("2026-06-01T14:00:00Z"),
            allDay: false,
            status: CalendarEventStatus.CONFIRMED,
            busyStatus: BusyStatus.BUSY,
        });
    });

    it("converts a TZID-authored event to the right instant and keeps its zone for recurrence", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(vevent("u1", "DTSTART;TZID=America/New_York:20260601T090000", "DTEND;TZID=America/New_York:20260601T100000")),
            "src",
        );
        expect(rows[0].startDate.toISOString()).toBe("2026-06-01T13:00:00.000Z");
        expect(rows[0].endDate.toISOString()).toBe("2026-06-01T14:00:00.000Z");
        expect(rows[0].timezone).toBe("America/New_York");
    });

    it("treats a VALUE=DATE event as the whole local day, with an exclusive DTEND", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(feed(vevent("u1", "DTSTART;VALUE=DATE:20260601", "DTEND;VALUE=DATE:20260603")), "src");
        expect(rows[0]).toMatchObject({ allDay: true, startDate: new Date("2026-06-01T00:00:00Z"), endDate: new Date("2026-06-03T00:00:00Z") });
        expect(rows[0].timezone).toBeUndefined();
    });

    it("uses DURATION, and an all-day event with neither end occupies its day", () => {
        const byDuration: BusyEventRow[] = parseIcsBusyFeed(feed(vevent("u1", "DTSTART:20260601T130000Z", "DURATION:PT1H30M")), "src");
        expect(byDuration[0].endDate.toISOString()).toBe("2026-06-01T14:30:00.000Z");
        const dayOnly: BusyEventRow[] = parseIcsBusyFeed(feed(vevent("u2", "DTSTART;VALUE=DATE:20260601")), "src");
        expect(dayOnly[0].endDate.getTime() - dayOnly[0].startDate.getTime()).toBe(24 * 3600_000);
    });

    it("drops an event with no uid, no dtstart, or no length", () => {
        expect(parseIcsBusyFeed(feed(vevent("", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z")), "src")).toHaveLength(0);
        expect(parseIcsBusyFeed(feed(vevent("u1", "DTEND:20260601T140000Z")), "src")).toHaveLength(0);
        // A timed event with neither DTEND nor DURATION occupies zero time (RFC 5545 §3.8.2.2) - nothing to block.
        expect(parseIcsBusyFeed(feed(vevent("u1", "DTSTART:20260601T130000Z")), "src")).toHaveLength(0);
        expect(parseIcsBusyFeed(feed(vevent("u1", "DTSTART:20260601T140000Z", "DTEND:20260601T140000Z")), "src")).toHaveLength(0);
    });

    it("joins folded continuation lines before reading them", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(vevent("u1", "SUMMARY:Something long that the producer\r\n  wrapped across two lines", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z")),
            "src",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].startDate.toISOString()).toBe("2026-06-01T13:00:00.000Z");
    });

    it("reads a recurrence rule, exdates and a recurrence-id override", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(
                vevent("u1", "DTSTART;TZID=America/Chicago:20260601T090000", "DTEND;TZID=America/Chicago:20260601T100000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", "EXDATE;TZID=America/Chicago:20260615T090000"),
                vevent("u1", "DTSTART:20260608T150000Z", "DTEND:20260608T160000Z", "RECURRENCE-ID;TZID=America/Chicago:20260608T100000"),
            ),
            "src",
        );
        expect(rows).toHaveLength(2);
        const master = rows.find((row) => !row.recurrenceId)!;
        expect(master.recurrenceRule).toMatchObject({ freq: "weekly", interval: 2, byDay: ["MO", "WE"] });
        expect((master.recurrenceRule as any).exceptions).toHaveLength(1);
        const override = rows.find((row) => row.recurrenceId)!;
        // The override keeps the master's icalUid, which is how `computeBusyWindows()` excludes the occurrence it replaced.
        expect(override.icalUid).toBe(master.icalUid);
        expect(override.uid).not.toBe(master.uid);
        expect(override.recurrenceId!.toISOString()).toBe("2026-06-08T15:00:00.000Z");
    });

    it("bounds a DATE-form UNTIL by its whole local day, the way a stored rule is bounded", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(vevent("u1", "DTSTART;TZID=America/New_York:20260601T090000", "DTEND;TZID=America/New_York:20260601T100000", "RRULE:FREQ=WEEKLY;UNTIL=20260629")),
            "src",
        );
        expect(rows[0].recurrenceRule!.until!.getTime()).toBe(new Date("2026-06-30T03:59:59.999Z").getTime());
    });

    it("keeps a cancelled or transparent event as the row that makes computeBusyWindows skip it", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(
                vevent("gone", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z", "STATUS:CANCELLED"),
                vevent("free", "DTSTART:20260602T130000Z", "DTEND:20260602T140000Z", "TRANSP:TRANSPARENT"),
            ),
            "src",
        );
        expect(rows.find((row) => row.icalUid.endsWith("gone"))!.status).toBe(CalendarEventStatus.CANCELLED);
        expect(rows.find((row) => row.icalUid.endsWith("free"))!.busyStatus).toBe(BusyStatus.FREE);
    });

    it("ignores a VTIMEZONE's or a VALARM's properties, and a nested component's event", () => {
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            [
                "BEGIN:VCALENDAR",
                "BEGIN:VTIMEZONE",
                "TZID:America/New_York",
                "BEGIN:STANDARD",
                "DTSTART:19701101T020000",
                "END:STANDARD",
                "END:VTIMEZONE",
                vevent("u1", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z", "BEGIN:VALARM", "TRIGGER:-PT15M", "DTSTART:19700101T000000Z", "END:VALARM"),
                "END:VCALENDAR",
            ].join("\r\n"),
            "src",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].startDate.toISOString()).toBe("2026-06-01T13:00:00.000Z");
    });

    it("never carries an event's contents - only its times", () => {
        const secret: string = "Project-Falcon budget review";
        const rows: BusyEventRow[] = parseIcsBusyFeed(
            feed(
                vevent(
                    "u1",
                    "DTSTART:20260601T130000Z",
                    "DTEND:20260601T140000Z",
                    `SUMMARY:${secret}`,
                    "LOCATION:Room 5B",
                    "DESCRIPTION:Discusses the numbers",
                    "ORGANIZER;CN=Boss:mailto:boss@example.com",
                    "ATTENDEE;CN=Staff:mailto:staff@example.com",
                ),
            ),
            "src",
        );
        expect(JSON.stringify(rows)).not.toMatch(/Falcon|Room 5B|boss@example|staff@example/i);
    });
});

describe("externalBusyWindows() Tests", () => {
    const WINDOW = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-02T00:00:00Z") };
    const ONE_EVENT: string = feed(vevent("u1", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z"));

    it("returns the busy windows a feed describes inside the asked-for range", async () => {
        const fetchFeed = vi.fn(async () => ONE_EVENT);
        const outcomes = await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, { fetchFeed, cache: new Map() });
        expect(outcomes.a.windows).toEqual([{ start: new Date("2026-06-01T13:00:00Z"), end: new Date("2026-06-01T14:00:00Z") }]);
        expect(outcomes.a.error).toBeUndefined();
    });

    it("skips an event outside the range, and reports a cancelled or transparent one as no window", async () => {
        const outcomes = await externalBusyWindows(
            [{ uid: "a", url: "https://cal.example.com/a.ics" }],
            WINDOW.from,
            WINDOW.to,
            {
                fetchFeed: async () =>
                    feed(
                        vevent("later", "DTSTART:20260701T130000Z", "DTEND:20260701T140000Z"),
                        vevent("gone", "DTSTART:20260601T130000Z", "DTEND:20260601T140000Z", "STATUS:CANCELLED"),
                        vevent("free", "DTSTART:20260601T150000Z", "DTEND:20260601T160000Z", "TRANSP:TRANSPARENT"),
                    ),
                cache: new Map(),
            },
        );
        expect(outcomes.a.windows).toHaveLength(0);
    });

    it("expands a recurring series across the range, in the event's own local time", async () => {
        const outcomes = await externalBusyWindows(
            [{ uid: "a", url: "https://cal.example.com/a.ics" }],
            new Date("2026-06-01T00:00:00Z"),
            new Date("2026-06-15T00:00:00Z"),
            {
                fetchFeed: async () => feed(vevent("u1", "DTSTART;TZID=America/New_York:20260601T090000", "DTEND;TZID=America/New_York:20260601T100000", "RRULE:FREQ=WEEKLY;BYDAY=MO")),
                cache: new Map(),
            },
        );
        expect(outcomes.a.windows.map((window) => window.start.toISOString()).sort()).toEqual([
            "2026-06-01T13:00:00.000Z",
            "2026-06-08T13:00:00.000Z",
        ]);
    });

    it("reports one failing feed without stopping the others", async () => {
        const fetchFeed = vi.fn(async (url: string) => {
            if (url.includes("bad")) {
                throw new Error("The calendar's address answered 503.");
            }
            return ONE_EVENT;
        });
        const outcomes = await externalBusyWindows(
            [
                { uid: "good", url: "https://cal.example.com/good.ics" },
                { uid: "bad", url: "https://cal.example.com/bad.ics" },
            ],
            WINDOW.from,
            WINDOW.to,
            { fetchFeed, cache: new Map() },
        );
        expect(outcomes.good.windows).toHaveLength(1);
        expect(outcomes.bad.windows).toHaveLength(0);
        expect(outcomes.bad.error).toMatch(/503/);
    });

    it("reuses a cached fetch within the freshness window instead of fetching again", async () => {
        const fetchFeed = vi.fn(async () => ONE_EVENT);
        const cache = new Map<string, { fetchedAt: number; rows: BusyEventRow[] }>();
        let clock: number = 1_000_000;
        const options = { fetchFeed, cache, now: () => clock };
        await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, options);
        const second = await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, options);
        expect(fetchFeed).toHaveBeenCalledTimes(1);
        expect(second.a.windows).toHaveLength(1);
        expect(second.a.cachedMs).toBe(0);
        // Past the cache's life, the feed is read again.
        clock += FEED_CACHE_MS;
        await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, options);
        expect(fetchFeed).toHaveBeenCalledTimes(2);
    });

    it("falls back to a stale cache when a live fetch fails, and gives up past a day", async () => {
        const cache = new Map<string, { fetchedAt: number; rows: BusyEventRow[] }>();
        let clock: number = 5_000_000;
        const failing = { fetchFeed: async () => { throw new Error("down"); }, cache, now: () => clock };
        // Warm the cache with a good read.
        await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, { fetchFeed: async () => ONE_EVENT, cache, now: () => clock });
        // A brief outage keeps blocking the windows the last good read reported.
        clock += 60_000;
        const stale = await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, failing);
        expect(stale.a.windows).toHaveLength(1);
        expect(stale.a.error).toBeUndefined();
        // Beyond the stale limit, the source contributes nothing and says why.
        clock += FEED_STALE_MS;
        const dead = await externalBusyWindows([{ uid: "a", url: "https://cal.example.com/a.ics" }], WINDOW.from, WINDOW.to, failing);
        expect(dead.a.windows).toHaveLength(0);
        expect(dead.a.error).toMatch(/down/);
    });
});

describe("fetchIcsFeed() Tests", () => {
    /** A stand-in for `https.request`, answering with `answer` and recording the resolved address. */
    function fakeRequest(answer: (request: any, callback: (response: any) => void) => void) {
        const calls: { options: any; resolved?: [string, number] }[] = [];
        const request: any = (options: any, callback: (response: any) => void) => {
            const call: { options: any; resolved?: [string, number] } = { options };
            calls.push(call);
            options.lookup("ignored", {}, (_err: unknown, address: string, family: number) => (call.resolved = [address, family]));
            const emitter: any = new EventEmitter();
            emitter.destroy = (err: Error) => emitter.emit("error", err);
            emitter.end = () => answer(emitter, callback);
            return emitter;
        };
        return { calls, request };
    }

    /** A response double that emits `chunks` and ends. */
    const responding = (statusCode: number, chunks: string[]) => (emitter: any, callback: (response: any) => void) => {
        const response: any = new EventEmitter();
        response.statusCode = statusCode;
        response.resume = () => undefined;
        response.destroy = () => undefined;
        callback(response);
        for (const chunk of chunks) {
            response.emit("data", Buffer.from(chunk));
        }
        response.emit("end");
    };

    const base = { timeoutMs: 10_000, maxBytes: 1024 * 1024 };

    it("asks the checked host by name, over the address it resolved", async () => {
        const { calls, request } = fakeRequest(responding(200, ["BEGIN:VCALENDAR\r\nEND:VCALENDAR"]));
        const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
        const text = await fetchIcsFeed("https://cal.example.com:8443/d/plain.ics?x=1", { ...base, lookup, request });
        expect(text).toContain("BEGIN:VCALENDAR");
        expect(lookup).toHaveBeenCalledWith("cal.example.com");
        expect(calls[0].options).toMatchObject({ hostname: "cal.example.com", port: "8443", path: "/d/plain.ics?x=1", method: "GET" });
        expect(calls[0].options.headers.accept).toMatch(/text\/calendar/);
        expect(calls[0].resolved).toEqual(["93.184.216.34", 4]);
    });

    it("refuses a non-https or internal address before connecting", async () => {
        const { calls, request } = fakeRequest(responding(200, []));
        await expect(fetchIcsFeed("http://cal.example.com/x", { ...base, request })).rejects.toThrow("https://");
        await expect(fetchIcsFeed("https://169.254.169.254/latest", { ...base, request })).rejects.toThrow("public internet");
        expect(calls).toHaveLength(0);
    });

    it("refuses a host that resolves to any private address", async () => {
        const { calls, request } = fakeRequest(responding(200, []));
        const lookup = async () => [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.1", family: 4 },
        ];
        await expect(fetchIcsFeed("https://cal.example.com/x", { ...base, lookup, request })).rejects.toThrow("private network");
        expect(calls).toHaveLength(0);
    });

    it("does not follow a redirect, and refuses a non-200 answer", async () => {
        const moved = fakeRequest(responding(302, []));
        await expect(fetchIcsFeed("https://cal.example.com/x", { ...base, lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: moved.request })).rejects.toThrow("redirected");
        const missing = fakeRequest(responding(404, []));
        await expect(fetchIcsFeed("https://cal.example.com/x", { ...base, lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: missing.request })).rejects.toThrow("404");
    });

    it("caps the bytes it reads", async () => {
        const big = fakeRequest(responding(200, ["x".repeat(600), "y".repeat(600)]));
        await expect(
            fetchIcsFeed("https://cal.example.com/x", { ...base, maxBytes: 1000, lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: big.request }),
        ).rejects.toThrow("larger than the maximum");
    });

    it("fails on a network error or a timeout", async () => {
        const refused = fakeRequest((emitter) => emitter.emit("error", new Error("ECONNREFUSED")));
        await expect(fetchIcsFeed("https://cal.example.com/x", { ...base, lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: refused.request })).rejects.toThrow("ECONNREFUSED");
        const slow = fakeRequest((emitter) => emitter.emit("timeout"));
        await expect(fetchIcsFeed("https://cal.example.com/x", { ...base, timeoutMs: 2000, lookup: async () => [{ address: "8.8.8.8", family: 4 }], request: slow.request })).rejects.toThrow("within 2 seconds");
    });
});
