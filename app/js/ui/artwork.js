/**
 * Artwork rendering.
 *
 * Two rules that matter for honesty and performance:
 *
 *  1. NO ARTWORK IS INVENTED. In mock mode the catalog ships no posters (by
 *     design — see backend fixtures), so instead of a stock image the app draws a
 *     generated placeholder from the title itself. It is obviously a placeholder,
 *     which is more truthful than stand-in artwork.
 *
 *  2. ARTWORK IS LAZY. Images load only when scrolled near the viewport
 *     (section 26), and a broken/expired TMDB URL falls back to the same
 *     placeholder rather than showing a broken image icon.
 */
import { el, icon, whenVisible } from '../core/dom.js';
import { initials } from '../core/format.js';

/** Deterministic hue per title, so a given film always gets the same tint. */
function hueFor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

export function placeholder({ title = '', ratio = '2 / 3', compact = false } = {}) {
  const node = el('span', { class: compact ? 'poster-ph poster-ph--compact' : 'poster-ph' });
  node.style.background = `linear-gradient(155deg, hsl(${hueFor(title)} 22% 15%), var(--c-bg-elev) 72%)`;
  node.style.aspectRatio = ratio;

  node.append(el('span', { class: 'poster-ph__text', text: title || 'No artwork' }));

  const mark = icon('i-cinza-mark');
  mark.classList.add('poster-ph__mark');
  node.append(mark);

  return node;
}

/**
 * Mounts artwork into a container, with lazy loading and placeholder fallback.
 *
 * @param {HTMLElement} container
 * @param {object} input
 * @param {string|null} input.url
 * @param {string} input.title
 * @param {string} [input.alt]
 */
export function mountArtwork(container, { url, title = '', alt = '', compact = false } = {}) {
  container.textContent = '';

  if (!url) {
    container.append(placeholder({ title, compact }));
    return;
  }

  const img = el('img', {
    alt: alt || (title ? `${title} artwork` : ''),
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
  });
  img.style.opacity = '0';
  img.style.transition = 'opacity var(--dur-base) var(--ease-out)';

  img.addEventListener('load', () => {
    img.style.opacity = '1';
  });

  img.addEventListener('error', () => {
    // Expired TMDB path, offline, or a blocked referrer: show the placeholder.
    img.remove();
    container.append(placeholder({ title, compact }));
  });

  whenVisible(container, () => {
    img.src = url;
  });

  container.append(img);
}

/** Round avatar with initials fallback (used for cast and the profile header). */
export function mountAvatar(container, { url, name = '' } = {}) {
  container.textContent = '';
  if (!url) {
    container.textContent = initials(name);
    return;
  }
  const img = el('img', { alt: name ? `${name} portrait` : '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    img.remove();
    container.textContent = initials(name);
  });
  whenVisible(container, () => {
    img.src = url;
  });
  container.append(img);
}

export { icon };
export default { mountArtwork, mountAvatar, placeholder };
