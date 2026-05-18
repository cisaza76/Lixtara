// Rentcast comparable sales lookup for the listing form Step 3.
// Calls /v1/avm/value which returns:
//   - subject AVM estimate (price + priceRangeLow + priceRangeHigh)
//   - up to ~15 comparables (mix of active listings + sold)
// We filter to the top 3 sold (status=Inactive with removedDate ≤ 90d) within
// 1 mile. If <3 sold, top off with closest active listings.

const RENTCAST_BASE = "https://api.rentcast.io/v1";

export interface RentcastComp {
  formattedAddress: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  yearBuilt: number;
  price: number;
  status: "Active" | "Inactive" | string;
  listedDate: string | null;
  removedDate: string | null;
  lastSeenDate: string | null;
  daysOnMarket: number | null;
  distance: number;
  pricePerSqft: number;
  isSold: boolean;
}

export interface RentcastEstimate {
  price: number;
  priceLow: number;
  priceHigh: number;
  comps: RentcastComp[];
}

interface RentcastRawComp {
  formattedAddress: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  yearBuilt: number;
  price: number;
  status: string;
  listedDate: string | null;
  removedDate: string | null;
  lastSeenDate: string | null;
  daysOnMarket: number | null;
  distance: number;
}

function ninetyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d;
}

export async function fetchRentcastEstimate(
  street: string,
  city: string,
  state: string,
  zip: string,
): Promise<RentcastEstimate | null> {
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    console.error("RENTCAST_API_KEY missing");
    return null;
  }
  const fullAddress = `${street}, ${city}, ${state} ${zip}`;
  const url =
    `${RENTCAST_BASE}/avm/value?address=${encodeURIComponent(fullAddress)}` +
    `&compCount=10&maxRadius=1`;
  try {
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("Rentcast failed", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      price?: number;
      priceRangeLow?: number;
      priceRangeHigh?: number;
      comparables?: RentcastRawComp[];
    };
    if (!data.price || !data.comparables) return null;

    const cutoff = ninetyDaysAgo();
    const enriched: RentcastComp[] = data.comparables
      .map((c) => {
        const removedAt = c.removedDate ? new Date(c.removedDate) : null;
        const isSold = c.status === "Inactive" && !!removedAt;
        return {
          formattedAddress: c.formattedAddress,
          bedrooms: c.bedrooms,
          bathrooms: c.bathrooms,
          squareFootage: c.squareFootage,
          yearBuilt: c.yearBuilt,
          price: c.price,
          status: c.status,
          listedDate: c.listedDate,
          removedDate: c.removedDate,
          lastSeenDate: c.lastSeenDate,
          daysOnMarket: c.daysOnMarket,
          distance: c.distance ?? 0,
          pricePerSqft:
            c.squareFootage > 0 ? Math.round(c.price / c.squareFootage) : 0,
          isSold,
        };
      })
      .filter((c) => c.distance <= 1);

    // Prefer sold-in-last-90-days. Top off with active listings if <3 sold.
    const soldRecent = enriched.filter(
      (c) =>
        c.isSold && c.removedDate && new Date(c.removedDate) >= cutoff,
    );
    const sortedSold = soldRecent
      .slice()
      .sort((a, b) => a.distance - b.distance);
    const sortedActive = enriched
      .filter((c) => c.status === "Active")
      .sort((a, b) => a.distance - b.distance);

    const top: RentcastComp[] = [];
    for (const c of sortedSold) {
      if (top.length >= 3) break;
      top.push(c);
    }
    for (const c of sortedActive) {
      if (top.length >= 3) break;
      top.push(c);
    }

    return {
      price: data.price,
      priceLow: data.priceRangeLow ?? data.price,
      priceHigh: data.priceRangeHigh ?? data.price,
      comps: top,
    };
  } catch (e) {
    console.error("Rentcast call threw", e);
    return null;
  }
}
