// Step 1: picking a Google suggestion with ↓ + Enter must only pick it. Google's own keydown
// listener on the street input runs before React's (React listens at the root), and it hides
// the suggestion list, so a check in React's onKeyDown no longer sees it open and the Enter
// goes on to submit the form: native validation flashed "Enter the ZIP code" before
// place_changed filled it. This guard runs in the window's capture phase, before Google, and
// holds every submit until place_changed has been processed (or SETTLE_MS have passed).

/** Longest wait for place_changed after a pick; then the form behaves normally again. */
export const SETTLE_MS = 1500;

type KeyEventLike = { key: string; target: unknown; preventDefault(): void };
type SubmitEventLike = { preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void };
type ClickEventLike = SubmitEventLike & { target: unknown };

export function createSuggestionGuard({
  input,
  menuOpen,
  isSubmitter,
  isSuggestion,
  now = () => Date.now(),
}: {
  /** The street input Google is attached to. */
  input: unknown;
  /** Whether Google's suggestion list is showing. */
  menuOpen: () => boolean;
  /** Whether a click target is the form's submit button. */
  isSubmitter: (target: unknown) => boolean;
  /** Whether a pointer target is one of Google's suggestions. */
  isSuggestion: (target: unknown) => boolean;
  now?: () => number;
}) {
  let pendingUntil = 0;
  const pending = () => now() < pendingUntil;
  const hold = () => {
    pendingUntil = now() + SETTLE_MS;
  };
  const block = (e: SubmitEventLike) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  };

  return {
    pending,
    /** window keydown, capture phase. Never stops propagation: Google still picks the address. */
    onKeyDown(e: KeyEventLike) {
      if (e.key !== "Enter" || e.target !== input) return;
      if (pending()) {
        e.preventDefault();
      } else if (menuOpen()) {
        hold();
        e.preventDefault();
      }
    },
    /** document mousedown, capture phase: a click on a suggestion is a pick too. */
    onPointerDown(e: { target: unknown }) {
      if (isSuggestion(e.target)) hold();
    },
    /** document click, capture phase: the button would run native validation before submit. */
    onClick(e: ClickEventLike) {
      if (pending() && isSubmitter(e.target)) block(e);
    },
    /** form submit, capture phase. */
    onSubmit(e: SubmitEventLike) {
      if (pending()) block(e);
    },
    /** Call at the end of the place_changed handler, once the fields are filled. */
    placeChanged() {
      pendingUntil = 0;
    },
  };
}
