///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import React, { useEffect, useState } from "react";
import { ApiRequestError } from "@rapidmx/web-client/lib/util/api.js";
import Alert from "@rapidmx/web-client/lib/components/feedback/Alert.js";
import ImageEditBadge from "@rapidmx/web-client/lib/components/forms/ImageEditBadge.js";
import {
    BookingProfile,
    BookingProfileImage,
    bookingProfileImageUrl,
    deleteBookingProfileImage,
    getBookingProfile,
    uploadBookingProfileImage,
} from "../bookingApi.js";
import { AVATAR_TARGET, BANNER_TARGET, resizeToCover } from "../imageResize.js";

/** What the mailbox's booking pages show, and the size each image is uploaded at (see `imageResize.ts`). */
const IMAGES: { image: BookingProfileImage; label: string; target: typeof AVATAR_TARGET }[] = [
    { image: "banner", label: "banner", target: BANNER_TARGET },
    { image: "avatar", label: "avatar", target: AVATAR_TARGET },
];

/** The spinner over an image while it is being saved or removed. */
function Saving() {
    return (
        <span role="status" aria-label="Saving" className="absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        </span>
    );
}

/**
 * The mailbox's avatar and banner — shown at the top of every one of its public booking pages. Each has a camera badge
 * (`ImageEditBadge`) on its corner whose menu uploads a file, takes a photo or removes the image. A picked or taken image is
 * cropped and scaled in the browser first, so any photo is fine; it is saved as soon as it is picked.
 */
export default function BookingProfileEditor({ mailboxUid, name }: { mailboxUid: string; name: string }) {
    const [profile, setProfile] = useState<BookingProfile | null>(null);
    const [busy, setBusy] = useState<BookingProfileImage | null>(null);
    const [error, setError] = useState<string | null>(null);

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

    async function handlePick(image: BookingProfileImage, target: typeof AVATAR_TARGET, file: File) {
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

    const badge = (image: BookingProfileImage, position: "bottom-right" | "top-right") => {
        const { label, target } = IMAGES.find((entry) => entry.image === image)!;
        return (
            <ImageEditBadge
                position={position}
                label={`Change ${label}`}
                fileInputLabel={`${image === "banner" ? "Banner" : "Avatar"} image file`}
                hasImage={!!version(image)}
                busy={busy !== null}
                onFile={(file) => void handlePick(image, target, file)}
                onRemove={() => void handleRemove(image)}
            />
        );
    };

    return (
        <section aria-label="Booking page appearance" className="border border-border rounded-md overflow-hidden mb-6">
            <div className="relative">
                {/* A banner that is not set is an empty, dashed area (the page then shows its default colours) with the badge on it. */}
                <div
                    className={`relative h-28 sm:h-32 bg-gradient-to-r from-primary-dark to-primary ${
                        bannerVersion ? "" : "flex items-center justify-center text-sm text-white/80 outline-dashed outline-1 -outline-offset-4 outline-white/60"
                    }`}
                >
                    {bannerVersion ? (
                        <img
                            src={bookingProfileImageUrl(mailboxUid, "banner", bannerVersion)}
                            alt="Banner preview"
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        "No banner image"
                    )}
                    {busy === "banner" && <Saving />}
                    {badge("banner", "top-right")}
                </div>
                <div className="absolute -bottom-8 left-5 h-16 w-16">
                    <div className="relative h-full w-full overflow-hidden rounded-full border-4 border-surface bg-primary text-white flex items-center justify-center text-2xl font-bold">
                        {avatarVersion ? (
                            <img
                                src={bookingProfileImageUrl(mailboxUid, "avatar", avatarVersion)}
                                alt="Avatar preview"
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <span aria-hidden="true">{(Array.from(name.trim())[0] ?? "?").toUpperCase()}</span>
                        )}
                        {busy === "avatar" && <Saving />}
                    </div>
                    {badge("avatar", "bottom-right")}
                </div>
            </div>
            <div className="p-5 pt-11">
                <h2 className="text-sm font-bold">Booking page appearance</h2>
                <p className="text-sm text-text-muted mb-3">
                    The banner and avatar shown at the top of every booking page for this mailbox. Use the camera on each to upload a file, take a photo or remove it.
                </p>
                {error && <Alert>{error}</Alert>}
            </div>
        </section>
    );
}
