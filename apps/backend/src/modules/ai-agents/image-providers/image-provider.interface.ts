// Deliberately simpler than contributions' PaymentProviderAdapter
// (apps/backend/src/modules/contributions/providers/payment-provider.interface.ts)
// — no webhook half. Image generation is a single request/response per
// call from the caller's point of view, even where the vendor's own API
// is polling-based underneath (see ReplicateImageAdapter).
export interface ImageProviderAdapter {
  readonly provider: string;
  /** Resolves with the raw image bytes, or throws if the credential is missing/invalid or the vendor call fails. */
  generate(prompt: string): Promise<Buffer>;
}
