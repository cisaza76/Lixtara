import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { ListingVideo } from "./ListingVideo";
import { listingVideoInputSchema, totalDurationFrames, type ListingVideoInput } from "./input";
import { FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./layout";

const defaultProps: ListingVideoInput = {
  property: { addressLine: "482 Coral Way, Coral Gables, FL" },
  priceLabel: "$725,000",
  photos: [
    { url: "https://placehold.co/1920x1080", roomLabel: "Living Room" },
    { url: "https://placehold.co/1920x1080", roomLabel: "Kitchen" },
    { url: "https://placehold.co/1920x1080", roomLabel: "Primary Suite" },
  ],
  brand: { name: "Lixtara" },
  cta: { text: "See more at lixtara.com" },
  badge: null,
};

// Duration is a pure function of the actual photo count in `inputProps`, not
// just the (3-photo) `defaultProps` — without this, a real render with a
// different photo count would be truncated or padded relative to the
// composition's own per-sequence timing (see `input.ts#totalDurationFrames`).
const calculateMetadata: CalculateMetadataFunction<ListingVideoInput> = ({ props }) => {
  return {
    durationInFrames: totalDurationFrames(props.photos.length, FPS),
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ListingVideo"
      component={ListingVideo}
      durationInFrames={totalDurationFrames(defaultProps.photos.length, FPS)}
      fps={FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      schema={listingVideoInputSchema}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
