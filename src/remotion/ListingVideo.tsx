// Brand-first `ListingVideo` composition — ONE composition, two Source Strategies
// (F2/F3 milestone). A pure function of `inputProps`: no Sandbox, Asset Manager, or
// Creative Job imports here. The shared Lixtara frame (opening card → body → closing card,
// lower-third, gold hairline, reserved badge, system fonts) is authored ONCE; only the
// BODY changes with the Source Strategy:
//   - photo_slideshow → the Ken-Burns photo gallery (unchanged, byte-identical output);
//   - uploaded_video  → an already-normalized 1920×1080 prepared clip played via
//                       @remotion/media <Video> (no layout resolved here — F2-D baked it).
// Adding a source is a new body behind the same frame, never a new composition.
//
// Visual language mirrors the Lixtara landing (see brand_identity memory): ivory ground,
// Playfair Display serif for display type (italic for the wordmark), Inter for secondary
// text, a single restrained gold accent, sharp corners, hairline gold-soft dividers.
// Motion stays discreet — slow Ken-Burns drift + soft crossfades — echoed by a single
// signature motif: a thin gold rule that draws in under the address on open and under the
// CTA on close.
import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { SANS, SERIF } from "./fonts";
import {
  DEFAULT_CLOSING_SECONDS,
  DEFAULT_OPENING_SECONDS,
  DEFAULT_PHOTO_SECONDS,
  CROSSFADE_FRAMES,
  SAFE_AREA,
} from "./layout";
import { orderedPhotos, perPhotoDurationFrames, photoSectionFrames, type ListingVideoInput } from "./input";
import { resolvePhotoSrc, resolveStagedSrc } from "./resolve";
import { compositionSourceOf, type CompositionInput, type PhotoSlideshowInput, type UploadedVideoInput } from "./composition-input";

