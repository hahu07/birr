import { randomInt } from "crypto";
import type { TwilioWhatsAppAdapter } from "../twilio-whatsapp.adapter";
import { GiverWhatsAppService } from "../giver-whatsapp.service";

/** Records what would be sent by WhatsApp. Nothing reaches Twilio. */
export class FakeWhatsApp {
  codes: { to: string; code: string }[] = [];
  messages: { to: string; body: string }[] = [];
  failNextCode = false;

  async sendOtp(to: string, code: string) {
    if (this.failNextCode) {
      this.failNextCode = false;
      throw new Error("Twilio is down");
    }
    this.codes.push({ to, code });
  }

  async sendMessage(to: string, body: string) {
    this.messages.push({ to, body });
  }

  /** The last code sent to this number. */
  lastCode(to: string): string {
    const sent = [...this.codes].reverse().find((c) => c.to === to);
    if (!sent) throw new Error(`No code was sent to ${to}.`);
    return sent.code;
  }
}

/** A fresh Nigerian mobile number, so per-number limits never carry over between runs. */
export function testNumber(): string {
  return `+23480${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

export function createGiverWhatsApp() {
  const fake = new FakeWhatsApp();
  const service = new GiverWhatsAppService(fake as unknown as TwilioWhatsAppAdapter);
  /** Confirms a number the way a giver would, returning what the giving routes need. */
  async function confirmed(number = testNumber()) {
    await service.requestCode(number);
    const { proof } = await service.confirm(number, fake.lastCode(number));
    return { number, proof };
  }
  return { service, fake, confirmed };
}
