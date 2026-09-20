// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_TARGET, BANNER_TARGET, ImageTarget, resizeToCover } from "../../../apps/shared/imageResize.js";

interface FakeCanvas {
    width: number;
    height: number;
    getContext: ReturnType<typeof vi.fn>;
    toBlob: ReturnType<typeof vi.fn>;
}

interface Setup {
    bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
    canvas: FakeCanvas;
    context: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
    result: Blob;
    createImageBitmap: ReturnType<typeof vi.fn>;
}

/** Stubs the browser APIs `resizeToCover()` uses: a decoded bitmap of the given size and a canvas that yields `result`. */
function setup(width: number, height: number, overrides: { context?: unknown; blob?: Blob | null } = {}): Setup {
    const bitmap = { width, height, close: vi.fn() };
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const result = new Blob(["resized"], { type: "image/png" });
    const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ("context" in overrides ? overrides.context : context)),
        toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback("blob" in overrides ? (overrides.blob as Blob | null) : result)),
    };
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const original = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
        tag === "canvas" ? canvas : original(tag)) as typeof document.createElement);
    return { bitmap, canvas, context, result, createImageBitmap };
}

const file = new File(["source"], "photo.jpg", { type: "image/jpeg" });

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("targets", () => {
    it("crops the avatar square and encodes it as a PNG, and the banner wide and encodes it as a JPEG", () => {
        expect(AVATAR_TARGET).toEqual({ width: 512, height: 512, type: "image/png" });
        expect(BANNER_TARGET).toEqual({ width: 1600, height: 400, type: "image/jpeg", quality: 0.85 });
    });
});

