import { BadRequestException, HttpException } from "@nestjs/common";
import { prisma } from "@birr/db";
import { normalizeWhatsAppNumber } from "./giver-whatsapp.service";
import { createGiverWhatsApp, testNumber } from "./test-support/fake-whatsapp";

describe("normalizeWhatsAppNumber", () => {
  test("reads Nigerian and international forms as E.164", () => {
    expect(normalizeWhatsAppNumber("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeWhatsAppNumber("2348031234567")).toBe("+2348031234567");
    expect(normalizeWhatsAppNumber("+234 (803) 123-4567")).toBe("+2348031234567");
    expect(normalizeWhatsAppNumber("00447700900123")).toBe("+447700900123");
  });

  test("refuses what can't be a phone number", () => {
    expect(normalizeWhatsAppNumber("8031234567")).toBeNull();
    expect(normalizeWhatsAppNumber("+234")).toBeNull();
    expect(normalizeWhatsAppNumber("hello")).toBeNull();
  });
});

describe("GiverWhatsAppService", () => {
  const { service, fake, confirmed } = createGiverWhatsApp();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a code sent by WhatsApp confirms the number and returns a proof the giving routes accept", async () => {
    const number = testNumber();
    const local = `0${number.slice(4)}`;
    expect(await service.requestCode(local, "198.51.100.10")).toEqual({ sent: true, number });
    const code = fake.lastCode(number);
    expect(code).toMatch(/^\d{6}$/);
    // Only hashes are kept.
    const row = await prisma.giverWhatsAppConfirmation.findFirstOrThrow({ where: { phoneNumber: number } });
    expect(row.codeHash).not.toContain(code);

    const { proof } = await service.confirm(local, code);
    expect(await service.assertProof(number, proof)).toBe(number);
    expect((await prisma.giverWhatsAppConfirmation.findUniqueOrThrow({ where: { id: row.id } })).proofHash).not.toBe(proof);
    // A code works once.
    await expect(service.confirm(number, code)).rejects.toThrow(BadRequestException);
  });

  test("a wrong code is refused, and five wrong guesses use the code up", async () => {
    const number = testNumber();
    await service.requestCode(number);
    const code = fake.lastCode(number);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(service.confirm(number, wrong)).rejects.toThrow(/isn't right/);
    for (let i = 0; i < 4; i++) await expect(service.confirm(number, wrong)).rejects.toThrow(BadRequestException);
    await expect(service.confirm(number, code)).rejects.toThrow(/Too many wrong codes/);
  });

  // Review finding (2026-11-16): a newer request, someone else's say,
  // mustn't make the giver's own code stale.
  test("an older code still works after a newer one is requested", async () => {
    const number = testNumber();
    await service.requestCode(number, "198.51.100.40");
    const older = fake.lastCode(number);
    await service.requestCode(number, "198.51.100.41");
    const { proof } = await service.confirm(number, older);
    expect(await service.assertProof(number, proof)).toBe(number);
  });

  test("a wrong guess counts against every live code, so asking for more codes doesn't buy more guesses", async () => {
    const number = testNumber();
    await service.requestCode(number, "198.51.100.42");
    await service.requestCode(number, "198.51.100.43");
    const rows = () => prisma.giverWhatsAppConfirmation.findMany({ where: { phoneNumber: number } });
    const codes = new Set(fake.codes.filter((c) => c.to === number).map((c) => c.code));
    const wrong = ["000000", "111111", "222222"].find((c) => !codes.has(c))!;
    await expect(service.confirm(number, wrong)).rejects.toThrow(/isn't right/);
    expect((await rows()).map((r) => r.attempts)).toEqual([1, 1]);
  });

  test("an expired code is refused", async () => {
    const number = testNumber();
    await service.requestCode(number);
    await prisma.giverWhatsAppConfirmation.updateMany({ where: { phoneNumber: number }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(service.confirm(number, fake.lastCode(number))).rejects.toThrow(/expired/);
  });

  test("a proof is refused for another number, once expired, or when missing", async () => {
    const { number, proof } = await confirmed();
    await expect(service.assertProof(testNumber(), proof)).rejects.toThrow(/expired/);
    await expect(service.assertProof(number, undefined)).rejects.toThrow(/Confirm your WhatsApp number/);
    await prisma.giverWhatsAppConfirmation.updateMany({ where: { phoneNumber: number }, data: { proofExpiresAt: new Date(Date.now() - 1000) } });
    await expect(service.assertProof(number, proof)).rejects.toThrow(/expired/);
  });

  test("codes are rationed: three per number from one IP, eight per number, ten per IP per hour", async () => {
    const number = testNumber();
    // Addresses unique to this run: requests are counted per IP for an
    // hour, so fixed ones run out when the suite is run a few times.
    const run = Date.now();
    const at = (n: number) => `198.51.100.${n}-${run}`;
    for (let i = 0; i < 3; i++) await service.requestCode(number, at(30));
    await expect(service.requestCode(number, at(30))).rejects.toThrow(HttpException);
    // Someone else asking for codes to this number doesn't use up the giver's own three...
    for (let i = 0; i < 3; i++) await service.requestCode(number, at(31));
    for (let i = 0; i < 2; i++) await service.requestCode(number, at(32));
    // ...but a number has an overall cap.
    await expect(service.requestCode(number, at(33))).rejects.toThrow(/Too many codes/);
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}-${Date.now()}`;
    for (let i = 0; i < 10; i++) await service.requestCode(testNumber(), ip);
    await expect(service.requestCode(testNumber(), ip)).rejects.toThrow(/Too many codes/);
  });

  test("a number that can't be reached says so plainly", async () => {
    fake.failNextCode = true;
    await expect(service.requestCode(testNumber())).rejects.toThrow(/couldn't send a WhatsApp code/);
    await expect(service.requestCode("12345")).rejects.toThrow(/Enter a WhatsApp number/);
  });
});

describe("database rules for givers' contacts", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("a giver must have an email or a WhatsApp number, and a number is stored in international format", async () => {
    await expect(prisma.zakahPayer.create({ data: {} })).rejects.toThrow(/zakah_payers_contact/);
    await expect(prisma.vaultDonor.create({ data: {} })).rejects.toThrow(/vault_donors_contact/);
    await expect(prisma.zakahPayer.create({ data: { whatsappNumber: "08031234567" } })).rejects.toThrow(/whatsapp_e164/);
    await expect(prisma.giverWhatsAppConfirmation.create({ data: { phoneNumber: testNumber(), codeHash: "x", expiresAt: new Date(), proofHash: `p-${Date.now()}` } })).rejects.toThrow(
      /proof_after_confirm/,
    );
    const payer = await prisma.zakahPayer.create({ data: { whatsappNumber: testNumber() } });
    expect(payer.email).toBeNull();
  });
});
