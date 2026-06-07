// Deterministic evaluation of the form's conditional operators.
// These are the ONLY place operator semantics live, so they can be unit-tested
// independently of any specific form.

import type { ConditionOperator, BookingPayload } from './types';

function toArray(v: any): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Resolve a dotted path against the payload.
 * Supports array "pluck": for `products.id`, if `products` is an array, returns
 * the array of each element's `id`.
 */
export function resolvePath(payload: any, path: string): any {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: any = payload;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      // pluck the property from every element
      current = current.map((el) => (el == null ? undefined : el[part]));
    } else {
      current = current[part];
    }
  }
  return current;
}

/**
 * Evaluate a single condition.
 * @param operator  one of ISDEFINED | INCLUDES | EQUAL | INTERSECTS | ISTRUE
 * @param actual    the value read from the payload at `compare`
 * @param expected  the condition's `value`
 */
export function evaluate(
  operator: ConditionOperator,
  actual: any,
  expected: any
): boolean {
  switch (operator) {
    case 'ISDEFINED': {
      if (actual === undefined || actual === null) return false;
      if (Array.isArray(actual)) return actual.some((x) => x !== undefined && x !== null);
      if (typeof actual === 'string') return actual.length > 0;
      return true;
    }
    case 'ISTRUE':
      return actual === true;
    case 'EQUAL': {
      const a = Array.isArray(actual) && actual.length === 1 ? actual[0] : actual;
      const e = Array.isArray(expected) && expected.length === 1 ? expected[0] : expected;
      return a === e;
    }
    case 'INCLUDES': {
      // The compared field (as a set) must contain every expected value.
      const haystack = toArray(actual);
      const needles = toArray(expected);
      return needles.every((n) => haystack.includes(n));
    }
    case 'INTERSECTS': {
      // The compared field and the expected list share at least one element.
      const a = toArray(actual);
      const e = toArray(expected);
      return a.some((x) => e.includes(x));
    }
    default:
      return false;
  }
}

/**
 * The live schema encodes array condition values as JSON strings
 * (e.g. value: "[\"AT\"]" for INCLUDES/INTERSECTS). Decode them; scalar
 * values ("ES") and already-decoded arrays pass through untouched.
 */
export function decodeConditionValue(value: any): any {
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return JSON.parse(t);
      } catch {
        return value;
      }
    }
  }
  return value;
}

/** Convenience: evaluate a condition component against a payload. */
export function evaluateCondition(
  payload: BookingPayload,
  operator: ConditionOperator,
  comparePath: string,
  expected: any
): boolean {
  return evaluate(operator, resolvePath(payload, comparePath), decodeConditionValue(expected));
}
