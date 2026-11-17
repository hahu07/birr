import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { createValidationPipe } from "./validation-pipe";
import { DateField, EmailField, IdField, LongTextField, NameField, PhoneField, SecretField, TextField, UrlField } from "./fields";
import { fieldLabel } from "./messages";
import { IsOptional } from "class-validator";
import { RegisterCounterpartyInput } from "../../modules/counterparties/counterparties.service";
import { CreateZakahRecipientInput } from "../../modules/zakah/zakah-distributions.service";
import { ZakahPayerIdentityInput } from "../../modules/zakah/zakah-payments.service";

// Every form's fields are checked the same way (owner's decision,
// 2026-11-16), through the same pipe the API uses.
class Sample {
  @NameField() name!: string;
  @IsOptional() @TextField(10) note?: string;
  @IsOptional() @LongTextField(20) story?: string;
  @IsOptional() @EmailField() email?: string;
  @IsOptional() @PhoneField() phone?: string;
  @IsOptional() @UrlField() website?: string;
  @IsOptional() @DateField() expiresAt?: string;
  @IsOptional() @IdField() someId?: string;
  @IsOptional() @SecretField(12) password?: string;
}

const pipe = createValidationPipe();
const run = (metatype: new () => object, body: object) => pipe.transform(body, { type: "body", metatype });
const errorsFor = async (metatype: new () => object, body: object): Promise<string[]> => {
  try {
    await run(metatype, body);
    return [];
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { message: string[] }).message;
  }
};

describe("field rules", () => {
  test("text is trimmed, and blank counts as not given", async () => {
    const out = (await run(Sample, { name: "  Lotus Capital  ", note: "   " })) as Sample;
    expect(out.name).toBe("Lotus Capital");
    expect(out.note).toBeUndefined();
    expect(await errorsFor(Sample, { name: "   " })).toEqual(["Name is required."]);
  });

  test("a name needs letters, and every field has a length limit", async () => {
    expect(await errorsFor(Sample, { name: "12345" })).toEqual(["Name must contain letters."]);
    expect(await errorsFor(Sample, { name: "A", note: "x".repeat(11), story: "y".repeat(21) })).toEqual([
      "Note must be at most 10 characters.",
      "Story must be at most 20 characters.",
    ]);
  });

  test("emails, web addresses and dates must be what they say", async () => {
    const errors = await errorsFor(Sample, { name: "A", email: "info@lotus", website: "lotus.com", expiresAt: "next week" });
    expect(errors).toEqual([
      "Email must be a valid email address, like name@example.com.",
      "Website must be a web address starting with https://.",
      "Expires at must be a date.",
    ]);
    const ok = (await run(Sample, { name: "A", email: " Info@Lotus.com ", website: "https://lotus.com", expiresAt: "2027-06-30" })) as Sample;
    // Trimmed, never re-cased: accounts are found by the email as stored.
    expect(ok.email).toBe("Info@Lotus.com");
  });

  test("a phone number is stored in international form, Nigerian numbers included", async () => {
    expect(((await run(Sample, { name: "A", phone: "0907 867 5432" })) as Sample).phone).toBe("+2349078675432");
    expect(((await run(Sample, { name: "A", phone: "+44 7700 900123" })) as Sample).phone).toBe("+447700900123");
    expect(await errorsFor(Sample, { name: "A", phone: "12345" })).toEqual(["Phone must be a phone number, like 0803 123 4567 or +234 803 123 4567."]);
  });

  test("ids and passwords are bounded but never changed", async () => {
    const out = (await run(Sample, { name: "A", someId: " abc ", password: " pass word " })) as Sample;
    expect(out.someId).toBe(" abc ");
    expect(out.password).toBe(" pass word ");
    expect(await errorsFor(Sample, { name: "A", password: "x".repeat(13) })).toEqual(["Password must be at most 12 characters."]);
  });

  test("unknown fields are refused by name", async () => {
    expect(await errorsFor(Sample, { name: "A", isAdmin: true })).toEqual(["Is admin isn't accepted here."]);
  });

  test("labels read like the form: contactEmail is 'Contact email'", () => {
    expect(fieldLabel("contactEmail")).toBe("Contact email");
    expect(fieldLabel("licenseExpiresAt")).toBe("License expires at");
  });
});

