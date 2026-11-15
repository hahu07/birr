import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";

/** One Paystack payment into Birr, as Paystack lists it. Amounts in kobo. */
export interface PaystackTransactionRecord {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
}

/** One Paystack transfer out of Birr's balance. */
export interface PaystackTransferRecord {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
}

/** One Paystack refund of an earlier payment. */
export interface PaystackRefundRecord {
  /** The refunded payment's reference, when Paystack gives it. */
  transactionReference: string | null;
  /** The refunded payment's Paystack id. */
  transactionId: number | null;
  status: string;
  amount: number;
  currency: string;
  createdAt: Date;
}

interface PaystackList<T> {
  status: boolean;
  message?: string;
  data?: T[];
  meta?: { pageCount?: number; page?: number };
}

const PER_PAGE = 100;
/** A safety stop: 50 pages of 100 is far beyond a day of Birr's traffic. */
const MAX_PAGES = 50;

/**
 * Reads Paystack's own lists for reconciliation (PaymentReconciliationService):
 * transactions (money in), transfers (money out) and refunds, for a time
 * window. Read-only: it never creates, changes or retries anything.
 */
@Injectable()
export class PaystackReportsClient {
  private readonly baseUrl = "https://api.paystack.co";

  constructor(private readonly settings: SettingsService) {}

  private async list<T>(path: string, from: Date, to: Date): Promise<T[]> {
    const secretKey = await this.settings.get("paystack", "SECRET_KEY");
    if (!secretKey) throw new ServiceUnavailableException("Paystack isn't configured, so its records can't be read.");
    const rows: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const query = new URLSearchParams({ perPage: String(PER_PAGE), page: String(page), from: from.toISOString(), to: to.toISOString() });
      const res = await fetch(`${this.baseUrl}/${path}?${query}`, { headers: { Authorization: `Bearer ${secretKey}` } });
      const body = (await res.json()) as PaystackList<T>;
      if (!res.ok || !body.status) throw new Error(`Paystack ${path} list failed: ${body.message ?? res.statusText}`);
      rows.push(...(body.data ?? []));
      const pageCount = body.meta?.pageCount ?? 1;
      if (page >= pageCount || (body.data ?? []).length < PER_PAGE) return rows;
    }
    throw new Error(`Paystack ${path} list has more than ${MAX_PAGES * PER_PAGE} records in one window; narrow it.`);
  }

  async transactions(from: Date, to: Date): Promise<PaystackTransactionRecord[]> {
    const rows = await this.list<{ id: number; reference: string; status: string; amount: number; currency: string; created_at?: string; createdAt?: string }>(
      "transaction",
      from,
      to,
    );
    return rows.map((t) => ({
      id: t.id,
      reference: t.reference,
      status: t.status,
      amount: t.amount,
      currency: t.currency.toUpperCase(),
      createdAt: new Date(t.created_at ?? t.createdAt ?? 0),
    }));
  }

  async transfers(from: Date, to: Date): Promise<PaystackTransferRecord[]> {
    const rows = await this.list<{ reference: string; status: string; amount: number; currency: string; createdAt?: string; created_at?: string }>(
      "transfer",
      from,
      to,
    );
    return rows.map((t) => ({
      reference: t.reference,
      status: t.status,
      amount: t.amount,
      currency: t.currency.toUpperCase(),
      createdAt: new Date(t.createdAt ?? t.created_at ?? 0),
    }));
  }

  async refunds(from: Date, to: Date): Promise<PaystackRefundRecord[]> {
    const rows = await this.list<{
      transaction?: number | { id?: number; reference?: string };
      transaction_reference?: string;
      status: string;
      amount: number;
      currency: string;
      createdAt?: string;
      created_at?: string;
    }>("refund", from, to);
    return rows.map((r) => {
      const tx = typeof r.transaction === "object" && r.transaction !== null ? r.transaction : null;
      return {
        transactionReference: r.transaction_reference ?? tx?.reference ?? null,
        transactionId: typeof r.transaction === "number" ? r.transaction : (tx?.id ?? null),
        status: r.status,
        amount: r.amount,
        currency: r.currency.toUpperCase(),
        createdAt: new Date(r.createdAt ?? r.created_at ?? 0),
      };
    });
  }
}
