// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingCard, BookingPageShell } from "../../../apps/book/_BookingChrome.js";

const host = { mailboxUid: "jane@example.com", name: "Jane Host" };

describe("BookingPageShell", () => {
    it("wraps its children in a main region between the branding header and footer", () => {
        render(
            <BookingPageShell
                branding={{ companyName: "Acme", title: "Acme", headerHtml: "<p>the header</p>", footerHtml: "<p>the footer</p>" }}
            >
                <p>the page</p>
            </BookingPageShell>,
        );

        const header = screen.getByText("the header");
        const main = screen.getByRole("main");
        const footer = screen.getByText("the footer");
        expect(main).toContainElement(screen.getByText("the page"));
        expect(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("renders only its children when there is no branding", () => {
        const { container } = render(
            <BookingPageShell branding={null}>
                <p>the page</p>
            </BookingPageShell>,
        );

        expect(screen.getByRole("main")).toContainElement(screen.getByText("the page"));
        expect(container.querySelectorAll("main ~ *, main + *")).toHaveLength(0);
        expect(container.querySelector("img")).toBeNull();
    });
});

describe("BookingCard", () => {
    it("shows the host's banner and avatar images from their versions", () => {
        const { container } = render(
            <BookingCard host={{ ...host, avatarVersion: "av 1", bannerVersion: "bn1" }}>
                <p>content</p>
            </BookingCard>,
        );

        expect(Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
            "/api/mail/booking-profiles/jane@example.com/banner?v=bn1",
            "/api/mail/booking-profiles/jane@example.com/avatar?v=av%201",
        ]);
        // Decorative: the host's name is the page's heading.
        expect(Array.from(container.querySelectorAll("img")).every((img) => img.getAttribute("alt") === "")).toBe(true);
        expect(container.querySelector("span[aria-hidden='true']")).toBeNull();
        expect(screen.getByText("content")).toBeInTheDocument();
    });

    it("falls back to the gradient banner and the host's initial, uppercased", () => {
        const { container } = render(
            <BookingCard host={{ mailboxUid: "jane@example.com", name: "  jane host" }}>
                <p>content</p>
            </BookingCard>,
        );

        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector(".bg-gradient-to-r")).not.toBeNull();
        expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("J");
    });

    it("takes the whole first character as the initial, not its first UTF-16 unit", () => {
        const { container } = render(
            <BookingCard host={{ mailboxUid: "mb1", name: "\u{1D4D0}lex" }}>
                <p>content</p>
            </BookingCard>,
        );
        expect(container.querySelector("span[aria-hidden='true']")?.textContent).toBe("\u{1D4D0}");
    });

    it("uses a question mark as the initial of a host with no name", () => {
        const { container } = render(
            <BookingCard host={{ mailboxUid: "mb1", name: "   " }}>
                <p>content</p>
            </BookingCard>,
        );
        expect(container.querySelector("span[aria-hidden='true']")).toHaveTextContent("?");
    });

    it("shows only the banner when the host has just a banner, and only the avatar when just an avatar", () => {
        const withBanner = render(
            <BookingCard host={{ ...host, bannerVersion: "bn1" }}>
                <p>content</p>
            </BookingCard>,
        );
        expect(Array.from(withBanner.container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
            "/api/mail/booking-profiles/jane@example.com/banner?v=bn1",
        ]);
        expect(withBanner.container.querySelector("span[aria-hidden='true']")).toHaveTextContent("J");
        withBanner.unmount();

        const withAvatar = render(
            <BookingCard host={{ ...host, avatarVersion: "av1" }}>
                <p>content</p>
            </BookingCard>,
        );
        expect(Array.from(withAvatar.container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual([
            "/api/mail/booking-profiles/jane@example.com/avatar?v=av1",
        ]);
        expect(withAvatar.container.querySelector(".bg-gradient-to-r")).not.toBeNull();
    });

    it("draws no hero without a host, and pads the content evenly", () => {
        const { container } = render(
            <BookingCard>
                <p>content</p>
            </BookingCard>,
        );

        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector(".bg-gradient-to-r")).toBeNull();
        expect(container.querySelector("span[aria-hidden='true']")).toBeNull();
        expect(screen.getByText("content").parentElement).toHaveClass("p-6");
    });

    it("leaves room under the hero for the avatar that overlaps it", () => {
        render(
            <BookingCard host={host}>
                <p>content</p>
            </BookingCard>,
        );
        expect(screen.getByText("content").parentElement).toHaveClass("pt-16");
    });

    it("is wide by default and takes a custom maximum width", () => {
        const wide = render(
            <BookingCard>
                <p>content</p>
            </BookingCard>,
        );
        expect(wide.container.firstElementChild).toHaveClass("max-w-5xl");
        wide.unmount();

        const narrow = render(
            <BookingCard maxWidth="max-w-2xl">
                <p>content</p>
            </BookingCard>,
        );
        expect(narrow.container.firstElementChild).toHaveClass("max-w-2xl");
        expect(narrow.container.firstElementChild).not.toHaveClass("max-w-5xl");
    });
});
