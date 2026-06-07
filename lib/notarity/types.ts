// Types modelling the notarity booking-form schema and the submission payload.
// Kept permissive on purpose: the live schema is the source of truth, so unknown
// props are preserved rather than rejected.

/** Live schema localises titles as { en, de, es }; the docs show plain strings. */
export type Localized = string | Record<string, string>;

export type ConditionOperator =
  | 'ISDEFINED'
  | 'INCLUDES'
  | 'EQUAL'
  | 'INTERSECTS'
  | 'ISTRUE';

export interface Component {
  type: string; // countryPicker | productPicker | singleProduct | condition | participants | timeSlots | billingDetails | contactDetails | hardCopy | shippingDetails | summary | preferredNotary | newsletter | confirmTC | ...
  accessor?: string; // payload key this component writes into
  props?: Record<string, any>;
  required?: boolean;

  // Only present on `type === 'condition'`:
  condition?: ConditionOperator;
  compare?: string; // dotted path into the payload, e.g. "destinationCountry" or "products.id"
  value?: any;
  components?: Component[]; // shown when the condition is TRUE
  elseComponents?: Component[]; // shown when the condition is FALSE
}

export interface Page {
  id?: string;
  slug?: string;
  title?: Localized;
  components: Component[];
}

export interface BookingFormOptions {
  shippingFee?: number; // cents
  expressShippingFee?: number; // cents
  logo?: string;
  [k: string]: any;
}

export interface BookingForm {
  id: string;
  _company?: string;
  options?: BookingFormOptions;
  pages: Page[];
  [k: string]: any;
}

export interface Product {
  id: string;
  title?: Record<string, string>;
  description?: Record<string, string>;
  baseFee?: number; // cents
  pricePerDoc?: number; // cents
  includedDocs?: number;
  showApostille?: boolean;
  apostilleRequired?: boolean;
  apostillePrice?: number;
  showFileUpload?: boolean;
  fileUploadRequired?: boolean;
  showUserInput?: boolean;
  userInputRequired?: boolean;
  showNeedHelpDrafting?: boolean;
  draftingFee?: number;
  showProofOfRepresentation?: boolean;
  proofOfRepresentationPrice?: number;
  hardCopySupported?: boolean;
  instantNotarisationSupported?: boolean;
  _tags?: string[];
  [k: string]: any;
}

// One entry in payload.products[]
export interface ProductSelection {
  id: string;
  apostille?: boolean;
  userInput?: string;
  documentsNotReadyYet?: boolean;
  needHelpDrafting?: boolean;
  proofOfRepresentation?: any;
  files?: string[];
  [k: string]: any;
}

export interface PriceLineItem {
  name: string;
  _product?: string;
  amount: number;
  pricePerUnit: number; // cents
  net: number; // cents
  identifier?: number;
  pricingEnabled?: boolean;
}

export interface Timeslot {
  id: string;
  startTime: string;
  endTime: string;
  available?: number;
  taken?: number;
  _timeslotLabel?: string;
  deleted?: boolean;
}

// The object submitted to POST /appointment-requests (the `payload` multipart part).
export interface BookingPayload {
  _bookingForm?: string;
  destinationCountry?: string | string[];
  products?: ProductSelection[];
  participants?: any[];
  timeslots?: string[];
  billingDetails?: Record<string, any>;
  contactDetails?: Record<string, any>;
  hardCopy?: { hardCopy?: boolean; expressShipping?: boolean };
  shippingDetails?: Record<string, any>;
  newsletter?: boolean;
  preferredNotary?: any;
  confirmedPrice?: number; // euros
  instant?: boolean;
  instantNotarisationSupported?: boolean;
  language?: string;
  timezone?: string;
  origin?: string;
  _appointmentRequestDraft?: string;
  mode?: 'debug' | string;
  [k: string]: any;
}
