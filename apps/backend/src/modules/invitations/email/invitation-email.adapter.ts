import { InviteeKind } from "@birr/db";

export interface InvitationEmailContext {
  inviteeKind: InviteeKind;
  roleLabel: string;
  invitedByName: string;
}

export interface InvitationEmailAdapter {
  sendInvitationEmail(to: string, link: string, context: InvitationEmailContext): Promise<void>;
}
