// "Actividad reciente" del admin en el idioma de la página. activity_log.description la
// escribe el sistema en inglés y con formatos fijos (mls-published.server.ts,
// listing-mls-number.server.ts, listing-requests.server.ts, la revisión del listing y
// Creative Studio). Aquí se reconoce cada formato y se rearma en el idioma pedido; lo que
// viene del usuario (notas, números, valores de los cambios) se muestra tal cual. Un texto que
// no se reconoce se muestra como está guardado.

export interface ActivityCopy {
  publishedOnMls: string; // "{value}"
  mlsDateChanged: string; // "{value}", "{note}"
  mlsDateCleared: string;
  mlsNumberSet: string; // "{value}"
  listingStatus: string; // "{status}"
  bySellerRequest: string;
  sellerRequestsChange: string; // "{changes}"
  sellerRequestsWithdrawal: string;
  reason: string; // "{reason}"
  changeApproved: string; // "{changes}"
  requestRejected: string;
  requestRejectedNote: string; // "{note}"
  statuses: Record<string, string>;
  fixed: Record<string, string>;
}

export interface ActivityRow {
  action_type: string;
  description: string | null;
}

const fill = (tpl: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), tpl);

function formatDate(value: string, lang: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric", timeZone: "America/New_York" });
}

function status(copy: ActivityCopy, s: string): string {
  return copy.statuses[s] ?? s;
}

export function activityText(a: ActivityRow, copy: ActivityCopy, lang: string): string {
  const d = a.description ?? "";
  let m: RegExpMatchArray | null;

  if (copy.fixed[d]) return copy.fixed[d];

  switch (a.action_type) {
    case "mls_published_marked":
      if ((m = d.match(/^Published on the MLS \(([\s\S]+)\)$/))) return fill(copy.publishedOnMls, { value: m[1] });
      break;
    case "mls_published_corrected":
      if ((m = d.match(/^MLS publication date → ([\s\S]+?)\. Note: ([\s\S]*)$/))) {
        const value = m[1] === "cleared" ? copy.mlsDateCleared : formatDate(m[1], lang);
        return fill(copy.mlsDateChanged, { value, note: m[2] });
      }
      break;
    case "mls_number_set":
      if ((m = d.match(/^MLS number → ([\s\S]+)$/))) return fill(copy.mlsNumberSet, { value: m[1] });
      break;
    case "listing_changes_requested":
    case "listing_approved":
    case "listing_rejected":
    case "listing_withdrawn":
      if ((m = d.match(/^Listing → (\w+)( \(seller request\))?$/))) {
        const text = fill(copy.listingStatus, { status: status(copy, m[1]) });
        return m[2] ? `${text} ${copy.bySellerRequest}` : text;
      }
      break;
    case "listing_change_requested":
    case "listing_withdrawal_requested": {
      const [first, ...rest] = d.split("\n");
      let head: string | null = null;
      if ((m = first.match(/^Seller requests: ([\s\S]+)$/))) head = fill(copy.sellerRequestsChange, { changes: m[1] });
      else if (first === "Seller requests to withdraw this listing.") head = copy.sellerRequestsWithdrawal;
      if (head) {
        const tail = rest.map((l) => {
          const r = l.match(/^Reason: ([\s\S]*)$/);
          return r ? fill(copy.reason, { reason: r[1] }) : l;
        });
        return [head, ...tail].join("\n");
      }
      break;
    }
    case "listing_change_approved":
      if (d) return fill(copy.changeApproved, { changes: d });
      break;
    case "listing_change_rejected":
    case "listing_withdrawal_rejected":
      return d && d !== "Request rejected" ? fill(copy.requestRejectedNote, { note: d }) : copy.requestRejected;
  }
  return a.description ?? a.action_type;
}