describe("resizeToCover", () => {
    it("decodes the file it is given", async () => {
        const s = setup(2000, 2000);
        await resizeToCover(file, AVATAR_TARGET);
        expect(s.createImageBitmap).toHaveBeenCalledWith(file);
    });

    it("centre-crops a landscape source to a square target and scales it down", async () => {
        const s = setup(4000, 2000);
        const blob = await resizeToCover(file, AVATAR_TARGET);

        expect(blob).toBe(s.result);
        expect(s.canvas.width).toBe(512);
        expect(s.canvas.height).toBe(512);
        // The middle 2000x2000 of the source: 1000 pixels are cut off on each side.
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 1000, 0, 2000, 2000, 0, 0, 512, 512);
    });

    it("centre-crops a portrait source to a wide target and scales it down", async () => {
        const s = setup(2000, 3000);
        await resizeToCover(file, BANNER_TARGET);

        expect(s.canvas.width).toBe(1600);
        expect(s.canvas.height).toBe(400);
        // The widest 4:1 strip of the source, from its vertical middle: 2000x500, starting at y = 1250.
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 0, 1250, 2000, 500, 0, 0, 1600, 400);
    });

    it("centre-crops a wide source to a wide target without touching a source that already fits its ratio", async () => {
        const s = setup(3200, 800);
        await resizeToCover(file, BANNER_TARGET);

        expect(s.canvas.width).toBe(1600);
        expect(s.canvas.height).toBe(400);
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 0, 0, 3200, 800, 0, 0, 1600, 400);
    });

    it("crops a portrait source to the avatar's square", async () => {
        const s = setup(1000, 3000);
        await resizeToCover(file, AVATAR_TARGET);

        expect(s.canvas.width).toBe(512);
        expect(s.canvas.height).toBe(512);
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 0, 1000, 1000, 1000, 0, 0, 512, 512);
    });

    it("does not enlarge an image that is smaller than the target", async () => {
        const s = setup(200, 100);
        await resizeToCover(file, AVATAR_TARGET);

        // Cropped to the square (100x100 from x = 50), but drawn at its own size, not scaled up to 512.
        expect(s.canvas.width).toBe(100);
        expect(s.canvas.height).toBe(100);
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 50, 0, 100, 100, 0, 0, 100, 100);
    });

    it("keeps the target's aspect ratio for a small image and a wide target", async () => {
        const s = setup(400, 300);
        await resizeToCover(file, BANNER_TARGET);

        // The 400x100 strip of the source, at its own size.
        expect(s.canvas.width).toBe(400);
        expect(s.canvas.height).toBe(100);
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 0, 100, 400, 100, 0, 0, 400, 100);
    });

    it("never produces a canvas smaller than one pixel", async () => {
        // A sliver: the 4:1 strip of a 2000x1 image is 4x1 pixels.
        const sliver = setup(2000, 1);
        await resizeToCover(file, BANNER_TARGET);
        expect(sliver.canvas.width).toBe(4);
        expect(sliver.canvas.height).toBe(1);

        // A single pixel: a 4:1 strip of it would be a quarter pixel high, which rounds to none.
        const tiny = setup(1, 1);
        await resizeToCover(file, BANNER_TARGET);
        expect(tiny.canvas.width).toBe(1);
        expect(tiny.canvas.height).toBe(1);
    });

    it("fills a JPEG's canvas white first, so transparency does not come out black", async () => {
        const s = setup(2000, 2000);
        await resizeToCover(file, BANNER_TARGET);

        expect(s.context.fillStyle).toBe("#ffffff");
        expect(s.context.fillRect).toHaveBeenCalledWith(0, 0, s.canvas.width, s.canvas.height);
        // The fill comes before the image is drawn over it.
        expect(s.context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(s.context.drawImage.mock.invocationCallOrder[0]);
    });

    it("leaves a PNG's canvas transparent", async () => {
        const s = setup(2000, 2000);
        await resizeToCover(file, AVATAR_TARGET);

        expect(s.context.fillRect).not.toHaveBeenCalled();
        expect(s.context.fillStyle).toBe("");
    });

    it("encodes with the target's type and quality", async () => {
        const jpeg = setup(2000, 2000);
        await resizeToCover(file, BANNER_TARGET);
        expect(jpeg.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);

        const png = setup(2000, 2000);
        await resizeToCover(file, AVATAR_TARGET);
        expect(png.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
    });

    it("works for any target, not just the two the editor uses", async () => {
        const target: ImageTarget = { width: 300, height: 100, type: "image/jpeg", quality: 0.5 };
        const s = setup(900, 900);
        await resizeToCover(file, target);

        expect(s.canvas.width).toBe(300);
        expect(s.canvas.height).toBe(100);
        expect(s.context.drawImage).toHaveBeenCalledWith(s.bitmap, 0, 300, 900, 300, 0, 0, 300, 100);
    });

    it("releases the decoded bitmap after a successful resize", async () => {
        const s = setup(2000, 2000);
        await resizeToCover(file, AVATAR_TARGET);
        expect(s.bitmap.close).toHaveBeenCalledTimes(1);
    });

    it("rejects with a friendly message when the browser can't decode the file", async () => {
        const s = setup(2000, 2000);
        s.createImageBitmap.mockRejectedValueOnce(new DOMException("The source image could not be decoded.", "InvalidStateError"));

        await expect(resizeToCover(file, AVATAR_TARGET)).rejects.toThrow("That file isn't an image this browser can read.");
        // Nothing was decoded, so nothing is drawn or released.
        expect(s.canvas.getContext).not.toHaveBeenCalled();
        expect(s.bitmap.close).not.toHaveBeenCalled();
    });

    it("rejects when the browser has no 2d canvas context, still releasing the bitmap", async () => {
        const s = setup(2000, 2000, { context: null });

        await expect(resizeToCover(file, AVATAR_TARGET)).rejects.toThrow("This browser can't resize images.");
        expect(s.bitmap.close).toHaveBeenCalledTimes(1);
        expect(s.canvas.toBlob).not.toHaveBeenCalled();
    });

    it("rejects when the canvas can't encode the image, still releasing the bitmap", async () => {
        const s = setup(2000, 2000, { blob: null });

        await expect(resizeToCover(file, AVATAR_TARGET)).rejects.toThrow("Could not resize that image.");
        expect(s.bitmap.close).toHaveBeenCalledTimes(1);
    });

    it("releases the bitmap when drawing itself throws", async () => {
        const s = setup(2000, 2000);
        s.context.drawImage.mockImplementation(() => {
            throw new Error("draw failed");
        });

        await expect(resizeToCover(file, AVATAR_TARGET)).rejects.toThrow("draw failed");
        expect(s.bitmap.close).toHaveBeenCalledTimes(1);
    });
});
