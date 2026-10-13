// Textos de las solicitudes del vendedor (#134, #136), EN/ES. Módulo aparte de i18n.ts
// para no cargar todos los diccionarios en el formulario (componente cliente).
import type { ChangeableField } from "@/lib/listing-requests";

export type RequestsLang = "en" | "es";

const en = {
  dashboardLink: "Request a change or withdrawal →",
  backToDashboard: "← Dashboard",
  title: "Changes to your listing",
  intro:
    "Your listing has been submitted, so changes go through your broker: she updates the MLS (Matrix) first and approves the change — only then is it published on lixtara.com. This keeps the website and the MLS in sync.",
  draftNote: "This listing is still a draft — edit it directly.",
  draftCta: "Edit listing",
  history: "Your requests",
  noHistory: "No requests yet.",
  kindChange: "Change",
  kindWithdrawal: "Withdrawal",
  status: { pending: "Pending broker review", approved: "Approved", rejected: "Not approved", cancelled: "Cancelled" },
  brokerNote: "Broker note",
  changeTitle: "Request a change",
  changeHelp: "Edit only what should change. Leave everything else as is.",
  reason: "Reason (optional)",
  submitChange: "Send change request",
  changeNotAllowed: "Changes can't be requested in this status. Contact your broker.",
  withdrawTitle: "Request withdrawal",
  withdrawHelp:
    "Your broker withdraws the listing from the MLS and then from lixtara.com. Your 24-month agreement still applies; she will contact you if anything is needed.",
  withdrawConfirm: "I want to take my listing off the market.",
  submitWithdrawal: "Send withdrawal request",
  withdrawNotAllowed:
    "With an accepted offer or under contract, withdrawal depends on your contracts — contact your broker directly.",
  pendingExists: "You already have a pending request of this type. Your broker will review it soon.",
  sent: "Request sent. Your broker will review it.",
  errors: {
    no_changes: "Nothing changed.",
    invalid_value: "Check this value:",
    unknown_field: "That field can't be changed here.",
    request_pending: "You already have a pending request of this type.",
    rate_limited: "Too many requests. Try again later.",
    generic: "Could not send the request. Try again.",
  },
  yes: "Yes",
  no: "No",
};

const es: typeof en = {
  dashboardLink: "Solicitar un cambio o el retiro →",
  backToDashboard: "← Dashboard",
  title: "Cambios en tu listing",
  intro:
    "Tu listing ya fue enviado, así que los cambios pasan por tu broker: ella actualiza primero el MLS (Matrix) y aprueba el cambio — solo entonces se publica en lixtara.com. Así el sitio y el MLS no divergen.",
  draftNote: "Este listing sigue en borrador — edítalo directamente.",
  draftCta: "Editar listing",
  history: "Tus solicitudes",
  noHistory: "Aún no hay solicitudes.",
  kindChange: "Cambio",
  kindWithdrawal: "Retiro",
  status: { pending: "Pendiente de la broker", approved: "Aprobada", rejected: "No aprobada", cancelled: "Cancelada" },
  brokerNote: "Nota de la broker",
  changeTitle: "Solicitar un cambio",
  changeHelp: "Edita solo lo que debe cambiar. Deja el resto como está.",
  reason: "Motivo (opcional)",
  submitChange: "Enviar solicitud de cambio",
  changeNotAllowed: "En este estado no se pueden solicitar cambios. Contacta a tu broker.",
  withdrawTitle: "Solicitar el retiro",
  withdrawHelp:
    "Tu broker retira el listing del MLS y luego de lixtara.com. Tu contrato de 24 meses sigue vigente; ella te contactará si hace falta algo.",
  withdrawConfirm: "Quiero sacar mi propiedad del mercado.",
  submitWithdrawal: "Enviar solicitud de retiro",
  withdrawNotAllowed:
    "Con una oferta aceptada o bajo contrato, el retiro depende de tus contratos — contacta directamente a tu broker.",
  pendingExists: "Ya tienes una solicitud pendiente de este tipo. Tu broker la revisará pronto.",
  sent: "Solicitud enviada. Tu broker la revisará.",
  errors: {
    no_changes: "No cambiaste nada.",
    invalid_value: "Revisa este valor:",
    unknown_field: "Ese campo no se puede cambiar aquí.",
    request_pending: "Ya tienes una solicitud pendiente de este tipo.",
    rate_limited: "Demasiadas solicitudes. Intenta más tarde.",
    generic: "No se pudo enviar la solicitud. Intenta de nuevo.",
  },
  yes: "Sí",
  no: "No",
};

export type RequestsCopy = typeof en;
export const REQUESTS_COPY: Record<RequestsLang, RequestsCopy> = { en, es };

export const FIELD_LABELS: Record<RequestsLang, Record<ChangeableField, string>> = {
  en: {
    list_price: "List price (USD)",
    address_street: "Street address",
    address_city: "City",
    address_zip: "ZIP code",
    property_type: "Property type",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    sqft: "Living area (sq ft)",
    lot_size: "Lot size (sq ft)",
    year_built: "Year built",
    parking_spaces: "Parking spaces",
    hoa_fee: "HOA fee (monthly, USD)",
    description: "Description",
    showing_instructions: "Showing instructions",
    occupancy_status: "Occupancy",
    has_pool: "Pool",
    cash_only: "Cash only",
    as_is_sale: "As-is sale",
  },
  es: {
    list_price: "Precio de lista (USD)",
    address_street: "Dirección",
    address_city: "Ciudad",
    address_zip: "Código postal",
    property_type: "Tipo de propiedad",
    bedrooms: "Habitaciones",
    bathrooms: "Baños",
    sqft: "Área habitable (sq ft)",
    lot_size: "Tamaño del lote (sq ft)",
    year_built: "Año de construcción",
    parking_spaces: "Parqueaderos",
    hoa_fee: "Cuota HOA (mensual, USD)",
    description: "Descripción",
    showing_instructions: "Instrucciones de visita",
    occupancy_status: "Ocupación",
    has_pool: "Piscina",
    cash_only: "Solo contado",
    as_is_sale: "Venta as-is",
  },
};

export const ENUM_LABELS: Record<RequestsLang, Record<string, string>> = {
  en: {
    single_family: "Single family", condo: "Condo", townhouse: "Townhouse", multi_family: "Multi-family",
    vacant: "Vacant", owner_occupied: "Owner-occupied", tenant_occupied: "Tenant-occupied",
  },
  es: {
    single_family: "Casa unifamiliar", condo: "Condominio", townhouse: "Townhouse", multi_family: "Multifamiliar",
    vacant: "Desocupada", owner_occupied: "Ocupada por el dueño", tenant_occupied: "Ocupada por inquilino",
  },
};
