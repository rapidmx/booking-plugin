///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// External busy-time sources (`BookingType.externalBusySources`): calendars that are not this mailbox's, whose busy
// windows still block a booking link's slots. A source is the calendar's published ICS address - what Google Calendar
// calls a "secret address in ICS format", what Nextcloud/Apple/Outlook publish as their calendar download link -
// fetched over `https://`, parsed for busy time only, and merged into the same `OccurrenceWindow[]` list
// `subtractBusy()` already consumes.
//
// Two things this module is deliberately not:
//
// **Not an event reader.** `parseIcsBusyFeed()` reads `UID`/`DTSTART`/`DTEND`/`DURATION`/`RRULE`/`EXDATE`/
// `RECURRENCE-ID`/`STATUS`/`TRANSP` and nothing else. `SUMMARY`, `LOCATION`, `DESCRIPTION`, `ATTENDEE`, `ORGANIZER`
// and every other property is skipped without being stored, so nobody's meeting titles, places or guest lists ever
// enter a RapidMX database or log through this path - the feed says when someone is busy, never why or with whom.
//
// **Not a general HTTP client.** The address is checked (`checkExternalBusyFeedUrl()`) and its host resolved before
// connecting, every resolved address must be on the public internet, and the connection is pinned to the checked
// address so a name can't be switched to an internal one between check and connect. `https://` only, no credentials
// in the URL, redirects not followed, a response-size cap and a timeout. This is the same posture as crm-plugin's
// `webhooks/Webhooks.ts`, copied rather than imported because a plugin must not depend on another plugin (see
// `util/RouteAccessUtils.ts` for the same reasoning on a restapi fix).
import * as dns from "dns";
import * as https from "https";
import * as net from "net";
import { BusyStatus, CalendarEventStatus, computeBusyWindows, convertLocalToUtc, resolveTimeZone, type CalendarEvent, type OccurrenceWindow, type RecurrenceRule } from "@rapidmx/restapi";
import type { ExternalBusySource } from "../models/types.js";

/** How long one feed fetch may take, from connect to last byte. */
export const FEED_TIMEOUT_MS = 10_000;

/** The largest feed this module will read. A calendar that exports more than this is refused rather than parsed half. */
export const MAX_FEED_BYTES = 4 * 1024 * 1024;

/** How long a fetched feed's events are reused, so N visitors browsing one booking page cost one fetch, not N. */
export const FEED_CACHE_MS = 5 * 60_000;

/** Beyond freshness, how old a cached fetch may still be used - only when a live fetch failed (see `externalBusyWindows()`). */
export const FEED_STALE_MS = 24 * 3600_000;

/** The most external busy sources one booking type may list. */
export const MAX_EXTERNAL_BUSY_SOURCES = 10;

/** The longest feed URL and the longest per-source label. */
export const MAX_FEED_URL_LENGTH = 2000;
export const MAX_SOURCE_LABEL_LENGTH = 200;

/**
 * One fetched feed's events, in the shape `computeBusyWindows()` reads off a `CalendarEvent` row. Only the fields it
 * uses are filled in - see the cast at the call site: this is busy-time arithmetic, not a stored entity. `timezone` is
 * optional here even though `CalendarEvent` types it `string`, because an all-day event or one with no zone expands in
 * UTC, which `computeBusyWindows()` itself handles at runtime.
 */
export type BusyEventRow = Pick<
    CalendarEvent,
    "uid" | "icalUid" | "startDate" | "endDate" | "allDay" | "status" | "busyStatus" | "recurrenceRule" | "recurrenceId"
> & { timezone?: string };

/** What came back from one source: its windows, and why it may not have any. */
export interface ExternalBusyOutcome {
    /** The source's busy windows inside the asked-for range, merged and unsorted. */
    windows: OccurrenceWindow[];
    /** `undefined` when the feed was read; a human-readable reason when it was not. */
    error?: string;
    /** How long the source's answer had been cached (`undefined` for a live fetch). */
    cachedMs?: number;
}

/** An IPv4 address as a 32-bit number. */
function ipv4Number(address: string): number {
    return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

/** Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved IPv4 ranges. */
const PRIVATE_V4: [string, number][] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
];

/**
 * Whether `address` (an IP) is on the public internet: not loopback, private, link-local, carrier-grade NAT,
 * documentation, multicast or reserved - IPv4, IPv6, and IPv4 mapped into IPv6.
 */
