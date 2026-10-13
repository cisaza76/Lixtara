"use client";

// "Mark all" for a group of plain (uncontrolled) checkboxes rendered by a
// server component. It finds the sibling checkboxes named `name` inside the
// same <fieldset>, toggles them together, and shows the mixed state when only
// some are checked. The form still submits the individual checkboxes.

import { useEffect, useRef, useState } from "react";

export function CheckAllToggle({ name, label }: { name: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const scope = ref.current?.closest("fieldset");
    if (!scope) return;
    const boxes = () =>
      Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`));
    const sync = () => {
      const all = boxes();
      const on = all.filter((b) => b.checked).length;
      setChecked(all.length > 0 && on === all.length);
      if (ref.current) ref.current.indeterminate = on > 0 && on < all.length;
    };
    sync();
    scope.addEventListener("change", sync);
    return () => scope.removeEventListener("change", sync);
  }, [name]);

  function toggle(next: boolean) {
    const scope = ref.current?.closest("fieldset");
    scope
      ?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)
      .forEach((b) => {
        b.checked = next;
      });
    setChecked(next);
    if (ref.current) ref.current.indeterminate = false;
  }

  return (
    <label className="flex items-center gap-3 text-sm font-medium text-ink cursor-pointer border-b border-gold-soft pb-2.5">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => toggle(e.target.checked)}
        className="accent-gold w-4 h-4"
      />
      <span>{label}</span>
    </label>
  );
}
