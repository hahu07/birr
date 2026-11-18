// What each waqf programme product's public pages say (need-based NB3,
// 2026-11-18): the list page, the giving page, and the thank-you page
// after checkout. Labels and addresses come from WAQF_PROGRAMME_PRODUCTS
// in @birr/shared; this file holds the sentences. The clinic's are the
// wording its pages already used.
//
// The need-based waqf launches giving first: its pages say plainly that
// support starts once the licensed financing partner and the kifayah line
// are in place, and state no figure about support.
import { WAQF_PROGRAMME_PRODUCTS, type WaqfProgrammeProductKey } from "@birr/shared";

export interface ProgrammeCopy {
  /** The list page. */
  list: { eyebrow: string; title: string; intro: string; empty: string; loadError: string };
  /** Under a programme's name on its giving page. */
  subtitle: (city: string) => string;
  /** Said plainly on the giving page, where support hasn't started yet. */
  notice?: string;
  /** The two ways to give. */
  pots: { endowment: { title: string; body: string }; running: { title: string; body: string } };
  notTakingGifts: string;
  /** "Either way your whole gift reaches ___". */
  giftReaches: string;
  /** The thank-you page, after "₦10,000 to <name>". */
  thanks: { endowment: string; running: string };
}

const COPY: Record<WaqfProgrammeProductKey, ProgrammeCopy> = {
  clinic: {
    list: {
      eyebrow: "Clinics",
      title: "Care for women and young children, held in waqf.",
      intro:
        "Each clinic is a laboratory and clinic held in its own waqf, with Birr as trustee and a licensed operator running it. Endow it, and your gift is kept for ever; or give to its running costs. Founders and anyone else can give.",
      empty: "No clinic is open yet. Please check back soon.",
      loadError: "Couldn't load the clinics",
    },
    subtitle: (city) => `A laboratory and clinic for women and young children in ${city}, held in a waqf with Birr as trustee.`,
    pots: {
      endowment: {
        title: "Endow it",
        body: "Your gift is kept for ever: it's never spent, and its income pays for care. You give it as a waqf, under the deed below.",
      },
      running: {
        title: "Give to the running fund",
        body: "Your gift is spent on subsidised visits for women and children who can't afford them, and the clinic's running costs.",
      },
    },
    notTakingGifts: "This clinic isn't taking gifts yet. Please check back soon.",
    giftReaches: "the clinic",
    thanks: {
      endowment: ", endowed for ever: it's never spent, and its income pays for care.",
      running: ", for subsidised visits and the clinic's running costs.",
    },
  },
  need_based: {
    list: {
      eyebrow: WAQF_PROGRAMME_PRODUCTS.need_based.label,
      title: "Help poor households earn a living, or live with dignity.",
      intro:
        "Each waqf helps households in its city whose means fall below the cost of basic needs: tools and stock on easy terms for those who can work, and allowances and bills for those who can't. Birr is its trustee. Endow it, and your gift is kept for ever; or give to its spending fund. Support starts once its licensed financing partner and kifayah line are in place.",
      empty: "No waqf is open yet. Please check back soon.",
      loadError: "Couldn't load the waqfs",
    },
    subtitle: (city) => `A waqf for poor households in ${city}, held with Birr as trustee.`,
    notice:
      "Support starts once this waqf's licensed financing partner and its kifayah line (the cost of basic needs in the city) are in place. Until then, gifts to the spending fund are held for that support, and the endowment is kept for ever.",
    pots: {
      endowment: {
        title: "Endow it",
        body: "Your gift is kept for ever: it's never spent, and its income supports poor households. You give it as a waqf, under the deed below.",
      },
      running: {
        title: "Give to the spending fund",
        body: "Your gift is spent on support for poor households: monthly allowances, essential bills, and tools for people who can work.",
      },
    },
    notTakingGifts: "This waqf isn't taking gifts yet. Please check back soon.",
    giftReaches: "the waqf",
    thanks: {
      endowment: ", endowed for ever: it's never spent, and its income supports poor households.",
      running: ", for allowances, bills and tools for poor households, once support starts.",
    },
  },
};

export function programmeCopy(product: WaqfProgrammeProductKey): ProgrammeCopy {
  return COPY[product];
}

/** A programme's public page: e.g. /clinics/bodija or /need-based-waqf/kano. */
export function programmePath(product: WaqfProgrammeProductKey, slug: string): string {
  return `${WAQF_PROGRAMME_PRODUCTS[product].publicPath}/${slug}`;
}
