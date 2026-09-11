/**
 * Next.js Virtual Environment Runtime & Shims for Buddhi Sandbox VFS
 */

export interface VfsLike {
  writeFile(path: string, data: string | Uint8Array): void;
  mkdir(path: string, recursive?: boolean): void;
  exists(path: string): boolean;
}

export class NextRuntime {
  /**
   * Installs lightweight Next.js, React, and React-DOM package manifests and shims
   * into the sandbox virtual filesystem so imports and require calls resolve.
   */
  public static installNextShims(vfs: VfsLike, targetDir: string = '/workspace'): void {
    const nodeModules = `${targetDir}/node_modules`;

    const write = (subpath: string, content: string) => {
      const fullPath = `${nodeModules}/${subpath}`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      try {
        vfs.mkdir(dir, true);
      } catch (_) {}
      vfs.writeFile(fullPath, content);
    };

    // 1. React
    write('react/package.json', JSON.stringify({
      name: 'react',
      version: '18.3.1',
      main: 'index.js',
      exports: {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
      },
    }, null, 2));

    write('react/index.js', `
const React = {
  version: '18.3.1',
  createElement(type, props, ...children) {
    const normalizedProps = Object.assign({}, props);
    if (children.length === 1) {
      normalizedProps.children = children[0];
    } else if (children.length > 1) {
      normalizedProps.children = children;
    }
    return {
      $$typeof: Symbol.for('react.element'),
      type,
      props: normalizedProps,
      key: (props && props.key) || null,
      ref: (props && props.ref) || null,
    };
  },
  Fragment: Symbol.for('react.fragment'),
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); },
  useRef(initial) { return { current: initial }; },
  useContext(ctx) { return ctx ? ctx._currentValue : undefined; },
  createContext(defaultValue) {
    const ctx = {
      _currentValue: defaultValue,
      Provider: ({ value, children }) => children,
      Consumer: ({ children }) => children(defaultValue),
    };
    return ctx;
  },
  Component: class {
    constructor(props) { this.props = props; }
    setState() {}
    render() { return null; }
  },
};
module.exports = React;
module.exports.default = React;
`);

    write('react/jsx-runtime.js', `
const React = require('./index.js');
function jsx(type, props, key) {
  const finalProps = Object.assign({}, props);
  if (key !== undefined) finalProps.key = key;
  return React.createElement(type, finalProps);
}
module.exports = {
  jsx,
  jsxs: jsx,
  Fragment: React.Fragment,
};
`);

    // 2. React-DOM
    write('react-dom/package.json', JSON.stringify({
      name: 'react-dom',
      version: '18.3.1',
      main: 'index.js',
      exports: {
        '.': './index.js',
        './server': './server.js',
        './client': './client.js',
      },
    }, null, 2));

    write('react-dom/index.js', `
const ReactDOM = {
  version: '18.3.1',
  render() {},
  hydrate() {},
  createRoot() { return { render() {}, unmount() {} }; },
};
module.exports = ReactDOM;
module.exports.default = ReactDOM;
`);

    write('react-dom/server.js', `
function renderElement(el) {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(renderElement).join('');
  if (typeof el.type === 'function') {
    try {
      const res = el.type(el.props || {});
      return renderElement(res);
    } catch (_) {
      return '<div>Error rendering component</div>';
    }
  }
  const tag = el.type || 'div';
  const props = el.props || {};
  let attrs = '';
  let children = '';
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children') {
      children = renderElement(v);
    } else if (k === 'className') {
      attrs += \` class="\${v}"\`;
    } else if (typeof v === 'string' || typeof v === 'number') {
      attrs += \` \${k}="\${v}"\`;
    }
  }
  return \`<\${tag}\${attrs}>\${children}</\${tag}>\`;
}

module.exports = {
  renderToString: renderElement,
  renderToStaticMarkup: renderElement,
};
`);

    // 3. Next.js
    write('next/package.json', JSON.stringify({
      name: 'next',
      version: '14.2.0',
      main: 'index.js',
      bin: {
        next: './dist/bin/next',
      },
      exports: {
        '.': './index.js',
        './link': './link.js',
        './image': './image.js',
        './navigation': './navigation.js',
        './headers': './headers.js',
        './server': './server.js',
      },
    }, null, 2));

    write('next/index.js', `
const React = require('react');
module.exports = {
  default: () => null,
};
`);

    write('next/link.js', `
const React = require('react');
function Link(props) {
  const { href, children, ...rest } = props;
  return React.createElement('a', { href, ...rest }, children);
}
module.exports = Link;
module.exports.default = Link;
`);

    write('next/image.js', `
const React = require('react');
function Image(props) {
  const { src, alt, width, height, ...rest } = props;
  return React.createElement('img', { src, alt, width, height, ...rest });
}
module.exports = Image;
module.exports.default = Image;
`);

    write('next/navigation.js', `
module.exports = {
  useRouter() {
    return {
      push(url) { if (typeof window !== 'undefined') window.location.href = url; },
      replace(url) { if (typeof window !== 'undefined') window.location.replace(url); },
      back() { if (typeof window !== 'undefined') window.history.back(); },
      forward() { if (typeof window !== 'undefined') window.history.forward(); },
      refresh() {},
      prefetch() {},
    };
  },
  usePathname() {
    if (typeof window !== 'undefined') return window.location.pathname;
    return '/';
  },
  useSearchParams() {
    if (typeof window !== 'undefined') return new URLSearchParams(window.location.search);
    return new URLSearchParams();
  },
  redirect(url) {
    const err = new Error('NEXT_REDIRECT');
    err.digest = 'NEXT_REDIRECT;' + url;
    throw err;
  },
  notFound() {
    const err = new Error('NEXT_NOT_FOUND');
    err.digest = 'NEXT_NOT_FOUND';
    throw err;
  },
};
`);

    write('next/headers.js', `
module.exports = {
  cookies() {
    return {
      get(name) { return undefined; },
      getAll() { return []; },
      set() {},
      delete() {},
    };
  },
  headers() {
    return new Headers();
  },
};
`);
  }
}
