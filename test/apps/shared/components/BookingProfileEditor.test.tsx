// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch } from "../../testUtils.js";
import BookingProfileEditor from "../../../../apps/shared/components/BookingProfileEditor.js";
import { AVATAR_TARGET, BANNER_TARGET, resizeToCover } from "../../../../apps/shared/imageResize.js";

// Only the browser-bound resize is replaced; the targets stay real, so the editor's pairing of image and target is tested.
vi.mock("../../../../apps/shared/imageResize.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../apps/shared/imageResize.js")>()),
    resizeToCover: vi.fn(),
}));

const PROFILE_URL = "/api/mail/booking-profiles/jane@example.com";
const resized = new Blob(["resized"], { type: "image/jpeg" });
const photo = new File(["photo"], "photo.png", { type: "image/png" });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response> | undefined;

/** Answers the profile endpoints through `handler`, and a plain empty profile for a GET it doesn't handle. */
function mockProfile(handler?: Handler, initial: Record<string, unknown> = { mailboxUid: "jane@example.com" }) {
    return mockFetch((url, init) => {
        const custom = handler?.(url, init);
        if (custom) return custom;
        if (url === PROFILE_URL && (init?.method ?? "GET") === "GET") return jsonResponse(200, initial);
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    });
}

function renderEditor(name = "Jane Host") {
    return render(<BookingProfileEditor mailboxUid="jane@example.com" name={name} />);
}

async function loaded() {
    // The profile is fetched once, on mount; wait for its response to have been applied.
    await act(async () => undefined);
}

