// id del mensaje de error bajo un campo (AppFormValidation), el que apunta aria-describedby.
//
// Se lee el ATRIBUTO id del formulario, nunca `form.id`: en un <form>, `form.id` devuelve el
// control con name="id" si existe, y los formularios de /listing/new llevan
// <input type="hidden" name="id">. Con `form.id` el resultado era
// "[object HTMLInputElement]-state-error" (preview, 2026-10-16).

/** Lo mínimo de un <form> que se usa: el atributo id. */
export interface FormLike {
  getAttribute(name: string): string | null;
}

export function fieldErrorId(form: FormLike, name: string): string {
  const base = form.getAttribute("id") || "listing-form";
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${base}-${safe}-error`;
}
