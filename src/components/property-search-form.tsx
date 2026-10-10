// Filtros de /properties. Formulario GET sin JavaScript: los filtros viven en la URL, así
// que una búsqueda se puede compartir, el botón "atrás" funciona y la página sigue siendo
// SSR. Los valores se validan del lado del servidor en src/lib/property-search.ts.
import Link from "next/link";
import {
  BATH_OPTIONS,
  BED_OPTIONS,
  COUNTY_OPTIONS,
  PRICE_STEPS,
  hasActiveFilters,
  type PropertySearch,
} from "@/lib/property-search";

export interface PropertySearchFormLabels {
  heading: string;
  minPrice: string;
  maxPrice: string;
  beds: string;
  baths: string;
  county: string;
  zip: string;
  sort: string;
  any: string;
  plus: string;
  sortNewest: string;
  sortPriceAsc: string;
  sortPriceDesc: string;
  submit: string;
  clear: string;
}

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const FIELD = "flex flex-col gap-1.5 min-w-0";
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/60";
const CONTROL =
  "h-11 w-full border border-gold-soft bg-ivory px-3 text-sm text-ink focus:outline-none focus:border-gold";

export function PropertySearchForm({
  lang,
  search,
  labels,
}: {
  lang: string;
  search: PropertySearch;
  labels: PropertySearchFormLabels;
}) {
  const v = (n: number | null) => (n === null ? "" : String(n));

  return (
    <form
      method="get"
      action={`/${lang}/properties`}
      role="search"
      aria-label={labels.heading}
      className="mb-12 lg:mb-16 border border-gold-soft p-4 sm:p-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 items-end"
    >
      <label className={FIELD}>
        <span className={LABEL}>{labels.minPrice}</span>
        <select name="min_price" defaultValue={v(search.minPrice)} className={CONTROL}>
          <option value="">{labels.any}</option>
          {PRICE_STEPS.map((p) => (
            <option key={p} value={p}>{compactUsd.format(p)}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.maxPrice}</span>
        <select name="max_price" defaultValue={v(search.maxPrice)} className={CONTROL}>
          <option value="">{labels.any}</option>
          {PRICE_STEPS.map((p) => (
            <option key={p} value={p}>{compactUsd.format(p)}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.beds}</span>
        <select name="beds" defaultValue={v(search.beds)} className={CONTROL}>
          <option value="">{labels.any}</option>
          {BED_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}{labels.plus}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.baths}</span>
        <select name="baths" defaultValue={v(search.baths)} className={CONTROL}>
          <option value="">{labels.any}</option>
          {BATH_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}{labels.plus}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.county}</span>
        <select name="county" defaultValue={search.county ?? ""} className={CONTROL}>
          <option value="">{labels.any}</option>
          {COUNTY_OPTIONS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.zip}</span>
        <input
          name="zip"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{5}"
          maxLength={5}
          autoComplete="postal-code"
          defaultValue={search.zip ?? ""}
          placeholder="33130"
          className={CONTROL}
        />
      </label>

      <label className={FIELD}>
        <span className={LABEL}>{labels.sort}</span>
        <select name="sort" defaultValue={search.sort} className={CONTROL}>
          <option value="newest">{labels.sortNewest}</option>
          <option value="price_asc">{labels.sortPriceAsc}</option>
          <option value="price_desc">{labels.sortPriceDesc}</option>
        </select>
      </label>

      <div className="flex flex-col gap-2 col-span-2 md:col-span-1">
        <button
          type="submit"
          className="h-11 px-4 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
        >
          {labels.submit}
        </button>
        {(hasActiveFilters(search) || search.sort !== "newest") && (
          <Link
            href={`/${lang}/properties`}
            className="text-center text-[10px] uppercase tracking-[0.18em] text-ink/60 hover:text-gold transition-colors"
          >
            {labels.clear}
          </Link>
        )}
      </div>
    </form>
  );
}
