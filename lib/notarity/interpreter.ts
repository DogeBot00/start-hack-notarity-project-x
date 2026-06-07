// Schema interpreter: given the live form schema + the current payload, compute
// which input components are active, what is still required, and any products
// the schema auto-adds (singleProduct). Hardcoded to NO specific form.

import type { BookingForm, Component, BookingPayload, Product, Localized } from './types';
import { evaluateCondition } from './conditions';

export interface ActiveComponent {
  component: Component;
  page: number;
  pageTitle?: Localized;
}

export interface InterpretResult {
  active: ActiveComponent[]; // ordered, visible input components
  autoProductIds: string[]; // products added by singleProduct rules
  byAccessor: Record<string, ActiveComponent>;
}

const NON_INPUT_TYPES = new Set(['condition', 'summary', 'confirmTC']);

/**
 * The LIVE schema nests a condition's fields under `props`
 * (props.condition / props.compare / props.value / props.components /
 * props.elseComponents); the documented shape has them at the top level.
 * Accept both — top level wins when present.
 */
function conditionFields(c: Component) {
  const p = c.props ?? {};
  return {
    operator: (c.condition ?? p.condition) as Component['condition'],
    compare: c.compare ?? p.compare ?? '',
    value: c.value !== undefined ? c.value : p.value,
    components: (c.components ?? p.components) as Component[] | undefined,
    elseComponents: (c.elseComponents ?? p.elseComponents) as Component[] | undefined,
  };
}

/** Recursively walk a component list, resolving conditions against the payload. */
function walk(
  components: Component[] | undefined,
  payload: BookingPayload,
  page: number,
  pageTitle: Localized | undefined,
  out: InterpretResult
) {
  if (!components) return;
  for (const c of components) {
    if (c.type === 'condition') {
      const f = conditionFields(c);
      const pass = evaluateCondition(payload, f.operator!, f.compare, f.value);
      walk(pass ? f.components : f.elseComponents, payload, page, pageTitle, out);
      continue;
    }

    if (c.type === 'singleProduct') {
      const pid = c.props?._product ?? (c as any)._product;
      if (pid) out.autoProductIds.push(pid);
      continue;
    }

    if (!NON_INPUT_TYPES.has(c.type)) {
      const entry: ActiveComponent = { component: c, page, pageTitle };
      out.active.push(entry);
      if (c.accessor) out.byAccessor[c.accessor] = entry;
    }
  }
}

export function interpret(schema: BookingForm, payload: BookingPayload): InterpretResult {
  const out: InterpretResult = { active: [], autoProductIds: [], byAccessor: {} };
  schema.pages.forEach((p, i) => walk(p.components, payload, i, p.title, out));
  return out;
}

/**
 * Required-field obligations that are still unmet, given the schema, the payload
 * and the resolved product catalog. Returns a list of human-readable problems;
 * empty list == payload is submittable.
 */
export function validate(
  schema: BookingForm,
  payload: BookingPayload,
  productsById: Record<string, Product>
): string[] {
  const { active } = interpret(schema, payload);
  const problems: string[] = [];

  for (const { component: c } of active) {
    if (!c.accessor) continue;
    const isRequired = c.required ?? c.props?.required ?? false;
    const val = (payload as any)[c.accessor];
    const empty =
      val === undefined ||
      val === null ||
      val === '' ||
      (Array.isArray(val) && val.length === 0);
    if (isRequired && empty) problems.push(`Missing required field: ${c.accessor}`);
  }

  // Product-capability-driven obligations (source of truth = product flags).
  for (const sel of payload.products ?? []) {
    const prod = productsById[sel.id];
    if (!prod) {
      problems.push(`Unknown product in selection: ${sel.id}`);
      continue;
    }
    if (prod.fileUploadRequired && (!sel.files || sel.files.length === 0)) {
      problems.push(`Product "${prod.id}" requires at least one uploaded file.`);
    }
    if (prod.userInputRequired && !sel.userInput) {
      problems.push(`Product "${prod.id}" requires user input text.`);
    }
    if (prod.apostilleRequired && sel.apostille !== true) {
      problems.push(`Product "${prod.id}" requires an apostille.`);
    }
  }

  if (!payload.timeslots || payload.timeslots.length === 0) {
    problems.push('No timeslot selected.');
  }
  if (!payload.products || payload.products.length === 0) {
    problems.push('No product selected.');
  }

  return problems;
}

/** Apply the schema's singleProduct auto-adds to the selection (idempotent). */
export function applyAutoProducts(
  schema: BookingForm,
  payload: BookingPayload,
  productsById: Record<string, Product>
): BookingPayload {
  const { autoProductIds } = interpret(schema, payload);
  const products = [...(payload.products ?? [])];
  for (const pid of autoProductIds) {
    if (!products.some((p) => p.id === pid)) {
      const prod = productsById[pid];
      products.push({
        id: pid,
        apostille: prod?.apostilleRequired ? true : undefined,
        files: [],
      });
    }
  }
  return { ...payload, products };
}
