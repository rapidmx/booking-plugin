///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { useState } from "react";
import { ExternalBusySource } from "../bookingApi.js";
import Button from "@rapidmx/web-client/lib/components/buttons/Button.js";

const INPUT_CLASS =
    "w-full text-sm py-2 px-3 border border-border rounded-sm bg-surface text-text focus:outline-none focus:border-primary";

/** At most this many calendars, matching `MAX_EXTERNAL_BUSY_SOURCES` on the server. */
const MAX_SOURCES = 10;

/** A client-only id so new rows have stable React keys before the server assigns their real `uid` on save -
 * `BaseBookingTypeRoute.normalizeExternalBusySourceUids()` mints the real one for any entry that still has none. */
function tempId(): string {
    return `tmp-${Math.random().toString(36).slice(2)}`;
}

function emptySource(): ExternalBusySource {
    return { uid: tempId(), label: "", url: "" };
}

export interface ExternalBusyEditorProps {
    value: ExternalBusySource[];
    onChange: (value: ExternalBusySource[]) => void;
}

/**
 * Adds/edits/removes the external calendars whose busy time blocks this booking link's slots - the "Connected
 * calendars" panel (rapidmx/server#11). A source is a calendar's published ICS address: what Google Calendar calls its
 * "secret address in iCal format", and the download link most other calendar servers publish. Same shape as
 * `MeetingTypesEditor`: rows edited in place, the list sent whole on save.
 *
 * The privacy note below is deliberate, not decorative: it is the one place a host learns that only busy intervals are
 * read, which is also what the server actually does (`util/ExternalBusyUtils.ts` never parses a summary, a location or
 * an attendee out of a feed).
 */
export default function ExternalBusyEditor({ value, onChange }: ExternalBusyEditorProps) {
    const [error, setError] = useState<string | null>(null);

    function update(index: number, patch: Partial<ExternalBusySource>) {
        onChange(value.map((source, i) => (i === index ? { ...source, ...patch } : source)));
    }

    function add() {
        if (value.length >= MAX_SOURCES) {
            setError(`At most ${MAX_SOURCES} calendars can be connected.`);
            return;
        }
        setError(null);
        onChange([...value, emptySource()]);
    }

    function remove(index: number) {
        setError(null);
        onChange(value.filter((_, i) => i !== index));
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
                Busy times on these calendars block slots on this link, exactly like your own calendar does. Paste a
                calendar&apos;s private ICS address (in Google Calendar: Settings &rsaquo; Integrations &rsaquo;
                "Secret address in iCal format"). Only when someone is busy is read - never event titles, locations or
                guests.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            {value.length === 0 && <p className="text-sm text-text-muted">No calendars connected yet.</p>}
            <ul className="flex flex-col gap-3">
                {value.map((source, index) => (
                    <li key={source.uid ?? index} className="border border-border rounded-sm p-3 flex flex-col gap-2">
                        <div className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-text-muted">Name (optional)</span>
                                <input
                                    type="text"
                                    className={INPUT_CLASS}
                                    placeholder="Spouse"
                                    value={source.label ?? ""}
                                    onChange={(e) => update(index, { label: e.target.value })}
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-text-muted">Calendar address (https)</span>
                                <input
                                    type="url"
                                    className={INPUT_CLASS}
                                    placeholder="https://calendar.example.com/private.ics"
                                    value={source.url}
                                    onChange={(e) => update(index, { url: e.target.value })}
                                />
                            </label>
                        </div>
                        <button
                            type="button"
                            aria-label="Remove calendar"
                            onClick={() => remove(index)}
                            className="self-start text-sm text-danger hover:underline"
                        >
                            Remove
                        </button>
                    </li>
                ))}
            </ul>
            <Button type="button" variant="secondary" className="!w-auto self-start" onClick={add}>
                Connect a calendar
            </Button>
        </div>
    );
}
