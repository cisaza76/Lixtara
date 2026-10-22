import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SETTLE_MS, createSuggestionGuard } from "@/lib/address-suggestion-guard";

const INPUT = { name: "street" };
const OTHER = { name: "email" };
const BUTTON = { name: "next" };
const SUGGESTION = { name: "pac-item" };

function setup() {
  let t = 1_000;
  let open = false;
  const guard = createSuggestionGuard({
    input: INPUT,
    menuOpen: () => open,
    isSubmitter: (x) => x === BUTTON,
    isSuggestion: (x) => x === SUGGESTION,
    now: () => t,
  });
  return {
    guard,
    setOpen: (v: boolean) => (open = v),
    advance: (ms: number) => (t += ms),
  };
}

function key(target: unknown, k = "Enter") {
  const e = { key: k, target, prevented: false, preventDefault: () => (e.prevented = true) };
  return e;
}

function ev(target?: unknown) {
  const e = {
    target,
    prevented: false,
    stopped: false,
    preventDefault: () => (e.prevented = true),
    stopPropagation: () => (e.stopped = true),
    stopImmediatePropagation: () => (e.stopped = true),
  };
  return e;
}

describe("paso 1: Enter sobre una sugerencia de Google solo la elige", () => {
  it("Enter con el menú abierto → sin submit ni validación hasta place_changed", () => {
    const { guard, setOpen } = setup();
    setOpen(true);
    const enter = key(INPUT);
    guard.onKeyDown(enter);
    // Sin envío implícito: el navegador ni siquiera valida (no sale "Enter the ZIP code").
    expect(enter.prevented).toBe(true);

    // Google cierra el menú en su propio keydown; un segundo Enter antes de place_changed
    // tampoco envía.
    setOpen(false);
    const again = key(INPUT);
    guard.onKeyDown(again);
    expect(again.prevented).toBe(true);

    // "Siguiente" mientras se completa la selección: ni validación ni envío.
    const click = ev(BUTTON);
    guard.onClick(click);
    expect(click.prevented && click.stopped).toBe(true);
    const submit = ev();
    guard.onSubmit(submit);
    expect(submit.prevented && submit.stopped).toBe(true);
  });

  it("Enter después de elegir y con todo lleno → submit normal", () => {
    const { guard, setOpen } = setup();
    setOpen(true);
    guard.onKeyDown(key(INPUT));
    setOpen(false);
    guard.placeChanged();

    const enter = key(INPUT);
    guard.onKeyDown(enter);
    expect(enter.prevented).toBe(false);
    const click = ev(BUTTON);
    guard.onClick(click);
    expect(click.prevented).toBe(false);
    const submit = ev();
    guard.onSubmit(submit);
    expect(submit.prevented).toBe(false);
  });

  it("un clic sobre una sugerencia también retiene el envío hasta place_changed", () => {
    const { guard } = setup();
    guard.onPointerDown({ target: SUGGESTION });
    expect(guard.pending()).toBe(true);
    guard.placeChanged();
    expect(guard.pending()).toBe(false);
  });

  it("si place_changed no llega, el formulario vuelve a enviar pasado SETTLE_MS", () => {
    const { guard, setOpen, advance } = setup();
    setOpen(true);
    guard.onKeyDown(key(INPUT));
    setOpen(false);
    advance(SETTLE_MS);
    const submit = ev();
    guard.onSubmit(submit);
    expect(submit.prevented).toBe(false);
  });

  it("sin menú, Enter en la calle envía como siempre; otras teclas y otros campos no se tocan", () => {
    const { guard, setOpen } = setup();
    const enter = key(INPUT);
    guard.onKeyDown(enter);
    expect(enter.prevented).toBe(false);

    setOpen(true);
    const down = key(INPUT, "ArrowDown");
    guard.onKeyDown(down);
    expect(down.prevented).toBe(false);
    const elsewhere = key(OTHER);
    guard.onKeyDown(elsewhere);
    expect(elsewhere.prevented).toBe(false);
    expect(guard.pending()).toBe(false);
  });

  it("el componente escucha en captura en window (antes que Google) y libera en place_changed", () => {
    const src = readFileSync("src/components/address-autocomplete.tsx", "utf8");
    expect(src).toContain('window.addEventListener("keydown", onKeyDown, true);');
    expect(src).toContain('form.addEventListener("submit", onSubmit, true);');
    expect(src).toContain('document.addEventListener("click", onClick, true);');
    expect(src).toContain("guardRef.current?.placeChanged();");
    // El guard de React en onKeyDown llegaba tarde: Google ya había cerrado el menú.
    expect(src).not.toMatch(/onKeyDown=\{/);
  });
});
