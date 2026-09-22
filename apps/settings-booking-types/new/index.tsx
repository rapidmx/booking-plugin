///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { FormEvent, useEffect, useState } from "react";
import { ApiRequestError } from "@rapidmx/react-shared/util/api.js";
import { Folder, listFolders } from "@rapidmx/react-shared/mail/mailApi.js";
import { BookingAvailabilityWindow, BookingLocationType, BookingMeetingType, createBookingType } from "../../shared/bookingApi.js";
import SettingsShell, { SettingsShellProps, useSettingsShell } from "@rapidmx/web-client/shared/components/settings/layout/SettingsShell.js";
import AvailabilityEditor from "../../shared/components/AvailabilityEditor.js";
import MeetingTypesEditor from "../../shared/components/MeetingTypesEditor.js";
import MailboxSelect from "../../shared/components/MailboxSelect.js";
import Alert from "@rapidmx/react-shared/components/feedback/Alert.js";
import Button from "@rapidmx/react-shared/components/buttons/Button.js";
import FormField from "@rapidmx/react-shared/components/forms/FormField.js";

const INPUT_CLASS =
    "w-full text-sm py-2.5 px-3 border border-border rounded-sm bg-surface text-text focus:outline-none focus:border-primary";

export type NewBookingTypePageProps = Omit<SettingsShellProps, "active">;

export default function NewBookingTypePage(props: NewBookingTypePageProps) {
    return (
        <SettingsShell {...props} active="booking-types">
            <NewBookingTypeForm />
        </SettingsShell>
    );
}

