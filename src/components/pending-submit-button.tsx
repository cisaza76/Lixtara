"use client";

import { type ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Same look as SubmitButton (auth-shell.tsx), but disabled while the form's server action runs:
// a second click, or Enter (implicit submission does nothing with a disabled default button),
// can't send the form again. Step 1 of /listing/new creates the listing, so a second send
// used to create a second draft.
export function PendingSubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="inline-flex items-center justify-center px-10 py-4 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors mt-2 disabled:opacity-60 disabled:cursor-wait"
    >
      {children}
    </button>
  );
}
