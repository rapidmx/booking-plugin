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

/** Opens the menu of the camera badge on an image's corner. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, image: "banner" | "avatar") {
    await user.click(screen.getByRole("button", { name: `Change ${image}` }));
}

/** Removes an image the way a user does: from its badge's menu. */
async function removeImage(user: ReturnType<typeof userEvent.setup>, image: "banner" | "avatar") {
    await openMenu(user, image);
    await user.click(screen.getByRole("menuitem", { name: "Remove photo" }));
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

        it("previews the images at their saved versions, each with a badge whose menu can remove it", async () => {
            mockProfile(undefined, { mailboxUid: "jane@example.com", avatarVersion: "av 1", bannerVersion: "bn1" });
            renderEditor();

            expect(await screen.findByAltText("Banner preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/banner?v=bn1");
            expect(screen.getByAltText("Avatar preview")).toHaveAttribute("src", "/api/mail/booking-profiles/jane@example.com/avatar?v=av%201");
            const user = userEvent.setup();
            // The badges sit on the banner's upper right and the avatar's lower right.
            expect(screen.getByRole("button", { name: "Change banner" })).toHaveClass("absolute", "top-2", "right-2");
            expect(screen.getByRole("button", { name: "Change avatar" })).toHaveClass("absolute", "bottom-0", "right-0");
            await openMenu(user, "banner");
            expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Upload file", "Take photo", "Remove photo"]);
            await user.keyboard("{Escape}");
            await openMenu(user, "avatar");
            expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Upload file", "Take photo", "Remove photo"]);
            expect(screen.queryByRole("button", { name: /^(Upload|Remove)/ })).not.toBeInTheDocument();
        });

        it("shows an empty banner area and the mailbox's initial as the avatar, with nothing to remove, when nothing is set", async () => {
            mockProfile();
            const { container } = renderEditor("jane host");
            await loaded();

            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
            expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
            expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("J");
            expect(screen.getByText("No banner image")).toBeInTheDocument();
            const user = userEvent.setup();
            for (const image of ["banner", "avatar"] as const) {
                await openMenu(user, image);
                expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Upload file", "Take photo"]);
                await user.keyboard("{Escape}");
            }
        });

        it("previews only the banner when only a banner is set, and only the avatar when only an avatar is set", async () => {
            mockProfile(undefined, { mailboxUid: "jane@example.com", bannerVersion: "bn1" });
            const first = renderEditor();
            expect(await screen.findByAltText("Banner preview")).toBeInTheDocument();
            expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument();
            expect(screen.queryByText("No banner image")).not.toBeInTheDocument();
            await openMenu(userEvent.setup(), "banner");
            expect(screen.getByRole("menuitem", { name: "Remove photo" })).toBeInTheDocument();
            first.unmount();

            mockProfile(undefined, { mailboxUid: "jane@example.com", avatarVersion: "av1" });
            renderEditor();
            expect(await screen.findByAltText("Avatar preview")).toBeInTheDocument();
            expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument();
            expect(screen.getByText("No banner image")).toBeInTheDocument();
            await openMenu(userEvent.setup(), "avatar");
            expect(screen.getByRole("menuitem", { name: "Remove photo" })).toBeInTheDocument();
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
            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
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
        it("opens the file picker of the matching input from each badge's Upload file row", async () => {
            mockProfile();
            const user = userEvent.setup();
            renderEditor();
            await loaded();
            const bannerClicked = vi.fn();
            const avatarClicked = vi.fn();
            screen.getByLabelText("Banner image file").addEventListener("click", bannerClicked);
            screen.getByLabelText("Avatar image file").addEventListener("click", avatarClicked);

            await openMenu(user, "banner");
            await user.click(screen.getByRole("menuitem", { name: "Upload file" }));
            expect(bannerClicked).toHaveBeenCalledTimes(1);
            expect(avatarClicked).not.toHaveBeenCalled();

            await openMenu(user, "avatar");
            await user.click(screen.getByRole("menuitem", { name: "Upload file" }));
            expect(avatarClicked).toHaveBeenCalledTimes(1);
        });

        it("offers any image (a phone's picker gives its camera and library), which is re-encoded in the browser anyway", async () => {
            mockProfile();
            renderEditor();
            await loaded();
            expect(screen.getByLabelText("Banner image file")).toHaveAttribute("accept", "image/*");
            expect(screen.getByLabelText("Avatar image file")).toHaveAttribute("accept", "image/*");
            expect(screen.getByLabelText("Banner image file (camera)")).toHaveAttribute("capture", "user");
        });

        it("takes a photo from the phone's camera input like any picked file: resized, uploaded and previewed", async () => {
            vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
            const fetchMock = mockProfile((url, init) =>
                url === `${PROFILE_URL}/avatar` && init?.method === "POST" ? jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: "a9" }) : undefined,
            );
            const user = userEvent.setup();
            renderEditor();
            await loaded();
            await openMenu(user, "avatar");
            await user.click(screen.getByRole("menuitem", { name: "Take photo" }));

            await user.upload(screen.getByLabelText("Avatar image file (camera)"), photo);

            expect(await screen.findByAltText("Avatar preview")).toHaveAttribute("src", expect.stringContaining("v=a9"));
            expect(resizeToCover).toHaveBeenCalledWith(photo, AVATAR_TARGET);
            expect(fetchMock.mock.calls.some(([url, init]: any) => url === `${PROFILE_URL}/avatar` && init?.method === "POST")).toBe(true);
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
            expect(new Headers((post?.[1] as RequestInit).headers).get("content-type")).toBe("image/jpeg");
            expect(screen.queryByText("No banner image")).not.toBeInTheDocument();
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
            await screen.findByAltText("Banner preview");
            // The picker's value is cleared as soon as the file is read, so choosing that file again still fires a change.
            expect(input.value).toBe("");
            await removeImage(user, "banner");
            await waitFor(() => expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument());
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
            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
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
            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
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

            await removeImage(user, "banner");

            await waitFor(() => expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument());
            expect(screen.getByText("No banner image")).toBeInTheDocument();
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

            await removeImage(user, "avatar");

            await waitFor(() => expect(screen.queryByAltText("Avatar preview")).not.toBeInTheDocument());
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

            await removeImage(user, "banner");

            expect(await screen.findByText("could not delete")).toBeInTheDocument();
            expect(screen.getByAltText("Banner preview")).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
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

            await removeImage(user, "avatar");

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

            await removeImage(user, "banner");
            await screen.findByText("could not delete");
            await removeImage(user, "banner");

            await waitFor(() => expect(screen.queryByAltText("Banner preview")).not.toBeInTheDocument());
            expect(screen.queryByText("could not delete")).not.toBeInTheDocument();
        });
    });

    describe("while busy", () => {
        it("disables both badges, and spins over the image at work, until an upload is done", async () => {
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

            const banner = screen.getByRole("button", { name: "Change banner" });
            await waitFor(() => expect(banner).toBeDisabled());
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeDisabled();
            // One spinner, over the banner: it is not on the avatar.
            const spinners = screen.getAllByRole("status", { name: "Saving" });
            expect(spinners).toHaveLength(1);
            expect(banner.parentElement).toContainElement(spinners[0]);

            await act(async () => finish(jsonResponse(200, { mailboxUid: "jane@example.com", avatarVersion: "a1", bannerVersion: "b1" })));

            await waitFor(() => expect(banner).toBeEnabled());
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeEnabled();
            expect(screen.queryByRole("status", { name: "Saving" })).not.toBeInTheDocument();
        });

        it("disables both badges, and spins over the image at work, until a removal is done", async () => {
            let finish: (response: Response) => void = () => undefined;
            mockProfile(
                (url, init) =>
                    url === `${PROFILE_URL}/avatar` && init?.method === "DELETE" ? new Promise<Response>((resolve) => (finish = resolve)) : undefined,
                { mailboxUid: "jane@example.com", avatarVersion: "a1", bannerVersion: "b1" },
            );
            const user = userEvent.setup();
            renderEditor();
            await screen.findByAltText("Avatar preview");

            await removeImage(user, "avatar");

            expect(screen.getAllByRole("status", { name: "Saving" })).toHaveLength(1);
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeDisabled();
            expect(screen.getByRole("button", { name: "Change banner" })).toBeDisabled();

            await act(async () => finish(jsonResponse(200, { mailboxUid: "jane@example.com", bannerVersion: "b1" })));

            await waitFor(() => expect(screen.getByRole("button", { name: "Change avatar" })).toBeEnabled());
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

            expect(screen.getByRole("button", { name: "Change banner" })).toBeEnabled();
            expect(screen.getByRole("button", { name: "Change avatar" })).toBeEnabled();
        });
    });
});
