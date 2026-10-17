// Preview y Production comparten la base de datos. Todo lo que el servidor crea fuera de
// Production es una prueba: seller_leads.is_test y properties.is_test lo marcan al escribir.
export function writtenOutsideProduction(vercelEnv: string | undefined): boolean {
  return vercelEnv !== "production";
}
