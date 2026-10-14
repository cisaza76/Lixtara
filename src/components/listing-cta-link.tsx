"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { isPlanTier, track, type ListingCtaLocation } from "@/lib/analytics";

/**
 * Link into the seller registration (/listing/new) that reports `listing_cta_click`
 * (with the plan when it comes from a plan card). Without analytics consent it is a plain link.
 */
export function ListingCtaLink({
  location,
  tier,
  lang,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { location: ListingCtaLocation; tier?: string; lang: string }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track({ event: "listing_cta_click", location, ...(isPlanTier(tier) ? { tier } : {}), lang });
        onClick?.(e);
      }}
    />
  );
}
