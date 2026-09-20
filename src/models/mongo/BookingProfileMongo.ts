///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { BaseMongoEntity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
import { MailboxScopedData } from "@rapidmx/restapi";
import { BookingProfile } from "../types.js";
const { Description } = DocDecorators;
const { DataStore, Protect } = ModelDecorators;
const { Column, Entity } = PersistenceDecorators;
const { Nullable } = ObjectDecorators;

/**
 * Implementation of the `BookingProfile` interface for storage in a MongoDB database. If SQL is desired, please
 * use `models.sql.BookingProfileSQL` instead.
 *
 * @author Jean-Philippe Steinmetz
 */
@DataStore("mongo")
@Entity()
@MailboxScopedData()
@Description("The avatar and banner shown on a mailbox's public booking pages.")
@Protect(
    {
        uid: "BookingProfile",
        records: [
            { userOrRoleId: "anonymous", actions: [] },
            { userOrRoleId: ".*", actions: [] },
        ],
    },
    false,
)
export class BookingProfileMongo extends BaseMongoEntity implements BookingProfile {
    @Column()
    @Description("The unique identifier of the `Mailbox` this profile belongs to.")
    public mailboxUid: string = "";

    @Column({ nullable: true })
    @Description("The BlobStore key of the avatar image.")
    @Nullable
    public avatarBlobKey?: string;

    @Column({ nullable: true })
    @Description("The media type the avatar was uploaded as.")
    @Nullable
    public avatarContentType?: string;

    @Column({ nullable: true })
    @Description("The BlobStore key of the banner image.")
    @Nullable
    public bannerBlobKey?: string;

    @Column({ nullable: true })
    @Description("The media type the banner was uploaded as.")
    @Nullable
    public bannerContentType?: string;

    constructor(other?: Partial<BookingProfileMongo>) {
        super(other);

        if (other) {
            this.mailboxUid = other.mailboxUid !== undefined ? other.mailboxUid : this.mailboxUid;
            this.avatarBlobKey = "avatarBlobKey" in other ? other.avatarBlobKey : this.avatarBlobKey;
            this.avatarContentType = "avatarContentType" in other ? other.avatarContentType : this.avatarContentType;
            this.bannerBlobKey = "bannerBlobKey" in other ? other.bannerBlobKey : this.bannerBlobKey;
            this.bannerContentType = "bannerContentType" in other ? other.bannerContentType : this.bannerContentType;
        }
    }
}