function NewBookingTypeForm() {
    const { mailboxUid: shellMailboxUid, mailboxes } = useSettingsShell();
    // The link starts out for the mailbox Settings is showing, and can be given to any other one. Same established
    // non-null pattern as `@rapidmx/web-client`'s new filter page.
    const [mailboxUid, setMailboxUid] = useState<string>(shellMailboxUid!);
    const mailbox = mailboxes.find((mb) => mb.uid === mailboxUid)!;

    const [calendarFolderUid, setCalendarFolderUid] = useState<string | null>(null);
    const [folderError, setFolderError] = useState<string | null>(null);
    const [slug, setSlug] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [hostDisplayName, setHostDisplayName] = useState(mailbox.displayName);
    const [meetingTypes, setMeetingTypes] = useState<BookingMeetingType[]>([
        { name: "30 Minute Meeting", durationMinutes: 30, locationOptions: [{ type: BookingLocationType.VIDEO }] },
    ]);
    const [timezone, setTimezone] = useState(mailbox.timezone);
    const [availability, setAvailability] = useState<BookingAvailabilityWindow[]>([]);
    const [minimumNoticeMinutes, setMinimumNoticeMinutes] = useState(60);
    const [bookingWindowDays, setBookingWindowDays] = useState(30);
    const [requiresApproval, setRequiresApproval] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // The calendar bookings are written into belongs to the chosen mailbox, so it is looked up again whenever that changes.
    useEffect(() => {
        let cancelled = false;
        setCalendarFolderUid(null);
        setFolderError(null);
        listFolders(mailboxUid)
            .then((folders) => {
                if (cancelled) {
                    return;
                }
                const calendar = folders.find((f: Folder) => f.type === "calendar");
                if (!calendar) {
                    setFolderError("This mailbox has no Calendar folder yet.");
                    return;
                }
                setCalendarFolderUid(calendar.uid);
            })
            .catch((err) => {
                if (!cancelled) {
                    setFolderError(err instanceof ApiRequestError ? err.message : "Could not load this mailbox's folders.");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [mailboxUid]);

    /** Switches mailbox, taking the new mailbox's name and timezone along unless the user has already typed their own. */
    function handleMailboxChange(nextUid: string) {
        const next = mailboxes.find((mb) => mb.uid === nextUid)!;
        if (hostDisplayName === mailbox.displayName) {
            setHostDisplayName(next.displayName);
        }
        if (timezone === mailbox.timezone) {
            setTimezone(next.timezone);
        }
        setMailboxUid(nextUid);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);

        if (!slug.trim() || !name.trim() || !hostDisplayName.trim()) {
            setError("Slug, name, and host name are all required.");
            return;
        }
        if (!calendarFolderUid) {
            setError("This mailbox has no Calendar folder yet.");
            return;
        }
        if (meetingTypes.length === 0 || meetingTypes.some((mt) => !mt.name.trim() || mt.locationOptions.length === 0)) {
            setError("Every meeting type needs a name and at least one location option.");
            return;
        }

        setSaving(true);
        try {
            const created = await createBookingType({
                mailboxUid,
                calendarFolderUid,
                slug: slug.trim(),
                name: name.trim(),
                description: description.trim() || undefined,
                hostDisplayName: hostDisplayName.trim(),
                meetingTypes,
                timezone,
                availability,
                minimumNoticeMinutes,
                bookingWindowDays,
                requiresApproval,
            });
            window.location.href = `/settings/booking-types/${encodeURIComponent(created.uid)}?mailboxUid=${encodeURIComponent(mailboxUid)}`;
        } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : "Could not create this booking link.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <div className="max-w-2xl">
                <h1 className="text-lg font-bold tracking-tight mb-1">New booking link</h1>
                <p className="text-sm text-text-muted mb-5">
                    Anyone with the link can pick an open slot from your live availability below — no account
                    needed on their end.
                </p>

                {error && <Alert>{error}</Alert>}
                {folderError && <Alert>{folderError}</Alert>}

                <form onSubmit={handleSubmit} className="flex flex-col gap-1">
                    <FormField label="Mailbox" htmlFor="mailboxUid">
                        <MailboxSelect id="mailboxUid" mailboxes={mailboxes} value={mailboxUid} onChange={handleMailboxChange} />
                    </FormField>
                    <FormField label="Name" htmlFor="name">
                        <input
                            id="name"
                            type="text"
                            className={INPUT_CLASS}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="30 Minute Intro Call"
                        />
                    </FormField>
                    <FormField label="Slug (used in the public link)" htmlFor="slug">
                        <input
                            id="slug"
                            type="text"
                            className={INPUT_CLASS}
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            placeholder="intro-call"
                        />
                    </FormField>
                    <FormField label="Description (optional)" htmlFor="description">
                        <textarea
                            id="description"
                            className={INPUT_CLASS}
                            rows={2}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </FormField>
                    <FormField label="Host name shown to visitors" htmlFor="hostDisplayName">
                        <input
                            id="hostDisplayName"
                            type="text"
                            className={INPUT_CLASS}
                            value={hostDisplayName}
                            onChange={(e) => setHostDisplayName(e.target.value)}
                        />
                    </FormField>
                    <FormField label="Timezone" htmlFor="timezone">
                        <input
                            id="timezone"
                            type="text"
                            className={INPUT_CLASS}
                            value={timezone}
                            onChange={(e) => setTimezone(e.target.value)}
                            placeholder="America/New_York"
                        />
                    </FormField>

                    <div className="mb-4">
                        <span className="block text-sm font-semibold mb-1.5 text-text">Meeting types</span>
                        <MeetingTypesEditor value={meetingTypes} onChange={setMeetingTypes} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <FormField label="Minimum notice (minutes)" htmlFor="minimumNoticeMinutes">
                            <input
                                id="minimumNoticeMinutes"
                                type="number"
                                min={0}
                                className={INPUT_CLASS}
                                value={minimumNoticeMinutes}
                                onChange={(e) => setMinimumNoticeMinutes(Number(e.target.value))}
                            />
                        </FormField>
                        <FormField label="Booking window (days ahead)" htmlFor="bookingWindowDays">
                            <input
                                id="bookingWindowDays"
                                type="number"
                                min={1}
                                className={INPUT_CLASS}
                                value={bookingWindowDays}
                                onChange={(e) => setBookingWindowDays(Number(e.target.value))}
                            />
                        </FormField>
                    </div>
                    <label className="flex items-center gap-2 text-sm my-3">
                        <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
                        Require my approval before confirming a booking
                    </label>

                    <div className="mb-4">
                        <span className="block text-sm font-semibold mb-1.5 text-text">Weekly availability</span>
                        <AvailabilityEditor value={availability} onChange={setAvailability} />
                    </div>

                    <div>
                        <Button type="submit" loading={saving} disabled={saving} className="!w-auto">
                            Create
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
