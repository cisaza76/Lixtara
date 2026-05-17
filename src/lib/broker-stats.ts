// SOURCE: yearsExperience and mlsCoverage are factual claims about the licensed
// brokerage (Nexxos Realty est. 20 yrs, MLS coverage is a product feature).
// salesVolume requires sign-off from the broker before publication — keep null
// until verified.
export const BROKER_STATS: {
  salesVolume: string | null;
  yearsExperience: number | null;
  mlsCoverage: string;
} = {
  salesVolume: null,
  yearsExperience: 20,
  mlsCoverage: "100%",
};
