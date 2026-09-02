import { Injectable, NotFoundException } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { prisma, Prisma } from "@birr/db";
import { withFounderScope } from "../../common/db/founder-scope";
import { resolveFounderRecipientUserIdsForFoundation } from "../../common/notifications/resolve-founder-recipients";
import { NotificationsService } from "../notifications/notifications.service";
import { MessageAttachmentStorageService } from "./message-attachment-storage.service";

export class SendMessageInput {
  @IsString()
  foundationId!: string;

  @IsString()
  @IsNotEmpty({ message: "Message can't be empty." })
  body!: string;
}

export type MessageSender =
  | { senderType: "birr_staff"; senderUserId: string }
  | { senderType: "founder_user"; senderUserId: string; founderId: string };

const MESSAGE_INCLUDE = {
  senderUser: { select: { id: true, fullName: true } },
  attachments: true,
} as const;

/**
 * Founder <-> Birr staff communication, scoped per Foundation — a
 * deliberate choice (confirmed with the owner) over the per-Waqf-Fund
 * organization every other section on a waqf's own page uses. Not a
 * governed_actions entity and not audit-logged the way a governed
 * entity's writes are — messaging isn't a fiduciary decision, same
 * "plain CRUD, not specially audited" posture AssetsService.create()'s
 * own comment draws for asset registration.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly attachmentStorage: MessageAttachmentStorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // Founder branch routed through withFounderScope (2026-08-31 codebase
  // audit finding) — the ownership check below was already correct on
  // its own, but without the RLS session var set, founder_isolation was
  // a silent no-op on this write. Not applicable to a birr_staff sender
  // (no single founder to scope RLS to — staff can message any
  // Foundation), so that branch keeps the plain, unscoped transaction.
  async send(input: SendMessageInput, sender: MessageSender, files: Express.Multer.File[]) {
    const run = async (tx: Prisma.TransactionClient) => {
      if (sender.senderType === "founder_user") {
        const foundation = await tx.foundation.findFirst({
          where: { id: input.foundationId, foundationFounders: { some: { founderId: sender.founderId } } },
          select: { id: true },
        });
        if (!foundation) {
          throw new NotFoundException(`Foundation "${input.foundationId}" not found.`);
        }
      }

      const created = await tx.message.create({
        data: { foundationId: input.foundationId, senderType: sender.senderType, senderUserId: sender.senderUserId, body: input.body },
      });
      // Sequential, not Promise.all — keeps write order deterministic
      // for a small N, same style as this codebase's other small
      // per-item transaction loops (e.g. purge-fixture-data.ts).
      for (const file of files) {
        const saved = await this.attachmentStorage.saveAttachment(file);
        await tx.messageAttachment.create({ data: { messageId: created.id, ...saved } });
      }
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: MESSAGE_INCLUDE });
    };

    const message =
      sender.senderType === "founder_user" ? await withFounderScope(sender.founderId, run) : await prisma.$transaction(run);

    this.notifyRecipients(message, sender).catch((err) => {
      console.error(`Failed to notify recipients for message "${message.id}":`, err);
    });

    return message;
  }

  list(foundationId: string) {
    return prisma.message.findMany({
      where: { foundationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: MESSAGE_INCLUDE,
    });
  }

  // One row per Foundation that has at least one message, most-recently-
  // active first — the Ops Console's own Messages nav item needs this
  // (staff manage many Foundations at once, so a per-Foundation-page
  // thread alone isn't discoverable), and the Founder Portal reuses the
  // exact same shape for a founder attached to more than one Foundation.
  // No new "unread" bookkeeping here — that's already covered by the
  // existing message.received Notification rows; the frontend derives
  // per-Foundation unread state from those instead of this endpoint
  // tracking a second, redundant read-state.
  inbox() {
    return this.buildInbox();
  }

  async inboxForFounder(founderId: string) {
    return withFounderScope(founderId, (tx) => this.buildInbox(founderId, tx));
  }

  private async buildInbox(founderId?: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    const messages = await client.message.findMany({
      where: {
        deletedAt: null,
        ...(founderId ? { foundation: { foundationFounders: { some: { founderId } } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        foundation: { select: { id: true, name: true } },
        senderUser: { select: { id: true, fullName: true } },
      },
    });

    const seenFoundationIds = new Set<string>();
    const inbox: {
      foundation: { id: string; name: string };
      lastMessage: {
        id: string;
        body: string;
        senderType: string;
        senderUser: { id: string; fullName: string };
        createdAt: Date;
      };
    }[] = [];
    for (const message of messages) {
      if (seenFoundationIds.has(message.foundationId)) continue;
      seenFoundationIds.add(message.foundationId);
      inbox.push({
        foundation: message.foundation,
        lastMessage: {
          id: message.id,
          body: message.body,
          senderType: message.senderType,
          senderUser: message.senderUser,
          createdAt: message.createdAt,
        },
      });
    }
    return inbox;
  }

  // Mirrors AssetsService.listForFounder's shape exactly — withFounderScope,
  // ownership check, null (not throw) on "not found or not theirs."
  async listForFounder(foundationId: string, founderId: string) {
    return withFounderScope(founderId, async (tx) => {
      const foundation = await tx.foundation.findFirst({
        where: { id: foundationId, foundationFounders: { some: { founderId } } },
        select: { id: true },
      });
      if (!foundation) return null;
      return tx.message.findMany({
        where: { foundationId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: MESSAGE_INCLUDE,
      });
    });
  }

  private async notifyRecipients(
    message: { id: string; foundationId: string; body: string; senderUser: { fullName: string } },
    sender: MessageSender,
  ): Promise<void> {
    const preview = message.body.length > 140 ? `${message.body.slice(0, 140)}…` : message.body;
    const title = `${message.senderUser.fullName} sent a message`;

    if (sender.senderType === "founder_user") {
      // Staff with an active case assignment on any waqf under this
      // foundation — a genuinely new, one-off query (not extracted into
      // resolve-founder-recipients.ts, which is founder-side only),
      // following this codebase's own "extract only once reused 2-3x"
      // convention. Known limitation, accepted deliberately: a
      // foundation whose waqf(s) have no active case assignment yet
      // notifies no one — the message still exists and any staff member
      // can still find it by browsing to the Foundation.
      const assignments = await prisma.waqfCaseAssignment.findMany({
        where: { status: "active", waqf: { foundationId: message.foundationId } },
        select: { birrStaff: { select: { userId: true } } },
      });
      const staffUserIds = [...new Set(assignments.map((a) => a.birrStaff.userId))];
      await Promise.all(
        staffUserIds.map((userId) =>
          this.notifications.notify({
            recipientType: "birr_staff",
            recipientUserId: userId,
            type: "message.received",
            title,
            body: preview,
            linkUrl: `/ops/foundations/${message.foundationId}`,
            relatedEntityType: "Message",
            relatedEntityId: message.id,
          }),
        ),
      );
    } else {
      const founderUserIds = await resolveFounderRecipientUserIdsForFoundation(message.foundationId);
      await Promise.all(
        founderUserIds.map((userId) =>
          this.notifications.notify({
            recipientType: "founder_user",
            recipientUserId: userId,
            type: "message.received",
            title,
            body: preview,
            linkUrl: `/foundations/${message.foundationId}`,
            relatedEntityType: "Message",
            relatedEntityId: message.id,
          }),
        ),
      );
    }
  }
}
