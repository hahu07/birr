export interface WhatsAppOtpAdapter {
  sendOtp(to: string, code: string): Promise<void>;
}
