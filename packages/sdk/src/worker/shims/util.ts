/**
 * Node.js util polyfill
 */

export function promisify(fn: Function): Function {
  return function (...args: any[]) {
    return new Promise((resolve, reject) => {
      fn(...args, (err: any, ...results: any[]) => {
        if (err) return reject(err);
        if (results.length <= 1) return resolve(results[0]);
        resolve(results);
      });
    });
  };
}

export function callbackify(fn: Function): Function {
  return function (...args: any[]) {
    const cb = args.pop();
    fn(...args)
      .then((val: any) => cb(null, val))
      .catch((err: any) => cb(err));
  };
}

export function inherits(ctor: any, superCtor: any) {
  if (ctor === undefined || ctor === null) throw new TypeError('ctor must not be null');
  if (superCtor === undefined || superCtor === null) throw new TypeError('superCtor must not be null');
  if (superCtor.prototype === undefined) throw new TypeError('superCtor.prototype must not be undefined');
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

export function format(fmt: any, ...args: any[]): string {
  if (typeof fmt !== 'string') {
    return [fmt, ...args].map(inspect).join(' ');
  }
  let argIndex = 0;
  let str = fmt.replace(/%[sdj%]/g, (match) => {
    if (match === '%%') return '%';
    if (argIndex >= args.length) return match;
    const val = args[argIndex++];
    if (match === '%s') return String(val);
    if (match === '%d') return Number(val).toString();
    if (match === '%j') {
      try { return JSON.stringify(val); } catch (_) { return '[Circular]'; }
    }
    return match;
  });
  while (argIndex < args.length) {
    str += ' ' + inspect(args[argIndex++]);
  }
  return str;
}

export function inspect(obj: any, options?: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj === 'string') return `'${obj}'`;
  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'symbol') return String(obj);
  if (typeof obj === 'function') return `[Function: ${obj.name || '(anonymous)'}]`;
  if (obj instanceof Error) return obj.stack || `${obj.name}: ${obj.message}`;
  try {
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    return String(obj);
  }
}

export const types = {
  isPromise: (v: any) => v instanceof Promise || (v && typeof v.then === 'function'),
  isDate: (v: any) => v instanceof Date,
  isRegExp: (v: any) => v instanceof RegExp,
  isAsyncFunction: (v: any) => typeof v === 'function' && v.constructor?.name === 'AsyncFunction',
};

export function deprecate<T extends Function>(fn: T, msg: string): T {
  let warned = false;
  return function (this: any, ...args: any[]) {
    if (!warned) {
      warned = true;
      console.warn(`[DEP] ${msg}`);
    }
    return fn.apply(this, args);
  } as any;
}

export default {
  promisify,
  callbackify,
  inherits,
  format,
  inspect,
  types,
  deprecate,
};
