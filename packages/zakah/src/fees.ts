import { Decimal, format, parsePositive } from "./internal";
import type { NairaAmount } from "./types";

// Paystack's published fee for local Nigerian payments: 1.5% plus ₦100,
// with the ₦100 waived under ₦2,500, capped at ₦2,000 per transaction.
// Confirm against Birr's own Paystack pricing before launch — a
// negotiated rate, or an international card (charged more), makes this
// an estimate, and Birr covers any shortfall from its operating funds.
const RATE = new Decimal("0.015");
const FLAT = new Decimal(100);
const FLAT_WAIVED_BELOW = new Decimal(2500);
const CAP = new Decimal(2000);

function paystackFee(total: Decimal): Decimal {
  const fee = total.times(RATE).plus(total.lessThan(FLAT_WAIVED_BELOW) ? 0 : FLAT);
  return Decimal.min(fee, CAP);
}

/**
 * What to add on top of a zakah payment so the processing fee is
 * covered too, when the payer chooses to: the smallest amount c such
 * that Paystack's fee on (zakah + c) is no more than c. The zakah itself
 * then reaches recipients in full, and the fee is paid by the addition
 * rather than by Birr. Rounded up to the kobo.
 */
export function processingFeeCover(zakahAmount: NairaAmount): NairaAmount {
  const amount = parsePositive("amount", zakahAmount);
  // Settles in two or three rounds; the fee moves by at most 1.5% of the
  // previous step's change each time.
  let cover = paystackFee(amount);
  for (let i = 0; i < 10; i++) {
    const next = paystackFee(amount.plus(cover)).toDecimalPlaces(2, Decimal.ROUND_UP);
    if (next.lessThanOrEqualTo(cover)) break;
    cover = next;
  }
  return format(cover.toDecimalPlaces(2, Decimal.ROUND_UP));
}