beforeEach(() => {
    vi.mocked(resizeToCover).mockReset();
    vi.mocked(resizeToCover).mockResolvedValue(resized);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("BookingProfileEditor", () => {
    describe("loading", () => {
        it("fetches the mailbox's profile", async () => {
            const fetchMock = mockProfile();
            renderEditor();
            await loaded();
            expect(fetchMock).toHaveBeenCalledWith(PROFILE_URL, expect.anything());
        });

        it("previews the images at their saved versions, offering to change or remove them", async () => {
            mockProfile(undefined, { mailboxUid: "jane@example.com", avatarVersion: "av 1", bannerVersion: "bn1" });
            renderEditor();

            expect(await screen.findByAltText("Banner preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/banner?v=bn1");
            expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/avatar?v=av%201");
            expect(screen.getByRole("button", { name: "Change banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Remove banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Remove avatar" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Upload/ })).not.toBeInTheDocument();
        });

        it("offers to upload, with the mailbox's initial as the avatar, when nothing is set", async () => {
            mockProfile();
            const { container } = renderEditor("jane host");
            await loaded();

            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
            expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
            expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("J");
            expect(screen.getByRole("button", { name: "Upload banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Upload avatar" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
        });

        it("previews only the banner when only a banner is set, and only the avatar when only an avatar is set", async () => {
            mockProfile(undefined, { mailboxUid: "jane@example.com", bannerVersion: "bn1" });
            const first = renderEditor();
            expect(await screen.findByAltText("Banner preview")).toBeInTheDocument();
            expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Change banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Upload avatar" })).toBeInTheDocument();
            first.unmount();

            mockProfile(undefined, { mailboxUid: "jane@example.com", avatarVersion: "av1" });
            renderEditor();
            expect(await screen.findByAltText("Avatar preview")).toBeInTheDocument();
            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Upload banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeInTheDocument();
        });

        it("uses a question mark as the avatar of a mailbox with no name", async () => {
            mockProfile();
            const { container } = renderEditor("  ");
            await loaded();
            expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("?");
        });

        it("shows the API's message when the profile can't be loaded", async () => {
            mockProfile((url) => (url === PROFILE_URL ? jsonResponse(403, { message: "no access to that mailbox" }) : undefined));
            renderEditor();
            expect(await screen.findByText("no access to that mailbox")).toBeInTheDocument();
            // The editor is still usable: the images are simply unset until it is loaded.
            expect(screen.getByRole("button", { name: "Upload banner" })).toBeInTheDocument();
        });

        it("shows a generic message when loading fails with a non-API error", async () => {
            mockProfile((url) => {
                if (url === PROFILE_URL) throw new TypeError("network down");
                return undefined;
            });
            renderEditor();
            expect(await screen.findByText("Could not load the booking page's look.")).toBeInTheDocument();
        });

        it("ignores a load that finishes after the editor was removed", async () => {
            let answer: (response: Response) => void = () => undefined;
            mockProfile((url) => (url === PROFILE_URL ? new Promise<Response>((resolve) => (answer = resolve)) : undefined));
            const { unmount } = renderEditor();
            unmount();

            // Neither a late profile nor a late failure is applied (or reported) once nobody is looking.
            await act(async () => answer(jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "late" })));
            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
        });

        it("ignores a load failure that arrives after the editor was removed", async () => {
            let fail: (error: Error) => void = () => undefined;
            mockProfile((url) => (url === PROFILE_URL ? new Promise<Response>((_resolve, reject) => (fail = reject)) : undefined));
            const { unmount } = renderEditor();
            unmount();

            await act(async () => fail(new TypeError("network down")));
            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        });

        it("shows the newest mailbox's profile when the mailbox changes while an earlier load is still out", async () => {
            const answers: Record<string, (response: Response) => void> = {};
            mockFetch((url) => {
                if (url === PROFILE_URL || url === "/api/mail/booking-profiles/other@example.com") {
                    return new Promise<Response>((resolve) => (answers[url] = resolve));
                }
                throw new Error(`unexpected ${url}`);
            });
            const { rerender } = render(<BookingProfileEditor mailboxUid="jane@example.com" name="Jane" />);
            rerender(<BookingProfileEditor mailboxUid="other@example.com" name="Other" />);

            await act(async () => answers["/api/mail/booking-profiles/other@example.com"](jsonResponse(200, { mailboxUid: "other@example.com", bannerVersion: "new" })));
            await act(async () => answers[PROFILE_URL](jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "stale" })));

            expect(screen.getByAltText("Banner preview")).toHaveAttribute("src", "/api/mail/booking-profiles/other@example.com/banner?v=new");
        });
    });

    describe("picking an image", () => {
        it("opens the file picker of the matching input from each button", async () => {
            mockProfile();
            const user = userEvent.setup();
            renderEditor();
            await loaded();
            const bannerClicked = vi.fn();
            const avatarClicked = vi.fn();
            screen.getByLabelText("Banner image file").addEventListener("click", bannerClicked);
            screen.getByLabelText("Avatar image file").addEventListener("click", avatarClicked);

            await user.click(screen.getByRole("button", { name: "Upload banner" }));
            expect(bannerClicked).toHaveBeenCalledTimes(1);
            expect(avatarClicked).not.toHaveBeenCalled();

            await user.click(screen.getByRole("button", { name: "Upload avatar" }));
            expect(avatarClicked).toHaveBeenCalledTimes(1);
        });

        it("only accepts images the server can store", async () => {
            mockProfile();
            renderEditor();
            await loaded();
            expect(screen.getByLabelText("Banner image file")).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,image/gif");
            expect(screen.getByLabelText("Avatar image file")).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,image/gif");
        });

        it("resizes a picked banner to the banner size, uploads it, and previews the new version", async () => {
            const fetchMock = mockProfile((url, init) =>
                url === `${PROFILE_URL}/banner` && init?.method === "POST"
                    ? jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "b2" })
                    : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);

            expect(await screen.findByAltText("Banner preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/banner?v=b2");
            expect(resizeToCover).toHaveBeenCalledWith(photo, BANNER_TARGET);
            const post = fetchMock.mock.calls.find(([, init]: any) => init?.method === "POST");
            expect(post?.[0]).toBe(`${PROFILE_URL}/banner`);
            // What is uploaded is the resized image, as the raw body, with its own type.
            expect((post?.[1] as RequestInit).body).toBe(resized);
            expect((post?.[1] as RequestInit).headers).toEqual({ "Content-Type": "image/jpeg" });
            expect(screen.getByRole("button", { name: "Change banner" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Remove banner" })).toBeInTheDocument();
        });

        it("resizes a picked avatar to the avatar size and uploads it", async () => {
            const fetchMock = mockProfile((url, init) =>
                url === `${PROFILE_URL}/avatar` && init?.method === "POST"
                    ? jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: "a2" })
                    : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Avatar image file"), photo);

            expect(await screen.findByAltText("Avatar preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/avatar?v=a2");
            expect(resizeToCover).toHaveBeenCalledWith(photo, AVATAR_TARGET);
            expect(fetchMock.mock.calls.some(([url, init]: any) => url === `${PROFILE_URL}/avatar` && init?.method === "POST")).toBe(true);
        });

        it("lets the same file be picked again", async () => {
            let version = 0;
            const fetchMock = mockProfile((url, init) =>
                url === `${PROFILE_URL}/banner` && init?.method === "POST"
                    ? jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: `b${++version}` })
                    : url === `${PROFILE_URL}/banner` && init?.method === "DELETE"
                      ? jsonResponse(200, { mailboxUid: "jane@example.com" })
                      : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();
            const input = screen.getByLabelText("Banner image file");

            await user.upload(input, photo);
            await screen.findByRole("button", { name: "Remove banner" });
            // The picker's value is cleared as soon as the file is read, so choosing that file again still fires a change.
            expect(input.value).toBe("");
            await user.click(screen.getByRole("button", { name: "Remove banner" }));
            await screen.findByRole("button", { name: "Upload banner" });
            await user.upload(input, photo);

            await waitFor(() => expect(screen.getByAltText("Banner preview")).toHaveAttribute("src", expect.stringContaining("v=b2")));
            expect(fetchMock.mock.calls.filter(([, init]: any) => init?.method === "POST")).toHaveLength(2);
            expect(resizeToCover).toHaveBeenCalledTimes(2);
        });

        it("uploads again without removing first when the same file is picked twice in a row", async () => {
            let version = 0;
            const fetchMock = mockProfile((url, init) =>
                url === `${PROFILE_URL}/avatar` && init?.method === "POST"
                    ? jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: `a${++version}` })
                    : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Avatar image file"), photo);
            await waitFor(() => expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", expect.stringContaining("v=a1")));
            await user.upload(screen.getByLabelText("Avatar image file"), photo);
            await waitFor(() => expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", expect.stringContaining("v=a2")));

            expect(fetchMock.mock.calls.filter(([, init]: any) => init?.method === "POST")).toHaveLength(2);
        });

        it("does nothing when the picker is dismissed without a file", async () => {
            const fetchMock = mockProfile();
            renderEditor();
            await loaded();

            fireEvent.change(screen.getByLabelText("Banner image file"), { target: { files: [] } });
            await loaded();

            expect(resizeToCover).not.toHaveBeenCalled();
            expect(fetchMock.mock.calls.filter(([, init]: any) => init?.method === "POST")).toHaveLength(0);
            expect(screen.getByRole("button", { name: "Upload banner" })).toBeEnabled();
        });
    });

    describe("upload failures", () => {
        it("shows the message of a resize failure, and does not upload", async () => {
            vi.mocked(resizeToCover).mockRejectedValue(new Error("That file isn't an image this browser can read."));
            const fetchMock = mockProfile();
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);

            expect(await screen.findByText("That file isn't an image this browser can read.")).toBeInTheDocument();
            expect(fetchMock.mock.calls.filter(([, init]: any) => init?.method === "POST")).toHaveLength(0);
            expect(screen.getByRole("button", { name: "Upload banner" })).toBeEnabled();
        });

        it("shows the server's message when the upload is rejected, keeping what was there", async () => {
            mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/avatar` && init?.method === "POST"
                        ? jsonResponse(413, { message: "That image is too large." })
                        : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Avatar preview");

            await user.upload(screen.getByLabelText("Avatar image file"), photo);

            expect(await screen.findByText("That image is too large.")).toBeInTheDocument();
            expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", expect.stringContaining("v=a1"));
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeEnabled();
        });

        it("shows the message of a network failure while uploading", async () => {
            mockProfile((url, init) => {
                if (url === `${PROFILE_URL}/banner` && init?.method === "POST") throw new TypeError("network down");
                return undefined;
            });
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);

            expect(await screen.findByText("network down")).toBeInTheDocument();
        });

        it("names the image in a generic message when what was thrown is not an Error", async () => {
            vi.mocked(resizeToCover).mockRejectedValue("nope");
            const user = userEvent.setup();
            mockProfile();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);
            expect(await screen.findByText("Could not save the banner.")).toBeInTheDocument();

            await user.upload(screen.getByLabelText("Avatar image file"), photo);
            expect(await screen.findByText("Could not save the avatar.")).toBeInTheDocument();
        });

        it("clears an earlier error when the next attempt starts", async () => {
            vi.mocked(resizeToCover).mockRejectedValueOnce(new Error("first failed"));
            mockProfile((url, init) =>
                url === `${PROFILE_URL}/banner` && init?.method === "POST"
                    ? jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "b1" })
                    : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);
            expect(await screen.findByText("first failed")).toBeInTheDocument();

            await user.upload(screen.getByLabelText("Banner image file"), photo);
            await screen.findByAltText("Banner preview");
            expect(screen.queryByText("first failed")).not.toBeInTheDocument();
            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        });
    });

    describe("removing an image", () => {
        it("deletes the image and goes back to offering an upload", async () => {
            const fetchMock = mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/banner` && init?.method === "DELETE"
                        ? jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: "a1" })
                        : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1", bannerVersion: "b1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Banner preview");

            await user.click(screen.getByRole("button", { name: "Remove banner" }));

            await screen.findByRole("button", { name: "Upload banner" });
            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
            // The other image is untouched.
            expect(screen.getByAltText("Avatar preview")).toBeInTheDocument();
            expect(fetchMock).toHaveBeenCalledWith(`${PROFILE_URL}/banner`, expect.objectContaining({ method: "DELETE" }));
        });

        it("deletes the avatar and shows the initial again", async () => {
            const fetchMock = mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/avatar` && init?.method === "DELETE" ? jsonResponse(200, { mailboxUid: "jane@example.com" }) : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1" },
            );
            const user = userEvent.setup();
            const { container } = renderEditor();
            await screen.findByAltText("Avatar preview");

            await user.click(screen.getByRole("button", { name: "Remove avatar" }));

            await screen.findByRole("button", { name: "Upload avatar" });
            expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
            expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("J");
            expect(fetchMock).toHaveBeenCalledWith(`${PROFILE_URL}/avatar`, expect.objectContaining({ method: "DELETE" }));
        });

        it("shows the API's message when removing fails, keeping the image", async () => {
            mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/banner` && init?.method === "DELETE" ? jsonResponse(500, { message: "could not delete" }) : undefined,
                { mailboxUid: "jane@example.com", bannerVersion: "b1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Banner preview");

            await user.click(screen.getByRole("button", { name: "Remove banner" }));

            expect(await screen.findByText("could not delete")).toBeInTheDocument();
            expect(screen.getByAltText("Banner preview")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Remove banner" })).toBeEnabled();
        });

        it("names the image in a generic message when removing fails with a non-API error", async () => {
            mockProfile(
                (url, init) => {
                    if (url === `${PROFILE_URL}/avatar` && init?.method === "DELETE") throw new TypeError("network down");
                    return undefined;
                },
                { mailboxUid: "jane@example.com", avatarVersion: "a1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Avatar preview");

            await user.click(screen.getByRole("button", { name: "Remove avatar" }));

            expect(await screen.findByText("Could not remove the avatar.")).toBeInTheDocument();
        });

        it("clears an earlier error when removing starts", async () => {
            let deletes = 0;
            mockProfile(
                (url, init) => {
                    if (url === `${PROFILE_URL}/banner` && init?.method === "DELETE") {
                        return ++deletes === 1 ? jsonResponse(500, { message: "could not delete" }) : jsonResponse(200, { mailboxUid: "jane@example.com" });
                    }
                    return undefined;
                },
                { mailboxUid: "jane@example.com", bannerVersion: "b1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Banner preview");

            await user.click(screen.getByRole("button", { name: "Remove banner" }));
            await screen.findByText("could not delete");
            await user.click(screen.getByRole("button", { name: "Remove banner" }));

            await screen.findByRole("button", { name: "Upload banner" });
            expect(screen.queryByText("could not delete")).not.toBeInTheDocument();
        });
    });

    describe("while busy", () => {
        it("disables every button, and spins the one at work, until an upload is done", async () => {
            let finish: (response: Response) => void = () => undefined;
            mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/banner` && init?.method === "POST" ? new Promise<Response>((resolve) => (finish = resolve)) : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Avatar preview");

            await user.upload(screen.getByLabelText("Banner image file"), photo);

            const banner = await screen.findByRole("button", { name: "Upload banner" });
            expect(banner).toBeDisabled();
            expect(banner.querySelector(".animate-spin")).not.toBeNull();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Change avatar" }).querySelector(".animate-spin")).toBeNull();
            expect(screen.getByRole("button", { name: "Remove avatar" })).toBeDisabled();

            await act(async () => finish(jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: "a1", bannerVersion: "b1" })));

            expect(await screen.findByRole("button", { name: "Change banner" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Remove avatar" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Remove banner" })).toBeEnabled();
            expect(document.querySelector(".animate-spin")).toBeNull();
        });

        it("disables every button, and spins the one at work, until a removal is done", async () => {
            let finish: (response: Response) => void = () => undefined;
            mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/avatar` && init?.method === "DELETE" ? new Promise<Response>((resolve) => (finish = resolve)) : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1", bannerVersion: "b1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Avatar preview");

            await user.click(screen.getByRole("button", { name: "Remove avatar" }));

            expect(screen.getByRole("button", { name: "Change avatar" }).querySelector(".animate-spin")).not.toBeNull();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Remove avatar" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Change banner" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Remove banner" })).toBeDisabled();

            await act(async () => finish(jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "b1" })));

            expect(await screen.findByRole("button", { name: "Upload avatar" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
        });

        it("is enabled again after a failure", async () => {
            vi.mocked(resizeToCover).mockRejectedValue(new Error("nope"));
            mockProfile();
            const user = userEvent.setup();
            renderEditor();
            await loaded();

            await user.upload(screen.getByLabelText("Banner image file"), photo);
            await screen.findByText("nope");

            expect(screen.getByRole("button", { name: "Upload banner" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Upload avatar" })).toBeEnabled();
        });
    });
});
