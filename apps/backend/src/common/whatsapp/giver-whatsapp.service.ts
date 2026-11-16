import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "@birr/db";
import { TwilioWhatsAppAdapter } from "./twilio-whatsapp.adapter";

const CODE_VALIDITY_MS = 10 * 60 * 1000;
const PROOF_VALIDITY_MS = 60 * 60 * 1000;
/**
 * How many codes before a giver has to wait. Counted per number *from one
 * IP*, so a stranger asking for codes to someone's number can't use up
 * that person's own allowance; a number's overall cap is higher, and each
 * IP has its own cap across numbers.
 */
const PER_NUMBER_AND_IP_LIMIT = { count: 3, windowMs: 30 * 60 * 1000 };
const PER_NUMBER_LIMIT = { count: 8, windowMs: 30 * 60 * 1000 };
const PER_IP_LIMIT = { count: 10, windowMs: 60 * 60 * 1000 };
/** Unexpired codes a confirmation is checked against: any one sent recently works. */
const LIVE_CODES_CHECKED = 8;
/** Guesses per code (each row's maxAttempts defaults to this). */
const MAX_ATTEMPTS = 5;
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * A WhatsApp number as typed, in E.164: "0803 123 4567", "2348031234567"
 * and "+234 803 123 4567" all become "+2348031234567". A leading 0 is read
 * as a Nigerian number. Null when it can't be a phone number.
 */
export function normalizeWhatsAppNumber(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "");
  let e164: string;
  if (digits.startsWith("+")) e164 = digits;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("0")) e164 = `+234${digits.slice(1)}`;
  else if (digits.startsWith("234")) e164 = `+${digits}`;
  else return null;
  return E164.test(e164) ? e164 : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Confirms a giver's WhatsApp number before Birr uses it (owner's decision,
 * 2026-11-16): for receipts and notices, the private manage link of a
 * monthly gift, and adding up giving toward the AML threshold. Givers have
 * no account, so unlike WhatsAppOtpService (user-keyed) this is keyed by
 * the number itself, and hands back a short-lived proof that the giving
 * routes check with assertProof(). Only hashes of the code and proof are
 * kept.
 */
@Injectable()
export class GiverWhatsAppService {
  private readonly logger = new Logger(GiverWhatsAppService.name);

  constructor(private readonly whatsApp: TwilioWhatsAppAdapter) {}

  async requestCode(rawNumber: string, ip?: string): Promise<{ sent: true; number: string }> {
    const number = normalizeWhatsAppNumber(rawNumber);
    if (!number) throw new BadRequestException("Enter a WhatsApp number, like 0803 123 4567 or +234 803 123 4567.");

    // Codes cost money and land on someone's phone, so they're rationed per
    // number and per IP, not only by the route throttle.
    const now = Date.now();
    const since = (windowMs: number) => ({ gte: new Date(now - windowMs) });
    const [forNumberAndIp, forNumber, forIp] = await Promise.all([
      prisma.giverWhatsAppConfirmation.count({ where: { phoneNumber: number, requestIp: ip ?? null, createdAt: since(PER_NUMBER_AND_IP_LIMIT.windowMs) } }),
      prisma.giverWhatsAppConfirmation.count({ where: { phoneNumber: number, createdAt: since(PER_NUMBER_LIMIT.windowMs) } }),
      ip ? prisma.giverWhatsAppConfirmation.count({ where: { requestIp: ip, createdAt: since(PER_IP_LIMIT.windowMs) } }) : Promise.resolve(0),
    ]);
    if (forNumberAndIp >= PER_NUMBER_AND_IP_LIMIT.count || forNumber >= PER_NUMBER_LIMIT.count || forIp >= PER_IP_LIMIT.count) {
      throw new HttpException("Too many codes requested. Please wait a while and try again.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const row = await prisma.giverWhatsAppConfirmation.create({
      data: { phoneNumber: number, codeHash: "pending", expiresAt: new Date(now + CODE_VALIDITY_MS), requestIp: ip ?? null },
    });
    // The id salts the hash, so it's written once the row exists.
    await prisma.giverWhatsAppConfirmation.update({ where: { id: row.id }, data: { codeHash: sha256(code + row.id) } });
    try {
      await this.whatsApp.sendOtp(number, code);
    } catch (err) {
      this.logger.error(`Couldn't send a giver WhatsApp code: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException("We couldn't send a WhatsApp code to that number. Check it, or use your email instead.");
    }
    return { sent: true, number };
  }

  /**
   * Checks the code against every unexpired code sent to this number, so a
   * newer request (someone else's, say) never makes the giver's own code
   * stale. On success returns the proof the giving routes need.
   */
  async confirm(rawNumber: string, code: string): Promise<{ number: string; proof: string; expiresAt: Date }> {
    const number = normalizeWhatsAppNumber(rawNumber);
    if (!number) throw new BadRequestException("Enter a WhatsApp number, like 0803 123 4567.");
    const rows = await prisma.giverWhatsAppConfirmation.findMany({
      where: { phoneNumber: number, confirmedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: LIVE_CODES_CHECKED,
    });
    if (rows.length === 0) throw new BadRequestException("That code has expired. Ask for a new one.");
    const live = rows.filter((r) => r.attempts < r.maxAttempts);
    if (live.length === 0) throw new BadRequestException("Too many wrong codes. Ask for a new one.");
    // Every guess counts against every live code, first, so guesses stay
    // limited even if several arrive together.
    await prisma.giverWhatsAppConfirmation.updateMany({
      where: { id: { in: live.map((r) => r.id) }, attempts: { lt: MAX_ATTEMPTS }, confirmedAt: null },
      data: { attempts: { increment: 1 } },
    });
    const row = live.find((r) => sha256(code.trim() + r.id) === r.codeHash);
    if (!row) throw new BadRequestException("That code isn't right. Check the WhatsApp message and try again.");

    const proof = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + PROOF_VALIDITY_MS);
    const claimed = await prisma.giverWhatsAppConfirmation.updateMany({
      where: { id: row.id, confirmedAt: null },
      data: { confirmedAt: new Date(), proofHash: sha256(proof), proofExpiresAt: expiresAt },
    });
    if (claimed.count !== 1) throw new BadRequestException("That code has already been used. Ask for a new one.");
    return { number, proof, expiresAt };
  }

  /**
   * The number a giving route may use, given the proof its confirmation
   * returned. Refuses a proof that's wrong, expired, or for another number.
   */
  async assertProof(rawNumber: string, proof: string | undefined): Promise<string> {
    const number = normalizeWhatsAppNumber(rawNumber);
    if (!number) throw new BadRequestException("Enter a WhatsApp number, like 0803 123 4567.");
    if (!proof) throw new BadRequestException("Confirm your WhatsApp number with the code we send you first.");
    const row = await prisma.giverWhatsAppConfirmation.findUnique({ where: { proofHash: sha256(proof) } });
    if (!row || row.phoneNumber !== number || !row.proofExpiresAt || row.proofExpiresAt < new Date()) {
      throw new BadRequestException("Your WhatsApp confirmation has expired. Please confirm your number again.");
    }
    return number;
  }
}
