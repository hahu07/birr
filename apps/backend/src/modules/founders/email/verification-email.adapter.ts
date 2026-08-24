export interface VerificationEmailAdapter {
  sendVerificationEmail(to: string, link: string): Promise<void>;
}