const IVORY = "#FDFCF8";
const IVORY_SCRIM = "rgba(253, 252, 248, 0.92)";
const INK = "#0F172A";
const GOLD = "#B49157";
const GOLD_SOFT = "rgba(180, 145, 87, 0.28)";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// A short gold rule that draws in (width 0 -> full) — the composition's one signature
// flourish, used at both bookends (open + close) and nowhere else.
const Hairline: React.FC<{ width: number; startFrame?: number; durationInFrames?: number }> = ({
  width,
  startFrame = 0,
  durationInFrames = 24,
}) => {
  const frame = useCurrentFrame();
  const drawn = interpolate(frame, [startFrame, startFrame + durationInFrames], [0, width], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  return <div style={{ width: drawn, height: 1, backgroundColor: GOLD }} />;
};

const OpeningCard: React.FC<{ property: ListingVideoInput["property"] }> = ({ property }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const rise = interpolate(frame, [0, 24], [10, 0], { extrapolateRight: "clamp", easing: EASE });

  return (
    <AbsoluteFill style={{ backgroundColor: IVORY, justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, transform: `translateY(${rise}px)`, textAlign: "center", maxWidth: 1400 }}>
        {property.name ? (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: GOLD,
              marginBottom: 24,
            }}
          >
            {property.name}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: 64,
            lineHeight: 1.15,
            color: INK,
            letterSpacing: "-0.01em",
          }}
        >
          {property.addressLine}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
          <Hairline width={96} startFrame={16} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const KenBurnsPhoto: React.FC<{ src: string; index: number; durationInFrames: number; isLast: boolean }> = ({
  src,
  index,
  durationInFrames,
  isLast,
}) => {
  const frame = useCurrentFrame();
  // Alternate drift direction per slide so a multi-photo gallery doesn't feel
  // mechanically repetitive, while staying well inside "slow and discreet".
  const zoomIn = index % 2 === 0;
  const scale = interpolate(frame, [0, durationInFrames], zoomIn ? [1, 1.045] : [1.045, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Fade IN only. Because consecutive photo Sequences OVERLAP by CROSSFADE_FRAMES (see the
  // gallery below) and the outgoing photo stays fully opaque underneath until the incoming one
  // covers it, the screen is never uncovered — no ivory flash between photos. Only the LAST
  // photo fades OUT, dissolving into the ivory closing card.
  const fadeIn = interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
  const fadeOut = isLast
    ? interpolate(frame, [durationInFrames - CROSSFADE_FRAMES, durationInFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: EASE,
      })
    : 1;

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut, backgroundColor: INK }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const LowerThird: React.FC<{ priceLabel: string; roomLabel?: string; durationInFrames: number }> = ({
  priceLabel,
  roomLabel,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [10, 26, durationInFrames - CROSSFADE_FRAMES - 10, durationInFrames - CROSSFADE_FRAMES],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE },
  );

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start" }}>
      <div
        style={{
          opacity,
          margin: "0 0 64px 64px",
          padding: "20px 28px",
          backgroundColor: IVORY_SCRIM,
        }}
      >
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 34, color: INK }}>{priceLabel}</div>
        {roomLabel ? (
          <>
            <div style={{ width: 40, height: 1, backgroundColor: GOLD_SOFT, margin: "10px 0" }} />
            <div
              style={{
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: GOLD,
              }}
            >
              {roomLabel}
            </div>
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// The badge-reserved rect. Kept clear by every other layer (photo/video, lower third,
// opening/closing cards never place content here); renders content only when `badge` is
// present so a null badge is a no-op.
const SafeAreaBadge: React.FC<{ badge: ListingVideoInput["badge"] }> = ({ badge }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp", easing: EASE });

  if (!badge) return null;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: SAFE_AREA.top,
          right: SAFE_AREA.right,
          width: SAFE_AREA.width,
          height: SAFE_AREA.height,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            opacity,
            padding: "10px 20px",
            backgroundColor: INK,
            border: `1px solid ${GOLD}`,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: IVORY,
            }}
          >
            {badge.text}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ClosingCard: React.FC<{ brand: ListingVideoInput["brand"]; cta: ListingVideoInput["cta"] }> = ({
  brand,
  cta,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp", easing: EASE });
  const rise = interpolate(frame, [0, 24], [10, 0], { extrapolateRight: "clamp", easing: EASE });

  return (
    <AbsoluteFill style={{ backgroundColor: IVORY, justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, transform: `translateY(${rise}px)`, textAlign: "center" }}>
        <div
          style={{
            padding: "22px 56px",
            backgroundColor: INK,
          }}
        >
          <div
            style={{
              fontFamily: SANS,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: IVORY,
            }}
          >
            {cta.text}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
          <Hairline width={64} startFrame={16} />
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 40,
            color: GOLD,
            marginTop: 24,
          }}
        >
          {brand.name}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Body: photo_slideshow — the original gallery, UNCHANGED (byte-identical output). Extracted
// verbatim from the pre-F3-A `ListingVideo` so the photo path never regresses.
// ---------------------------------------------------------------------------
const PhotoSlideshowBody: React.FC<PhotoSlideshowInput> = ({ property, priceLabel, photos, brand, cta, badge }) => {
  const { fps } = useVideoConfig();
  const photoList = orderedPhotos(photos);
  const openingFrames = Math.round(fps * DEFAULT_OPENING_SECONDS);
  const photoFrames = perPhotoDurationFrames(photoList.length, fps, DEFAULT_PHOTO_SECONDS);
  const closingFrames = Math.round(fps * DEFAULT_CLOSING_SECONDS);
  // Consecutive photos overlap by CROSSFADE_FRAMES so each dissolves in over the previous
  // (no ivory flash). `photoStep` is the per-photo advance; the gallery's on-screen span
  // accounts for the (count-1) overlaps.
  const photoStep = photoFrames - CROSSFADE_FRAMES;
  const galleryFrames = photoSectionFrames(photoList.length, photoFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: IVORY }}>
      <Sequence from={0} durationInFrames={openingFrames}>
        <OpeningCard property={property} />
      </Sequence>

      {photoList.map((photo, index) => (
        <Sequence key={photo.url + index} from={openingFrames + index * photoStep} durationInFrames={photoFrames}>
          <KenBurnsPhoto
            src={resolvePhotoSrc(photo.url)}
            index={index}
            durationInFrames={photoFrames}
            isLast={index === photoList.length - 1}
          />
          <LowerThird priceLabel={priceLabel} roomLabel={photo.roomLabel} durationInFrames={photoFrames} />
        </Sequence>
      ))}

      <Sequence from={openingFrames} durationInFrames={galleryFrames}>
        <SafeAreaBadge badge={badge ?? null} />
      </Sequence>

      <Sequence from={openingFrames + galleryFrames} durationInFrames={closingFrames}>
        <ClosingCard brand={brand} cta={cta} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Body: uploaded_video — the already-normalized 1920×1080 prepared clip, framed by the
// SAME opening/closing cards + lower third + reserved badge. NO layout is resolved here:
// the prepared file is exactly the composition frame (F2-D Strategy C baked aspect /
// blurred-fill / rotation upstream), so <Video> fills 1:1. Fallback to <OffthreadVideo> is
// disallowed (the engine decision — @remotion/media on the current glibc-2.34 runtime).
// ---------------------------------------------------------------------------
const UploadedVideoBody: React.FC<UploadedVideoInput> = ({ property, priceLabel, videoSrc, durationSeconds, brand, cta, badge }) => {
  const { fps } = useVideoConfig();
  const openingFrames = Math.round(fps * DEFAULT_OPENING_SECONDS);
  const closingFrames = Math.round(fps * DEFAULT_CLOSING_SECONDS);
  const bodyFrames = Math.round(fps * durationSeconds);

  return (
    <AbsoluteFill style={{ backgroundColor: IVORY }}>
      <Sequence from={0} durationInFrames={openingFrames}>
        <OpeningCard property={property} />
      </Sequence>

      <Sequence from={openingFrames} durationInFrames={bodyFrames}>
        <AbsoluteFill style={{ backgroundColor: INK }}>
          <Video src={resolveStagedSrc(videoSrc)} disallowFallbackToOffthreadVideo style={{ width: "100%", height: "100%" }} />
        </AbsoluteFill>
        <LowerThird priceLabel={priceLabel} durationInFrames={bodyFrames} />
        <SafeAreaBadge badge={badge ?? null} />
      </Sequence>

      <Sequence from={openingFrames + bodyFrames} durationInFrames={closingFrames}>
        <ClosingCard brand={brand} cta={cta} />
      </Sequence>
    </AbsoluteFill>
  );
};

// ONE composition, dispatched by Source Strategy. Render Profile (dimensions/fps/codec) is
// unchanged and owned by the Composition registration (Root.tsx) — never branched here.
export const ListingVideo: React.FC<CompositionInput> = (input) => {
  if (compositionSourceOf(input) === "uploaded_video") {
    return <UploadedVideoBody {...(input as UploadedVideoInput)} />;
  }
  return <PhotoSlideshowBody {...(input as PhotoSlideshowInput)} />;
};
