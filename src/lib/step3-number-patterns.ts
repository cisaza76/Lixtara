// Patrones del paso 3 para la validación en el navegador (atributo `pattern`, que el navegador
// evalúa como ^(?:patrón)$ con la bandera v). Reflejan la regla del servidor (saveStep3):
// baños y pies² mayores que 0; habitaciones admite 0 (estudio) y no lleva patrón.

/** Baños: número mayor que 0, con decimales opcionales (2, 2.5, .5). */
export const BATHROOMS_PATTERN = String.raw`\s*(?=[\d.]*[1-9])(?:\d+(?:\.\d+)?|\.\d+)\s*`;

/** Pies²: entero mayor que 0, solo dígitos (sin comas: "1,854" se guardaba como 1). */
export const SQFT_PATTERN = String.raw`\s*0*[1-9]\d*\s*`;
