///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Scales a picked image down to the size the booking page shows it at before it is uploaded, so a phone photo of several
 * megabytes becomes a few hundred kilobytes — and never runs into the server's size limits. Browser only.
 */

export interface ImageTarget {
    /** The largest width of the result, in pixels. */
    width: number;
    /** The height of the result at `width` — the aspect ratio the image is cropped to. */
    height: number;
    /** What the result is encoded as. JPEG for photos, PNG where transparency should survive. */
    type: "image/jpeg" | "image/png";
    /** The JPEG quality, from 0 to 1. */
    quality?: number;
}

/** A square avatar, shown at up to 128 CSS pixels, so 512 stays sharp on a high-density display. */
export const AVATAR_TARGET: ImageTarget = { width: 512, height: 512, type: "image/png" };

/** A wide banner, shown across a card up to about 1000 CSS pixels wide. */
export const BANNER_TARGET: ImageTarget = { width: 1600, height: 400, type: "image/jpeg", quality: 0.85 };

/**
 * `file`, centre-cropped to `target`'s aspect ratio and scaled down to at most its size (an image smaller than the target
 * is cropped but not enlarged), as a new image `Blob`. Rejects when the browser can't decode the file.
 */
export async function resizeToCover(file: Blob, target: ImageTarget): Promise<Blob> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error("That file isn't an image this browser can read.");
    }
    try {
        // The largest centred region of the source with the target's aspect ratio.
        const scale: number = Math.max(target.width / bitmap.width, target.height / bitmap.height);
        const sourceWidth: number = target.width / scale;
        const sourceHeight: number = target.height / scale;
        const width: number = Math.max(1, Math.min(target.width, Math.round(sourceWidth)));
        const height: number = Math.max(1, Math.round((width * target.height) / target.width));

        const canvas: HTMLCanvasElement = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
        if (!context) {
            throw new Error("This browser can't resize images.");
        }
        if (target.type === "image/jpeg") {
            // JPEG has no transparency: what would be see-through must not come out black.
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
        }
        context.drawImage(
            bitmap,
            (bitmap.width - sourceWidth) / 2,
            (bitmap.height - sourceHeight) / 2,
            sourceWidth,
            sourceHeight,
            0,
            0,
            width,
            height,
        );
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, target.type, target.quality));
        if (!blob) {
            throw new Error("Could not resize that image.");
        }
        return blob;
    } finally {
        bitmap.close();
    }
}
