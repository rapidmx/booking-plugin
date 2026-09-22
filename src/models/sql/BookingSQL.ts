///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BaseEntity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
import { MailboxScopedData } from "@rapidmx/restapi";
import { Booking, BookingLocationType, BookingStatus } from "../types.js";
const { Description } = DocDecorators;
const { DataStore, Protect } = ModelDecorators;
const { Column, Entity, Index } = PersistenceDecorators;
const { Nullable } = ObjectDecorators;

/**
 * Implementation of the `Booking` interface for storage in a SQL database. If MongoDB is desired, please use
 * `models.mongo.BookingMongo` instead.
 *
 * @author Jean-Philippe Steinmetz
 */
@DataStore("sql")
@Entity()
@MailboxScopedData()
@Description("A single appointment booked against a BookingType by an anonymous visitor.")
@Index("booking_manage_token", ["manageToken"], { unique: true })
@Index("booking_type", ["bookingTypeUid"])
@Index("booking_mailbox", ["mailboxUid"])
@Protect(
    {
        uid: "Booking",
        records: [
            { userOrRoleId: "anonymous", actions: [] },
            { userOrRoleId: ".*", actions: [] },
        ],
    },
    false,
)
export class BookingSQL extends BaseEntity implements Booking {
    @Column()
    @Description("The unique identifier of the `BookingType` this was booked against.")
    public bookingTypeUid: string = "";

    @Column()
    @Description("The unique identifier of the host `Mailbox`.")
    public mailboxUid: string = "";

    @Column()
    @Description("The unique identifier of the `Folder` (of type CALENDAR) holding calendarEventUid.")
    public folderUid: string = "";

    @Column()
    @Description("The unique identifier of the `CalendarEvent` created for this booking.")
    public calendarEventUid: string = "";

    @Column()
    @Description("The unique identifier of the `BookingMeetingType` this was booked as.")
    public meetingTypeUid: string = "";

    @Column()
    @Description("The meeting type's name at the moment of booking.")
    public meetingTypeName: string = "";

    // `type: "varchar"` is required on every enum-typed column - see `status` below.
    @Column({ type: "varchar" })
    @Description("The kind of location the booker chose.")
    public locationType: BookingLocationType = BookingLocationType.OTHER;

    @Column({ nullable: true })
    @Description("The location option's label at the moment of booking, if it had one.")
    @Nullable
    public locationLabel?: string;

    @Column({ nullable: true })
    @Description("Set when locationType is PHONE: the phone number the booker typed in.")
    @Nullable
    public bookerPhone?: string;

    @Column({ nullable: true })
    @Description("Set when locationType is VIDEO and a URL is known, from setup time or set afterward by the host.")
    @Nullable
    public locationVideoUrl?: string;

    @Column({ type: "text", nullable: true })
    @Description("Set when locationType is OTHER: the free-text instructions the booker typed in.")
    @Nullable
    public bookerLocationInstructions?: string;

    @Column()
    @Description("The booker's name.")
    public bookerName: string = "";

    @Column()
    @Description("The booker's email address, normalized to lowercase.")
    public bookerEmail: string = "";

    @Column({ type: "text", nullable: true })
    @Description("Free-form notes the booker supplied when booking.")
    @Nullable
    public bookerNotes?: string;

    @Column({ nullable: true })
    @Description("The IANA timezone the booker selected their slot in, recorded for the host's benefit only.")
    @Nullable
    public bookerTimezone?: string;

    @Column()
    @Description("The start of the booked appointment.")
    public startDate: Date = new Date();

    @Column()
    @Description("The end of the booked appointment.")
    public endDate: Date = new Date();

    // `type: "varchar"` is required on every enum-typed column - see `MessageSQL.importance`'s own comment
    // for the `emitDecoratorMetadata`/TypeORM reason.
    @Column({ type: "varchar" })
    @Description("The current state of this booking.")
    public status: BookingStatus = BookingStatus.CONFIRMED;

    @Column()
    @Description("The unguessable token embedded in the booker's manage link. Minted server-side, immutable.")
    public manageToken: string = "";

    @Column({ nullable: true })
    @Description("When this booking was cancelled, if it has been.")
    @Nullable
    public cancelledAt?: Date;

    constructor(other?: Partial<BookingSQL>) {
        super(other);

        if (other) {
            this.bookingTypeUid = other.bookingTypeUid !== undefined ? other.bookingTypeUid : this.bookingTypeUid;
            this.mailboxUid = other.mailboxUid !== undefined ? other.mailboxUid : this.mailboxUid;
            this.folderUid = other.folderUid !== undefined ? other.folderUid : this.folderUid;
            this.calendarEventUid = other.calendarEventUid !== undefined ? other.calendarEventUid : this.calendarEventUid;
            this.meetingTypeUid = other.meetingTypeUid !== undefined ? other.meetingTypeUid : this.meetingTypeUid;
            this.meetingTypeName = other.meetingTypeName !== undefined ? other.meetingTypeName : this.meetingTypeName;
            this.locationType = other.locationType !== undefined ? other.locationType : this.locationType;
            this.locationLabel = "locationLabel" in other ? other.locationLabel : this.locationLabel;
            this.bookerPhone = "bookerPhone" in other ? other.bookerPhone : this.bookerPhone;
            this.locationVideoUrl = "locationVideoUrl" in other ? other.locationVideoUrl : this.locationVideoUrl;
            this.bookerLocationInstructions = "bookerLocationInstructions" in other ? other.bookerLocationInstructions : this.bookerLocationInstructions;
            this.bookerName = other.bookerName !== undefined ? other.bookerName : this.bookerName;
            this.bookerEmail = other.bookerEmail !== undefined ? other.bookerEmail : this.bookerEmail;
            this.bookerNotes = "bookerNotes" in other ? other.bookerNotes : this.bookerNotes;
            this.bookerTimezone = "bookerTimezone" in other ? other.bookerTimezone : this.bookerTimezone;
            this.startDate = other.startDate !== undefined ? other.startDate : this.startDate;
            this.endDate = other.endDate !== undefined ? other.endDate : this.endDate;
            this.status = other.status !== undefined ? other.status : this.status;
            this.manageToken = other.manageToken !== undefined ? other.manageToken : this.manageToken;
            this.cancelledAt = "cancelledAt" in other ? other.cancelledAt : this.cancelledAt;
        }
    }
}
