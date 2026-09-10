/**
 * Node.js assert polyfill
 */

export function assert(value: any, message?: string | Error): asserts value {
  if (!value) {
    if (message instanceof Error) throw message;
    throw new Error(message || 'Assertion failed');
  }
}

export namespace assert {
  export function ok(value: any, message?: string | Error): asserts value {
    assert(value, message);
  }

  export function strictEqual(actual: any, expected: any, message?: string | Error) {
    if (!Object.is(actual, expected)) {
      if (message instanceof Error) throw message;
      throw new Error(message || `Expected values to be strictly equal: ${actual} !== ${expected}`);
    }
  }

  export function notStrictEqual(actual: any, expected: any, message?: string | Error) {
    if (Object.is(actual, expected)) {
      if (message instanceof Error) throw message;
      throw new Error(message || `Expected values not to be strictly equal: ${actual}`);
    }
  }

  export function deepStrictEqual(actual: any, expected: any, message?: string | Error) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      if (message instanceof Error) throw message;
      throw new Error(message || `Expected values to be deeply equal`);
    }
  }

  export function throws(fn: () => any, message?: string | Error) {
    let threw = false;
    try {
      fn();
    } catch (_) {
      threw = true;
    }
    if (!threw) {
      if (message instanceof Error) throw message;
      throw new Error(message || 'Missing expected exception');
    }
  }
}

export default assert;
