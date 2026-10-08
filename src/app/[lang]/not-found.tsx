import { t } from "@/lib/i18n";
import { NotFoundContent } from "@/components/not-found-content";

// not-found.tsx no recibe params: se pasan ambos idiomas y el cliente elige por la URL.
export default function NotFound() {
  return <NotFoundContent copy={{ en: t("en").notFound, es: t("es").notFound }} />;
}
