// SOURCE: yearsExperience and mlsCoverage are factual claims about the
// brokerage. NOTE: the 20-yr figure was inherited from the prior broker entity —
// confirm it still applies to Lixtara before relying on it. salesVolume requires
// sign-off from the broker before publication — keep null until verified.
export const BROKER_STATS: {
  salesVolume: string | null;
  yearsExperience: number | null;
  mlsCoverage: string;
} = {
  salesVolume: null,
  yearsExperience: 20,
  mlsCoverage: "100%",
};
