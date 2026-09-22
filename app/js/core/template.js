/**
 * Template loader.
 *
 * HTML stays in .html files under /pages and /components rather than being
 * generated from template strings in JavaScript. This loader fetches each partial
 * once, caches the parsed <template>, and hands back clones filled from a data
 * object.
 *
 * Supported syntax (deliberately minimal):
 *   {{key}}            text or attribute substitution, HTML-escaped
 *   data-if="key"      element removed when the value is falsy
 *   data-role="name"   element is exposed to the caller via `refs`
 *
 * Escaping is unconditional: API metadata must never be able to inject markup.
 */
import { escapeHtml } from './dom.js';

const cache = new Map();

async function load(path) {
  if (cache.has(path)) return cache.get(path);

  const promise = (async () => {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Template ${path} could not be loaded (HTTP ${response.status}).`);
    const markup = await response.text();

    const template = document.createElement('template');
    template.innerHTML = markup.trim();
    return template;
  })();

  cache.set(path, promise);

  try {
    return await promise;
  } catch (error) {
    cache.delete(path);
    throw error;
  }
}

export const templatePath = {
  page: (name) => `pages/${name}.html`,
  component: (name) => `components/${name}.html`,
};

/**
 * Renders a partial into a DocumentFragment.
 *
 * @param {string} path
 * @param {object} [data] values substituted into {{placeholders}}
 * @returns {Promise<{fragment: DocumentFragment, refs: Record<string, HTMLElement>}>}
 */
export async function renderTemplate(path, data = {}) {
  const template = await load(path);
  const fragment = template.content.cloneNode(true);

  // 1. Remove conditionally hidden elements first, so their placeholder tokens
  //    never end up in the output.
  for (const node of fragment.querySelectorAll('[data-if]')) {
    const key = node.getAttribute('data-if');
    const value = data[key];
    if (value === undefined || value === null || value === false || value === '') {
      node.remove();
    } else {
      node.removeAttribute('data-if');
    }
  }

  // 2. Substitute placeholders in text nodes and attributes.
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  const interpolate = (input) =>
    input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
      const value = key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), data);
      return value === undefined || value === null ? '' : escapeHtml(value);
    });

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.includes('{{')) {
      node.nodeValue = interpolate(node.nodeValue);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      for (const attribute of Array.from(node.attributes)) {
        if (attribute.value.includes('{{')) {
          node.setAttribute(attribute.name, interpolate(attribute.value));
        }
      }
    }
  }

  // 3. Collect refs so callers can wire behaviour without querying again.
  const refs = {};
  const refNodes = fragment.querySelectorAll('[data-role]');
  for (const node of refNodes) {
    const role = node.getAttribute('data-role');
    node.removeAttribute('data-role');
    if (!refs[role]) refs[role] = node;
  }

  return { fragment, refs };
}

/** Convenience: render a component partial and return the first element. */
export async function renderComponent(name, data = {}) {
  const { fragment, refs } = await renderTemplate(templatePath.component(name), data);
  const root = fragment.firstElementChild;
  return { root, refs, fragment };
}

export function preloadTemplate(path) {
  return load(path).then(() => undefined).catch(() => undefined);
}

export default { renderTemplate, renderComponent, preloadTemplate, templatePath };