export function isPublicAddress(address: string): boolean {
    if (net.isIPv4(address)) {
        const value: number = ipv4Number(address);
        return !PRIVATE_V4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base) / 2 ** (32 - bits)));
    }
    if (!net.isIPv6(address)) {
        return false;
    }
    const lower: string = address.toLowerCase();
    const mapped: RegExpExecArray | null = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) {
        return isPublicAddress(mapped[1]);
    }
    if (lower === "::" || lower === "::1") {
        return false;
    }
    const first: number = parseInt(lower.split(":")[0] || "0", 16);
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast, 2001:db8::/32 documentation.
    return !((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || lower.startsWith("2001:db8:"));
}

/** Refuses (returns a message for) a feed address that isn't `https://` on a public host name or address; `undefined` when it is. */
export function checkExternalBusyFeedUrl(raw: unknown): string | undefined {
    if (typeof raw !== "string" || !raw || raw.length > MAX_FEED_URL_LENGTH) {
        return `Each external calendar's url must be a string of 1 to ${MAX_FEED_URL_LENGTH} characters.`;
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return "Each external calendar's url must be a full URL, e.g. https://calendar.example/calendar.ics.";
    }
    if (url.protocol !== "https:") {
        return "Each external calendar's url must start with https://.";
    }
    if (url.username || url.password) {
        return "Each external calendar's url can't hold a user name or password.";
    }
    const host: string = url.hostname.replace(/^\[|\]$/g, "");
    if (!host) {
        return "Each external calendar's url must name a host.";
    }
    if (net.isIP(host) && !isPublicAddress(host)) {
        return "Each external calendar's url must be on the public internet.";
    }
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home)$/i.test(host)) {
        return "Each external calendar's url must be on the public internet.";
    }
    return undefined;
}

/** Resolves a host name to its addresses (every one, both families). */
export type HostLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
/**
 * Validates a `BookingType.externalBusySources` list, in the same message-or-`undefined` shape the rest of
 * `validateAvailability()` returns: a bounded list, each entry a well-formed public `https://` feed address with an
 * optional short label and a unique server-assigned uid. The address rules live with the fetcher
 * (`checkExternalBusyFeedUrl()`) so what may be *saved* and what will be *fetched* can never drift apart.
 */
export function validateExternalBusySources(sources: unknown): string | undefined {
    if (sources === undefined || sources === null) {
        return undefined;
    }
    if (!Array.isArray(sources) || sources.length > MAX_EXTERNAL_BUSY_SOURCES) {
        return `externalBusySources must be a list of at most ${MAX_EXTERNAL_BUSY_SOURCES} calendars.`;
    }
    const seenUids: Set<string> = new Set();
    const seenUrls: Set<string> = new Set();
    for (const source of sources as Partial<ExternalBusySource>[]) {
        const problem: string | undefined = checkExternalBusyFeedUrl(source?.url);
        if (problem) {
            return problem;
        }
        if (source?.label !== undefined && (typeof source.label !== "string" || source.label.length > MAX_SOURCE_LABEL_LENGTH)) {
            return `An external calendar's label, when supplied, must be a string of at most ${MAX_SOURCE_LABEL_LENGTH} characters.`;
        }
        if (source?.uid !== undefined) {
            if (typeof source.uid !== "string" || !source.uid) {
                return "An external calendar's uid, when supplied, must be a non-empty string.";
            }
            if (seenUids.has(source.uid)) {
                return `externalBusySources lists the uid '${source.uid}' more than once.`;
            }
            seenUids.add(source.uid);
        }
        // Two entries for one feed would fetch it twice and blame each other for a failure, so they are one entry.
        const url: string = (source as ExternalBusySource).url.trim().toLowerCase();
        if (seenUrls.has(url)) {
            return "externalBusySources lists the same calendar address more than once.";
        }
        seenUrls.add(url);
    }
    return undefined;
}
export const defaultLookup: HostLookup = async (hostname) => await dns.promises.lookup(hostname, { all: true, verbatim: true });

/** `DTSTART`/`DTEND`/`UNTIL`/`RECURRENCE-ID`/`EXDATE`, as restapi's own `parseIcsDateTime()` reads them (module-private there):
 * a `Z`-suffixed value is UTC, a `TZID`-parameterized one is wall-clock time in that zone, a bare floating value is UTC,
 * and a `VALUE=DATE` (or 8-digit) value is an all-day date at UTC midnights. */
