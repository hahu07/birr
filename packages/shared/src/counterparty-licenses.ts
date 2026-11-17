/**
 * The licences a counterparty must hold before Birr pays it (2026-11-17,
 * clinic slice 1), shared so the API's check and the Ops Console's list say
 * the same thing. Only healthcare providers have required licences; every
 * other type is paid on its existing checks alone.
 */
export const COUNTERPARTY_LICENSE_KINDS = [
  "health_facility_registration",
  "medical_laboratory_registration",
  "professional_indemnity_insurance",
  "data_protection_registration",
  "other",
] as const;

export type CounterpartyLicenseKindKey = (typeof COUNTERPARTY_LICENSE_KINDS)[number];

export const COUNTERPARTY_LICENSE_KIND_LABELS: Record<CounterpartyLicenseKindKey, string> = {
  health_facility_registration: "Health facility registration (state Ministry of Health)",
  medical_laboratory_registration: "Medical laboratory registration (MLSCN)",
  professional_indemnity_insurance: "Malpractice (professional indemnity) insurance",
  data_protection_registration: "Data protection registration (NDPC)",
  other: "Other licence",
};

export const REQUIRED_COUNTERPARTY_LICENSES: Partial<Record<string, readonly CounterpartyLicenseKindKey[]>> = {
  healthcare_provider: [
    "health_facility_registration",
    "medical_laboratory_registration",
    "professional_indemnity_insurance",
    "data_protection_registration",
  ],
};

/** Days before expiry when Compliance is warned; 0 is the notice once it has lapsed. */
export const LICENSE_EXPIRY_NOTICE_DAYS = [60, 30, 7, 0] as const;
