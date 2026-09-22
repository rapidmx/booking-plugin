///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { useState } from "react";
import { BookingLocationOption, BookingLocationType, BookingMeetingType } from "../bookingApi.js";
import Button from "@rapidmx/react-shared/components/buttons/Button.js";

const INPUT_CLASS =
    "text-sm py-2 px-3 border border-border rounded-sm bg-surface text-text focus:outline-none focus:border-primary";

const LOCATION_TYPE_LABELS: Record<BookingLocationType, string> = {
    [BookingLocationType.PHONE]: "Phone",
    [BookingLocationType.VIDEO]: "Video call",
    [BookingLocationType.OTHER]: "Other",
};

/** A client-only id so new rows have stable React keys before the server assigns their real `uid` on save -
 * `BaseBookingTypeRoute.normalizeMeetingTypeUids()` mints the real one for any entry that still has none. */
function tempId(): string {
    return `tmp-${Math.random().toString(36).slice(2)}`;
}

function emptyLocationOption(): BookingLocationOption {
    return { uid: tempId(), type: BookingLocationType.VIDEO };
}

function emptyMeetingType(): BookingMeetingType {
    return { uid: tempId(), name: "", durationMinutes: 30, locationOptions: [emptyLocationOption()] };
}

export interface MeetingTypesEditorProps {
    value: BookingMeetingType[];
    onChange: (value: BookingMeetingType[]) => void;
}

/**
 * Adds/edits/removes a `BookingType`'s `meetingTypes` - each with its own name, duration, and a nested list of
 * `locationOptions` a booker will choose from. Same overall shape as `AvailabilityEditor`, but edits entries in
 * place (by index) rather than only appending, since a meeting type has several fields worth revisiting instead
 * of one add/remove line item.
 */
export default function MeetingTypesEditor({ value, onChange }: MeetingTypesEditorProps) {
    const [error, setError] = useState<string | null>(null);

    function updateMeetingType(index: number, patch: Partial<BookingMeetingType>) {
        onChange(value.map((mt, i) => (i === index ? { ...mt, ...patch } : mt)));
    }

    function updateLocationOption(meetingIndex: number, optionIndex: number, patch: Partial<BookingLocationOption>) {
        const meetingType = value[meetingIndex];
        const locationOptions = meetingType.locationOptions.map((option, i) => (i === optionIndex ? { ...option, ...patch } : option));
        updateMeetingType(meetingIndex, { locationOptions });
    }

    function addMeetingType() {
        onChange([...value, emptyMeetingType()]);
    }

    function removeMeetingType(index: number) {
        if (value.length <= 1) {
            setError("At least one meeting type is required.");
            return;
        }
        setError(null);
        onChange(value.filter((_, i) => i !== index));
    }

    function addLocationOption(meetingIndex: number) {
        const meetingType = value[meetingIndex];
        updateMeetingType(meetingIndex, { locationOptions: [...meetingType.locationOptions, emptyLocationOption()] });
    }

    function removeLocationOption(meetingIndex: number, optionIndex: number) {
        const meetingType = value[meetingIndex];
        if (meetingType.locationOptions.length <= 1) {
            setError("Each meeting type needs at least one location option.");
            return;
        }
        setError(null);
        updateMeetingType(meetingIndex, { locationOptions: meetingType.locationOptions.filter((_, i) => i !== optionIndex) });
    }

    return (
        <div className="flex flex-col gap-4">
            {error && <p className="text-sm text-danger">{error}</p>}
            {value.map((meetingType, meetingIndex) => (
                <div key={meetingType.uid ?? meetingIndex} className="border border-border rounded-sm p-3 flex flex-col gap-3">
                    <div className="flex items-end gap-3">
                        <label className="flex-1 flex flex-col gap-1">
                            <span className="text-xs font-medium text-text-muted">Meeting type name</span>
                            <input
                                type="text"
                                className={INPUT_CLASS}
                                value={meetingType.name}
                                placeholder="30 Minute Meeting"
                                onChange={(e) => updateMeetingType(meetingIndex, { name: e.target.value })}
                            />
                        </label>
                        <label className="w-36 flex flex-col gap-1">
                            <span className="text-xs font-medium text-text-muted">Duration (minutes)</span>
                            <input
                                type="number"
                                min={1}
                                className={INPUT_CLASS}
                                value={meetingType.durationMinutes}
                                onChange={(e) => updateMeetingType(meetingIndex, { durationMinutes: Number(e.target.value) })}
                            />
                        </label>
                        <button
                            type="button"
                            aria-label="Remove meeting type"
                            onClick={() => removeMeetingType(meetingIndex)}
                            className="text-sm text-danger hover:underline mb-2.5"
                        >
                            Remove
                        </button>
                    </div>

                    <div>
                        <span className="block text-xs font-medium text-text-muted mb-1.5">Location options</span>
                        <ul className="flex flex-col gap-2">
                            {meetingType.locationOptions.map((option, optionIndex) => (
                                <li key={option.uid ?? optionIndex} className="flex items-end gap-2">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-text-muted">Type</span>
                                        <select
                                            className={INPUT_CLASS}
                                            value={option.type}
                                            onChange={(e) =>
                                                updateLocationOption(meetingIndex, optionIndex, { type: e.target.value as BookingLocationType })
                                            }
                                        >
                                            {Object.values(BookingLocationType).map((type) => (
                                                <option key={type} value={type}>
                                                    {LOCATION_TYPE_LABELS[type]}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="flex-1 flex flex-col gap-1">
                                        <span className="text-xs text-text-muted">Label (optional)</span>
                                        <input
                                            type="text"
                                            className={INPUT_CLASS}
                                            value={option.label ?? ""}
                                            placeholder={LOCATION_TYPE_LABELS[option.type]}
                                            onChange={(e) => updateLocationOption(meetingIndex, optionIndex, { label: e.target.value || undefined })}
                                        />
                                    </label>
                                    {option.type === BookingLocationType.VIDEO && (
                                        <label className="flex-1 flex flex-col gap-1">
                                            <span className="text-xs text-text-muted">Meeting URL (optional)</span>
                                            <input
                                                type="text"
                                                className={INPUT_CLASS}
                                                value={option.videoUrl ?? ""}
                                                placeholder="https://..."
                                                onChange={(e) =>
                                                    updateLocationOption(meetingIndex, optionIndex, { videoUrl: e.target.value || undefined })
                                                }
                                            />
                                        </label>
                                    )}
                                    <button
                                        type="button"
                                        aria-label="Remove location option"
                                        onClick={() => removeLocationOption(meetingIndex, optionIndex)}
                                        className="text-sm text-danger hover:underline mb-2.5"
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <Button
                            type="button"
                            variant="secondary"
                            className="!w-auto mt-2"
                            onClick={() => addLocationOption(meetingIndex)}
                        >
                            Add location option
                        </Button>
                    </div>
                </div>
            ))}
            <Button type="button" variant="secondary" className="!w-auto self-start" onClick={addMeetingType}>
                Add meeting type
            </Button>
        </div>
    );
}