function parseIcsStamp(value: string, tzid?: string, dateValue?: boolean): { at: Date; allDay: boolean; timezone?: string } | undefined {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const [, y, mo, d, h = "00", mi = "00", s = "00", z] = match;
    const year: number = Number(y);
    const month: number = Number(mo);
    const day: number = Number(d);
    if (dateValue || !z) {
        const zone: string | undefined = resolveTimeZone(tzid);
        if (zone) {
            const converted: Date | undefined = convertLocalToUtc(year, month, day, Number(h), Number(mi), Number(s), zone);
            if (converted) {
                return { at: converted, allDay: dateValue === true, timezone: zone };
            }
        }
    }
    return { at: new Date(Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s))), allDay: dateValue === true };
}

/** An RFC 5545 `DURATION` (`PT30M`, `P1DT2H`, `P2W`) as milliseconds; `undefined` for a negative or unparseable one. */
function parseIcsDuration(value: string): number | undefined {
    const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
    if (!match || match[1] === "-") {
        return undefined;
    }
    const [, , weeks, days, hours, minutes, seconds] = match;
    const ms: number =
        (Number(weeks ?? 0) * 7 * 24 * 3600 + Number(days ?? 0) * 24 * 3600 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000;
    return ms > 0 ? ms : undefined;
}

/** The `KEY=VALUE;KEY=VALUE` parts of an `RRULE`, lower-cased keys, last value of a repeated key. */
function rruleParts(value: string): Record<string, string> {
    const parts: Record<string, string> = {};
    for (const entry of value.split(";")) {
        const split: number = entry.indexOf("=");
        if (split > 0) {
            parts[entry.slice(0, split).trim().toUpperCase()] = entry.slice(split + 1).trim();
        }
    }
    return parts;
}

/**
 * An `RRULE` as the `RecurrenceRule` restapi stores - `FREQ` lower-cased, `BYDAY` as the `MO`/`2TU`/`-1FR` strings
 * themselves, `UNTIL` bounded the way restapi's own parser bounds it (a DATE-form `UNTIL=20261231` covers that whole
 * local day, so an occurrence later the same day is still inside the series). Every part is deliberately passed through
 * unvalidated: `expandOccurrencesDetailed()` re-checks a stored rule part by part, and a rule with an unusable part
 * reports its expansion truncated, which `computeBusyWindows()` turns into "busy for the whole window" - the safe
 * direction for a rule this module can't make sense of.
 */
function parseIcsRrule(value: string, dtstartTzid?: string): RecurrenceRule {
    const parts: Record<string, string> = rruleParts(value);
    const integers = (raw: string | undefined): number[] | undefined =>
        raw === undefined ? undefined : raw.split(",").map((entry) => Number(entry.trim())).filter((entry) => Number.isFinite(entry));
    const until: string | undefined = parts.UNTIL;
    const dateOnly: RegExpExecArray | null = until ? /^(\d{4})(\d{2})(\d{2})$/.exec(until.trim()) : null;
    let untilDate: Date | undefined;
    if (dateOnly) {
        // The last millisecond of that local calendar day, exactly as restapi's `parseUntil()` computes it.
        const zone: string | undefined = resolveTimeZone(dtstartTzid);
        const next: Date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]) + 1));
        const nextMidnightMs: number = zone
            ? convertLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, zone)!.getTime()
            : next.getTime();
        untilDate = new Date(nextMidnightMs - 1);
    } else if (until) {
        untilDate = parseIcsStamp(until, dtstartTzid)?.at;
    }
    const count: number | undefined = parts.COUNT !== undefined && Number.isFinite(Number(parts.COUNT)) ? Number(parts.COUNT) : undefined;
    const interval: number | undefined = parts.INTERVAL !== undefined && Number.isFinite(Number(parts.INTERVAL)) ? Number(parts.INTERVAL) : undefined;
    return {
        freq: (parts.FREQ ?? "").toLowerCase() as RecurrenceRule["freq"],
        interval: interval ?? 1,
        ...(parts.BYDAY ? { byDay: parts.BYDAY.split(",").map((entry) => entry.trim()).filter(Boolean) } : {}),
        ...(integers(parts.BYMONTHDAY) ? { byMonthDay: integers(parts.BYMONTHDAY) } : {}),
        ...(integers(parts.BYMONTH) ? { byMonth: integers(parts.BYMONTH) } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(untilDate ? { until: untilDate } : {}),
        exceptions: [],
    };
}

