import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { ListingVideo } from "./ListingVideo";
import { totalDurationFrames } from "./input";
import { compositionInputSchema, compositionSourceOf, type CompositionInput } from "./composition-input";
import { DEFAULT_CLOSING_SECONDS, DEFAULT_OPENING_SECONDS, FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./layout";

// Default props keep the pre-F3-A photo slideshow (no `source` → photo_slideshow arm), so
// Studio + `selectComposition` defaults are byte-identical for the photo path.
const defaultProps: CompositionInput = {
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

// Duration is a pure function of the actual inputProps, branching on the Source Strategy —
// the ONE composition-owned difference between a slideshow and a prepared-video render:
//   - photo_slideshow → totalDurationFrames(photoCount)  (unchanged);
//   - uploaded_video  → opening + body(durationSeconds) + closing.
// The Render Profile (dimensions/fps) is identical either way.
const calculateMetadata: CalculateMetadataFunction<CompositionInput> = ({ props }) => {
  if (compositionSourceOf(props) === "uploaded_video" && "durationSeconds" in props) {
    const openingFrames = Math.round(FPS * DEFAULT_OPENING_SECONDS);
    const closingFrames = Math.round(FPS * DEFAULT_CLOSING_SECONDS);
    const bodyFrames = Math.round(FPS * props.durationSeconds);
    return { durationInFrames: openingFrames + bodyFrames + closingFrames };
  }
  const photos = "photos" in props ? props.photos : [];
  return { durationInFrames: totalDurationFrames(photos.length, FPS) };
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ListingVideo"
      component={ListingVideo}
      durationInFrames={totalDurationFrames(defaultProps && "photos" in defaultProps ? defaultProps.photos.length : 3, FPS)}
      fps={FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      schema={compositionInputSchema}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
