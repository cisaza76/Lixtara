// Fotos y bios del equipo para /about. Se llenan cuando lleguen del equipo: nunca fotos de
// stock ni nombres, cargos o bios inventados. Mientras un campo es null, la página no lo
// muestra (la tarjeta de la broker sale con sus iniciales y sin bio).
//
// Licencias: si una persona del equipo muestra su número de licencia, va primero en
// src/config/brokerage.ts (brokerage.test.ts falla con cualquier otro número en el código).
// "Realtor" solo para quien la broker confirme como miembro activo de NAR; si no, "licensed
// agent" / "agente licenciado".

type Lang = "en" | "es";

export interface TeamMember {
  name: string;
  role: Record<Lang, string>;
  /** Ruta en /public, p. ej. "/team/nombre.jpg". */
  photo: string | null;
  bio: Record<Lang, string> | null;
}

/** Foto y bio de la broker (su nombre y licencia salen de BROKERAGE). */
export const BROKER_PROFILE: { photo: string | null; bio: Record<Lang, string> | null } = {
  photo: null,
  bio: null,
};

/** Resto del equipo, en el orden en que se muestra. */
export const TEAM_MEMBERS: TeamMember[] = [];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}