/** One `VEVENT`'s fields as they are gathered, before its `DTEND`/`DURATION` are reconciled into an end. */
interface RawVEvent {
    uid?: string;
    start?: { at: Date; allDay: boolean; timezone?: string };
    /** `DTSTART`'s resolved zone, kept so an `RRULE`'s `UNTIL` is bounded on the same local-day footing. */
    timezone?: string;
    end?: Date;
    allDayEnd?: boolean;
    durationMs?: number;
    recurrenceId?: Date;
    rule?: RecurrenceRule;
    exceptions: Date[];
    cancelled: boolean;
    transparent: boolean;
}

/**
 * Every `VEVENT` of an ICS payload, as the busy rows `computeBusyWindows()` expands. Folded continuation lines are
 * joined first (RFC 5545 §3.1 wraps a long property with a leading space or tab), and a property is only read for the
 * innermost open `VEVENT` - a `VTIMEZONE`'s `DTSTART` or a nested `VALARM`'s properties are not the event's own.
 *
 * Events with no `UID`, no `DTSTART`, or no determinable end (an all-day event with neither `DTEND` nor `DURATION`
 * occupies its whole local day; a timed event with neither occupies nothing, per RFC 5545 §3.8.2.2) are dropped.
 * `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` are kept as rows marked the way `computeBusyWindows()` skips them, so the
 * cancellation of one occurrence of a series still excludes that occurrence from the master's expansion.
 */
