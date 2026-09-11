export interface VaultReceiptEmailAdapter {
  sendReceipt(input: {
    to: string;
    vaultName: string;
    causeName?: string;
    amount: string;
    currency: string;
    contributionId: string;
  }): Promise<void>;
}
