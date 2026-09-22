/**
 * Tiny DOM helpers.
 *
 * There is no framework here on purpose (section 2), so these are the primitives
 * everything else composes from. `el()` builds elements without innerHTML, which
 * makes it impossible to accidentally inject API strings as markup.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe attribute value (escapes quotes and newlines). */
export function attr(value) {
  return String(value ?? '').replace(/["'<>&\n]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {object} [props]  properties/attributes. `class`, `dataset`, `on` (handlers),
 *                          `text` for textContent, `html` ONLY for trusted static markup.
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'class' || key === 'className') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        if (typeof handler === 'function') node.addEventListener(event, handler);
      }
    } else if (key in node && key !== 'list' && typeof value !== 'object') {
      try {
        node[key] = value;
      } catch {
        node.setAttribute(key, value);
      }
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** `<svg><use href="#icon-name"/></svg>` — uses the inline sprite in index.html. */
export function icon(name, { size, className = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(target, event, handler, options) {
  target?.addEventListener(event, handler, options);
  return () => target?.removeEventListener(event, handler, options);
}

/** Event delegation: one listener for a list, instead of one per row. */
export function delegate(root, selector, event, handler) {
  return on(root, event, (evt) => {
    const match = evt.target instanceof Element ? evt.target.closest(selector) : null;
    if (match && root.contains(match)) handler(evt, match);
  });
}

export function show(node, visible = true) {
  if (node) node.hidden = !visible;
}

export function setText(node, value) {
  if (node) node.textContent = value === null || value === undefined ? '' : String(value);
}

/** Trailing-edge debounce. */
export function debounce(fn, wait = 220) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => timer && clearTimeout(timer);
  return wrapped;
}

/** Coalesces repeated calls into one per animation frame. */
export function raf(fn) {
  let queued = false;
  let lastArgs = [];
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

/**
 * IntersectionObserver-based visibility helper used to lazy-load artwork
 * (section 26). Falls back to "always visible" when the API is unavailable.
 */
export function whenVisible(node, callback, { rootMargin = '200px' } = {}) {
  if (typeof IntersectionObserver === 'undefined') {
    callback();
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          callback();
        }
      }
    },
    { rootMargin }
  );
  observer.observe(node);
  return () => observer.disconnect();
}

/** Announces a message to screen readers without moving focus. */
export function announce(message) {
  const region = document.getElementById('a11y-live');
  if (!region) return;
  region.textContent = '';
  // A microtask delay makes repeat announcements of the same string register.
  setTimeout(() => {
    region.textContent = String(message ?? '');
  }, 40);
}

/**
 * Enables smooth horizontal scrolling with mouse wheel and click-drag on desktop
 * while preserving native high-performance touch scrolling on mobile.
 */
export function enableHorizontalScroll(node) {
  if (!node) return () => {};

  let isDown = false;
  let startX = 0;
  let scrollStart = 0;
  let hasDragged = false;

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    isDown = true;
    hasDragged = false;
    startX = e.pageX - node.offsetLeft;
    scrollStart = node.scrollLeft;
  };

  const onMouseMove = (e) => {
    if (!isDown) return;
    const x = e.pageX - node.offsetLeft;
    const walk = x - startX;
    if (Math.abs(walk) > 4) {
      hasDragged = true;
    }
    node.scrollLeft = scrollStart - walk;
  };

  const onMouseUp = () => {
    isDown = false;
  };

  const onClick = (e) => {
    if (hasDragged) {
      e.preventDefault();
      e.stopPropagation();
      hasDragged = false;
    }
  };

  const onWheel = (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && node.scrollWidth > node.clientWidth) {
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    }
  };

  node.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  node.addEventListener('click', onClick, true);
  node.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    node.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    node.removeEventListener('click', onClick, true);
    node.removeEventListener('wheel', onWheel);
  };
}

export default {
  el,
  append,
  icon,
  qs,
  qsa,
  clear,
  on,
  delegate,
  show,
  setText,
  escapeHtml,
  attr,
  debounce,
  raf,
  whenVisible,
  announce,
  enableHorizontalScroll,
};