export function parseIcsBusyFeed(raw: string, sourceUid: string): BusyEventRow[] {
    const unfolded: string = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").replace(/\r[ \t]/g, "");
    const events: RawVEvent[] = [];
    let current: RawVEvent | undefined;
    let currentDepth: number = 0;
    const stack: string[] = [];
    for (const line of unfolded.split(/\r\n|\r|\n/)) {
        // The value starts at the first colon outside a quoted parameter (`CN="Doe: John"`).
        const match = /^([A-Za-z0-9-]+)((?:;(?:[^:;"]|"[^"]*")*)*):(.*)$/.exec(line);
        if (!match) {
            continue;
        }
        const property: string = match[1].toUpperCase();
        const params: Record<string, string> = {};
        for (const entry of match[2].replace(/^;/, "").split(";")) {
            const split: number = entry.indexOf("=");
            if (split > 0) {
                params[entry.slice(0, split).trim().toUpperCase()] = entry.slice(split + 1).trim().replace(/^"|"$/g, "");
            }
        }
        const value: string = match[3];
        if (property === "BEGIN") {
            const component: string = value.trim().toUpperCase();
            stack.push(component);
            if (component === "VEVENT" && stack.length <= 2 && (stack.length === 1 || stack[0] === "VCALENDAR")) {
                current = { exceptions: [], cancelled: false, transparent: false };
                currentDepth = stack.length;
                events.push(current);
            }
            continue;
        }
        if (property === "END") {
            const index: number = stack.lastIndexOf(value.trim().toUpperCase());
            // Tolerate a mismatched END by unwinding to the nearest matching BEGIN, if there is one.
            if (index >= 0) {
                stack.length = index;
            }
            if (stack.length < currentDepth) {
                current = undefined;
            }
            continue;
        }
        // Only a property of the innermost open VEVENT belongs to that VEVENT - a nested VALARM's property, or a
        // VTIMEZONE's `DTSTART`, is not the event's own.
        if (!current || stack.length !== currentDepth) {
            continue;
        }
        switch (property) {
            case "UID":
                current.uid = value.trim();
                break;
            case "DTSTART": {
                const dateValue: boolean = params.VALUE === "DATE" || /^\d{8}$/.test(value.trim());
                const stamp = parseIcsStamp(value, params.TZID, dateValue);
                if (stamp) {
                    current.start = stamp;
                    current.timezone = stamp.timezone;
                }
                break;
            }
            case "DTEND": {
                const stamp = parseIcsStamp(value, params.TZID, params.VALUE === "DATE" || /^\d{8}$/.test(value.trim()));
                if (stamp) {
                    current.end = stamp.at;
                    current.allDayEnd = stamp.allDay;
                }
                break;
            }
            case "DURATION":
                current.durationMs = parseIcsDuration(value);
                break;
            case "RRULE":
                current.rule = parseIcsRrule(value, current.timezone);
                break;
            case "EXDATE":
                for (const part of value.split(",")) {
                    const stamp = parseIcsStamp(part, params.TZID, params.VALUE === "DATE" || /^\d{8}$/.test(part.trim()));
                    if (stamp) {
                        current.exceptions.push(stamp.at);
                    }
                }
                break;
            case "RECURRENCE-ID": {
                const stamp = parseIcsStamp(value, params.TZID, params.VALUE === "DATE" || /^\d{8}$/.test(value.trim()));
                if (stamp) {
                    current.recurrenceId = stamp.at;
                }
                break;
            }
            case "STATUS":
                current.cancelled = value.trim().toUpperCase() === "CANCELLED";
                break;
            case "TRANSP":
                current.transparent = value.trim().toUpperCase() === "TRANSPARENT";
                break;
            default:
                // Everything else - SUMMARY, LOCATION, DESCRIPTION, ATTENDEE, ORGANIZER, ... - is deliberately unread
                // (see the module doc comment): this path takes time off the calendar, not its contents.
                break;
        }
    }

    const rows: BusyEventRow[] = [];
    for (const event of events) {
        if (!event.uid || !event.start) {
            continue;
        }
        let end: Date | undefined = event.end;
        if (!end && event.durationMs !== undefined) {
            end = new Date(event.start.at.getTime() + event.durationMs);
        }
        if (!end && event.start.allDay) {
            // An all-day event with no DTEND/DURATION is the whole day it names (RFC 5545 §3.8.5.1 example).
            end = new Date(event.start.at.getTime() + 24 * 3600_000);
        }
        if (!end || end.getTime() <= event.start.at.getTime()) {
            continue;
        }
        const rule: RecurrenceRule | undefined = event.rule;
        if (rule && event.exceptions.length > 0) {
            rule.exceptions = event.exceptions;
        }
        rows.push({
            // Prefixed with the source, so two feeds that happen to use the same `UID` still exclude each master's own
            // overrides (`computeBusyWindows()` matches a master's siblings by `icalUid`) and never each other's.
            uid: `${sourceUid}:${event.uid}${event.recurrenceId ? `:${event.recurrenceId.getTime()}` : ""}`,
            icalUid: `${sourceUid}:${event.uid}`,
            startDate: event.start.at,
            endDate: end,
            // A timed event's zone; an all-day event (UTC midnights) carries none, exactly as a stored row does.
            ...(!event.start.allDay && event.start.timezone ? { timezone: event.start.timezone } : {}),
            allDay: event.start.allDay,
            status: event.cancelled ? CalendarEventStatus.CANCELLED : CalendarEventStatus.CONFIRMED,
            busyStatus: event.transparent ? BusyStatus.FREE : BusyStatus.BUSY,
            ...(rule ? { recurrenceRule: rule } : {}),
            ...(event.recurrenceId ? { recurrenceId: event.recurrenceId } : {}),
        });
    }
    return rows;
}

/** How a feed's bytes are read: `fetchIcsFeed()`'s own options, every one of them supplied. */
export interface FeedFetchOptions {
    timeoutMs: number;
    maxBytes: number;
    lookup: HostLookup;
    /** `https.request`, or a double in tests. */
    request?: typeof https.request;
}

/** How a feed is read: injectable doubles for tests, exactly as crm-plugin's `postWebhook()` takes its own. */
export interface ExternalBusyOptions {
    lookup?: HostLookup;
    timeoutMs?: number;
    maxBytes?: number;
    /** `https.request`, or a double in tests. */
    request?: typeof https.request;
    /** Fetches the URL's ICS text. Throws on any failure, including a refused address or an oversized body. */
    fetchFeed?: (url: string, options: FeedFetchOptions) => Promise<string>;
    /** The `Date.now()` the cache ages against. */
    now?: () => number;
    /** The per-process fetched-feed cache; pass your own to start from nothing. */
    cache?: Map<string, { fetchedAt: number; rows: BusyEventRow[] }>;
}

/** One cache for the whole process; a `Map` entry per feed URL, so every booking type sharing a feed shares the fetch. */
const feedCache: Map<string, { fetchedAt: number; rows: BusyEventRow[] }> = new Map();

/**
 * Reads one feed over `https://`: the host is resolved and every address it resolves to must be public, the connection is
 * pinned to the first of those addresses (host name kept for TLS and `Host`), redirects are not followed, the body is
 * capped at `maxBytes`, and the whole exchange is bounded by `timeoutMs`.
 */
export async function fetchIcsFeed(url: string, options: FeedFetchOptions): Promise<string> {
    const refused: string | undefined = checkExternalBusyFeedUrl(url);
    if (refused) {
        throw new Error(refused);
    }
    const parsed: URL = new URL(url);
    const host: string = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses: { address: string; family: number }[] = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await options.lookup(host);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
        throw new Error("The calendar's address resolves to a private network.");
    }
    const target: { address: string; family: number } = addresses[0];
    const send: typeof https.request = options.request ?? https.request;
    return await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size: number = 0;
        let settled: boolean = false;
        const done = (err?: Error, body?: string): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (err) {
                reject(err);
            } else {
                resolve(body!);
            }
        };
        const request = send(
            {
                protocol: "https:",
                hostname: host,
                port: parsed.port || 443,
                path: `${parsed.pathname}${parsed.search}`,
                method: "GET",
                headers: { accept: "text/calendar, text/plain, */*", "user-agent": "RapidMX-Booking/1" },
                timeout: options.timeoutMs,
                lookup: (_hostname: string, _opts: any, callback: any) => callback(null, target.address, target.family),
            },
            (response) => {
                const status: number = response.statusCode ?? 0;
                if (status >= 300 && status < 400) {
                    response.resume();
                    done(new Error("The calendar's address redirected, which is not followed."));
                    return;
                }
                if (status !== 200) {
                    response.resume();
                    done(new Error(`The calendar's address answered ${status}.`));
                    return;
                }
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > options.maxBytes) {
                        response.destroy();
                        done(new Error("The calendar's data was larger than the maximum that is read."));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", () => done(undefined, Buffer.concat(chunks).toString("utf-8")));
                response.on("error", (err: Error) => done(err));
            },
        );
        request.on("timeout", () => request.destroy(new Error(`The calendar's address did not answer within ${Math.round(options.timeoutMs / 1000)} seconds.`)));
        request.on("error", (err: Error) => done(err));
        request.end();
    });
}

