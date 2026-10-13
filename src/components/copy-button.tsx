"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

/** Copies `text` to the clipboard and confirms for two seconds. */
export function CopyButton({ text, label = "Copy", copiedLabel = "Copied", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context or permission): the value stays visible to copy by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "shrink-0 px-2.5 py-1 border border-gold-soft text-[9px] uppercase tracking-[0.18em] text-ink/70 hover:border-gold hover:text-ink transition-colors print:hidden"
      }
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