// The form that prompted this: Ops → Counterparties.
describe("registering a counterparty", () => {
  const valid = {
    name: "Lotus Capital",
    institutionType: "asset_manager",
    jurisdiction: "NG",
    businessActivities: "Asset and fund management for Shariah-compliant mandates.",
  };

  test("a valid registration is cleaned up: trimmed, phone in international form", async () => {
    const out = (await run(RegisterCounterpartyInput, { ...valid, name: " Lotus Capital ", contactEmail: "info@lotus.com", contactPhone: "0907 867 5432", website: "https://lotus.com" })) as RegisterCounterpartyInput;
    expect(out.name).toBe("Lotus Capital");
    expect(out.contactPhone).toBe("+2349078675432");
  });

  test("each bad field is refused with a plain reason", async () => {
    const errors = await errorsFor(RegisterCounterpartyInput, {
      ...valid,
      jurisdiction: "Nigeria",
      contactEmail: "info@lotus",
      contactPhone: "123",
      website: "lotus",
      licenseExpiresAt: "soon",
      registrationNumber: "R".repeat(101),
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Jurisdiction must be a country/),
        "Contact email must be a valid email address, like name@example.com.",
        "Contact phone must be a phone number, like 0803 123 4567 or +234 803 123 4567.",
        "Website must be a web address starting with https://.",
        "License expires at must be a date.",
        "Registration number must be at most 100 characters.",
      ]),
    );
  });

  test("a name of spaces, or no name, is refused", async () => {
    expect(await errorsFor(RegisterCounterpartyInput, { ...valid, name: "   " })).toEqual(["Name is required."]);
  });

  test("what the owner typed on 2026-11-16 is refused: a 24-digit phone, a licence number with no digits, an authority with no letters", async () => {
    const errors = await errorsFor(RegisterCounterpartyInput, {
      ...valid,
      contactPhone: "070578781111111111111111",
      regulatoryLicenseNumber: "adewale",
      regulatingAuthority: "345666",
    });
    expect(errors).toEqual([
      "Contact phone must be a phone number, like 0803 123 4567 or +234 803 123 4567.",
      "Regulatory license number should include digits, like RC 1909785.",
      "Regulating authority must contain letters.",
    ]);
    const ok = (await run(RegisterCounterpartyInput, { ...valid, regulatoryLicenseNumber: " CBN/MFB/2019/045 ", regulatingAuthority: "Central Bank of Nigeria" })) as RegisterCounterpartyInput;
    expect(ok).toMatchObject({ regulatoryLicenseNumber: "CBN/MFB/2019/045", regulatingAuthority: "Central Bank of Nigeria" });
  });
});

describe("fields that keep their own rules are trimmed too", () => {
  const recipient = { name: "Amina Bello", categories: ["fuqara"], eligibilityReason: "Widowed, no income, three children at home." };

  test("a zakah recipient's name of spaces is refused; a phone is stored in international form", async () => {
    expect(await errorsFor(CreateZakahRecipientInput, { ...recipient, name: "   " })).toEqual(["Name is required."]);
    const ok = (await run(CreateZakahRecipientInput, { ...recipient, name: "  Amina Bello ", phone: "0803 123 4567" })) as CreateZakahRecipientInput;
    expect(ok).toMatchObject({ name: "Amina Bello", phone: "+2348031234567" });
    expect(await errorsFor(CreateZakahRecipientInput, { ...recipient, phone: "call me" })).toEqual([expect.stringMatching(/^Phone /)]);
  });

  test("a reason padded with spaces still has to be a sentence", async () => {
    const errors = await errorsFor(CreateZakahRecipientInput, { ...recipient, eligibilityReason: "   poor     " });
    expect(errors).toEqual([expect.stringMatching(/why this person qualifies/)]);
  });
});

describe("names need letters and ID numbers need digits, wherever they're asked for", () => {
  test("a giver's identity: '1234' isn't a name and 'adewale' isn't an ID number", async () => {
    expect(await errorsFor(ZakahPayerIdentityInput, { fullName: "1234", idType: "national_id", idNumber: "adewale" })).toEqual([
      "Full name must contain letters.",
      "Id number should include digits, like RC 1909785.",
    ]);
    const ok = (await run(ZakahPayerIdentityInput, { fullName: " Amina Bello ", idType: "national_id", idNumber: " 12345678901 " })) as ZakahPayerIdentityInput;
    expect(ok).toMatchObject({ fullName: "Amina Bello", idNumber: "12345678901" });
  });

  test("a zakah recipient's bank and account names need letters", async () => {
    const recipient = { name: "Amina Bello", categories: ["fuqara"], eligibilityReason: "Widowed, no income, three children at home." };
    const errors = await errorsFor(CreateZakahRecipientInput, { ...recipient, bankName: "058", accountName: "0123456789" });
    expect(errors).toEqual(["Bank name must contain letters.", "Account name must contain letters."]);
  });
});