/**
 * The busy windows every one of `sources` claims inside `[windowStart, windowEnd]`, plus what went wrong per source.
 *
 * A feed's parsed events are cached for `FEED_CACHE_MS` (booking pages are browsed by many visitors at once; each
 * visitor's slot query otherwise re-fetches every feed) and, when a live fetch fails, a cache up to `FEED_STALE_MS` old
 * is still used - a feed that is briefly down must not hand out the slots it has been blocking all week. With nothing
 * cached, a failing source contributes no windows and its `error` says so; the caller logs it. That fail-open is the
 * deliberate trade: the alternative is a booking page that offers nothing because somebody else's calendar server is
 * having a bad afternoon, and the host's own calendar keeps blocking either way.
 */
export async function externalBusyWindows(
    sources: ExternalBusySource[],
    windowStart: Date,
    windowEnd: Date,
    options: ExternalBusyOptions = {},
): Promise<Record<string, ExternalBusyOutcome>> {
    const { timeoutMs = FEED_TIMEOUT_MS, maxBytes = MAX_FEED_BYTES, lookup = defaultLookup, request, cache = feedCache, now = () => Date.now() } = options;
    const fetchFeed = options.fetchFeed ?? fetchIcsFeed;
    const outcomes: Record<string, ExternalBusyOutcome> = {};
    await Promise.all(
        sources.map(async (source): Promise<void> => {
            const entry = cache.get(source.url);
            const fresh: boolean = !!entry && now() - entry.fetchedAt < FEED_CACHE_MS;
            if (fresh) {
                outcomes[source.uid] = { windows: computeBusyWindows(entry!.rows as unknown as CalendarEvent[], windowStart, windowEnd), cachedMs: now() - entry!.fetchedAt };
                return;
            }
            let rows: BusyEventRow[] | undefined;
            try {
                rows = parseIcsBusyFeed(await fetchFeed(source.url, { timeoutMs, maxBytes, lookup, request }), source.uid);
                cache.set(source.url, { fetchedAt: now(), rows });
            } catch (err: any) {
                if (!entry || now() - entry.fetchedAt > FEED_STALE_MS) {
                    outcomes[source.uid] = { windows: [], error: err?.message ?? String(err) };
                    return;
                }
                rows = entry.rows;
            }
            outcomes[source.uid] = {
                windows: computeBusyWindows(rows as unknown as CalendarEvent[], windowStart, windowEnd),
                ...(entry ? { cachedMs: now() - entry.fetchedAt } : {}),
            };
        }),
    );
    for (const source of sources) {
        outcomes[source.uid] ||= { windows: [], error: "The calendar was not read." };
    }
    return outcomes;
}

/** Drops every cached feed. Only for tests and for a settings change that must take effect at once. */
export function clearExternalBusyCache(cache: Map<string, { fetchedAt: number; rows: BusyEventRow[] }> = feedCache): void {
    cache.clear();
}
