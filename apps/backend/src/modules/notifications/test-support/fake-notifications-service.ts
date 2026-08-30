import { NotificationsService } from "../notifications.service";
import { ResendNotificationEmailAdapter } from "../email/resend-notification.adapter";
import { TwilioWhatsAppAdapter } from "../../../common/whatsapp/twilio-whatsapp.adapter";

/**
 * A real NotificationsService wired with no-op fake email/WhatsApp
 * adapters — never construct the real Resend/Twilio adapters in a spec
 * (see governed-actions.service.spec.ts's own comment on why: a single
 * test can fan out to every active BirrStaff fixture in a shared dev
 * database, and a real adapter turns that into a live-API-hammering
 * storm). Shared here since every service that injects
 * NotificationsService needs the exact same construction in its own
 * spec — same "fake adapter cast as the real class" pattern as
 * FakeEmailAdapter/FakeInvitationEmailAdapter/FakeOtpAdapter elsewhere
 * in this codebase, just centralized because this one specific fake is
 * needed in many spec files rather than one.
 */
class FakeNotificationEmailAdapter {
  sent: { to: string; title: string }[] = [];
  async sendNotificationEmail(to: string, input: { title: string; body: string; linkUrl?: string }): Promise<void> {
    this.sent.push({ to, title: input.title });
  }
}

class FakeWhatsAppAdapter {
  sent: { to: string; body: string }[] = [];
  async sendOtp(): Promise<void> {}
  async sendMessage(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

export function createFakeNotificationsService(): NotificationsService {
  return new NotificationsService(
    new FakeNotificationEmailAdapter() as unknown as ResendNotificationEmailAdapter,
    new FakeWhatsAppAdapter() as unknown as TwilioWhatsAppAdapter,
  );
}
