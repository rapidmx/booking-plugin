///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { ChangeEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "@rapidmx/react-shared/util/api.js";
import Alert from "@rapidmx/react-shared/components/feedback/Alert.js";
import Button from "@rapidmx/react-shared/components/buttons/Button.js";
import {
    BookingProfile,
    BookingProfileImage,
    bookingProfileImageUrl,
    deleteBookingProfileImage,
    getBookingProfile,
    uploadBookingProfileImage,
} from "../bookingApi.js";
import { AVATAR_TARGET, BANNER_TARGET, resizeToCover } from "../imageResize.js";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/** What the mailbox's booking pages show, and the size each image is uploaded at (see `imageResize.ts`). */
const IMAGES: { image: BookingProfileImage; label: string; target: typeof AVATAR_TARGET }[] = [
    { image: "banner", label: "banner", target: BANNER_TARGET },
    { image: "avatar", label: "avatar", target: AVATAR_TARGET },
];

/**
 * The mailbox's avatar and banner — shown at the top of every one of its public booking pages. A picked image is
 * cropped and scaled in the browser first, so any photo is fine; it is saved as soon as it is picked.
 */
export default function BookingProfileEditor({ mailboxUid, name }: { mailboxUid: string; name: string }) {
    const [profile, setProfile] = useState<BookingProfile | null>(null);
    const [busy, setBusy] = useState<BookingProfileImage | null>(null);
    const [error, setError] = useState<string | null>(null);
    const inputs = useRef<Partial<Record<BookingProfileImage, HTMLInputElement | null>>>({});

    useEffect(() => {
        let cancelled = false;
        getBookingProfile(mailboxUid)
            .then((loaded) => !cancelled && setProfile(loaded))
            .catch((err) => !cancelled && setError(err instanceof ApiRequestError ? err.message : "Could not load the booking page's look."));
        return () => {
            cancelled = true;
        };
    }, [mailboxUid]);

    const version = (image: BookingProfileImage): string | undefined => (image === "avatar" ? profile?.avatarVersion : profile?.bannerVersion);

    async function handlePick(image: BookingProfileImage, target: typeof AVATAR_TARGET, e: ChangeEvent<HTMLInputElement>) {
        const file: File | undefined = e.target.files?.[0];
        // The same file can be picked again after it was removed.
        e.target.value = "";
        if (!file) {
            return;
        }
        setBusy(image);
        setError(null);
        try {
            setProfile(await uploadBookingProfileImage(mailboxUid, image, await resizeToCover(file, target)));
        } catch (err) {
            setError(err instanceof Error ? err.message : `Could not save the ${image}.`);
        } finally {
            setBusy(null);
        }
    }

    async function handleRemove(image: BookingProfileImage) {
        setBusy(image);
        setError(null);
        try {
            setProfile(await deleteBookingProfileImage(mailboxUid, image));
        } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : `Could not remove the ${image}.`);
        } finally {
            setBusy(null);
        }
    }

    const bannerVersion = version("banner");
    const avatarVersion = version("avatar");

    return (
        <section aria-label="Booking page appearance" className="border border-border rounded-md overflow-hidden mb-6">
            <div className="relative">
                <div className="h-28 sm:h-32 bg-gradient-to-r from-primary-dark to-primary">
                    {bannerVersion && (
                        <img
                            src={bookingProfileImageUrl(mailboxUid, "banner", bannerVersion)}
                            alt="Banner preview"
                            className="h-full w-full object-cover"
                        />
                    )}
                </div>
                <div className="absolute -bottom-8 left-5 h-16 w-16 overflow-hidden rounded-full border-4 border-surface bg-primary text-white flex items-center justify-center text-2xl font-bold">
                    {avatarVersion ? (
                        <img
                            src={bookingProfileImageUrl(mailboxUid, "avatar", avatarVersion)}
                            alt="Avatar preview"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <span aria-hidden="true">{(Array.from(name.trim())[0] ?? "?").toUpperCase()}</span>
                    )}
                </div>
            </div>
            <div className="p-5 pt-11">
                <h2 className="text-sm font-bold">Booking page appearance</h2>
                <p className="text-sm text-text-muted mb-3">
                    The banner and avatar shown at the top of every booking page for this mailbox.
                </p>
                {error && <Alert>{error}</Alert>}
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {IMAGES.map(({ image, label, target }) => (
                        <div key={image} className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                className="!w-auto"
                                loading={busy === image}
                                disabled={busy !== null}
                                onClick={() => inputs.current[image]?.click()}
                            >
                                {version(image) ? `Change ${label}` : `Upload ${label}`}
                            </Button>
                            {version(image) && (
                                <Button type="button" variant="text" disabled={busy !== null} onClick={() => handleRemove(image)}>
                                    Remove {label}
                                </Button>
                            )}
                            <input
                                ref={(element) => {
                                    inputs.current[image] = element;
                                }}
                                type="file"
                                accept={ACCEPTED_TYPES}
                                aria-label={`${image === "banner" ? "Banner" : "Avatar"} image file`}
                                className="sr-only"
                                tabIndex={-1}
                                onChange={(e) => handlePick(image, target, e)}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
