// @vitest-environment jsdom
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MeetingTypesEditor from "../../../../apps/shared/components/MeetingTypesEditor.js";
import { BookingLocationType, BookingMeetingType } from "../../../../apps/shared/bookingApi.js";

function makeMeetingType(overrides?: Partial<BookingMeetingType>): BookingMeetingType {
    return {
        uid: "mt-1",
        name: "Intro Call",
        durationMinutes: 30,
        locationOptions: [{ uid: "lo-1", type: BookingLocationType.VIDEO }],
        ...overrides,
    };
}

function Harness({ initial }: { initial: BookingMeetingType[] }) {
    const [value, setValue] = React.useState<BookingMeetingType[]>(initial);
    return <MeetingTypesEditor value={value} onChange={setValue} />;
}

describe("MeetingTypesEditor", () => {
    it("shows an existing meeting type's name and duration", () => {
        render(<MeetingTypesEditor value={[makeMeetingType()]} onChange={vi.fn()} />);
        expect(screen.getByDisplayValue("Intro Call")).toBeInTheDocument();
        expect(screen.getByDisplayValue("30")).toBeInTheDocument();
    });

    it("adds a new meeting type with one default location option", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType()]} />);

        expect(screen.getAllByLabelText("Type")).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "Add meeting type" }));

        expect(screen.getAllByLabelText("Type")).toHaveLength(2);
        expect(screen.getAllByLabelText("Meeting type name")).toHaveLength(2);
    });

    it("edits a meeting type's name and duration in place", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType()]} />);

        const name = screen.getByLabelText("Meeting type name");
        await user.clear(name);
        await user.type(name, "Deep Dive");
        const duration = screen.getByLabelText("Duration (minutes)");
        await user.clear(duration);
        await user.type(duration, "60");

        expect(screen.getByDisplayValue("Deep Dive")).toBeInTheDocument();
        expect(screen.getByDisplayValue("60")).toBeInTheDocument();
    });

    it("refuses to remove the only meeting type", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType()]} />);

        await user.click(screen.getByRole("button", { name: "Remove meeting type" }));

        expect(screen.getByText("At least one meeting type is required.")).toBeInTheDocument();
        expect(screen.getAllByLabelText("Meeting type name")).toHaveLength(1);
    });

    it("removes a meeting type when more than one exists", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType({ uid: "mt-1", name: "A" }), makeMeetingType({ uid: "mt-2", name: "B" })]} />);

        expect(screen.getAllByLabelText("Meeting type name")).toHaveLength(2);
        await user.click(screen.getAllByRole("button", { name: "Remove meeting type" })[0]);

        expect(screen.getAllByLabelText("Meeting type name")).toHaveLength(1);
        expect(screen.getByDisplayValue("B")).toBeInTheDocument();
    });

    it("adds a location option to a meeting type", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType()]} />);

        expect(screen.getAllByLabelText("Type")).toHaveLength(1);
        await user.click(screen.getByRole("button", { name: "Add location option" }));

        expect(screen.getAllByLabelText("Type")).toHaveLength(2);
    });

    it("refuses to remove a meeting type's only location option", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType()]} />);

        await user.click(screen.getByRole("button", { name: "Remove location option" }));

        expect(screen.getByText("Each meeting type needs at least one location option.")).toBeInTheDocument();
        expect(screen.getAllByLabelText("Type")).toHaveLength(1);
    });

    it("shows the video URL field only when the location option's type is video", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[makeMeetingType({ locationOptions: [{ uid: "lo-1", type: BookingLocationType.PHONE }] })]} />);

        expect(screen.queryByLabelText("Meeting URL (optional)")).not.toBeInTheDocument();

        await user.selectOptions(screen.getByLabelText("Type"), BookingLocationType.VIDEO);

        expect(screen.getByLabelText("Meeting URL (optional)")).toBeInTheDocument();
    });
});
