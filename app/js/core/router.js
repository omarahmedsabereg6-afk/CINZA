/**
 * Hash router.
 *
 * Why hash routing inside a native app: there is no web server to rewrite paths on
 * a Capacitor scheme, so `#/route/param` is the only form that survives a reload and
 * works identically on Android (https://localhost), iOS (capacitor://localhost) and
 * the browser dev server.
 *
 * Each screen is a module with this shape:
 *
 *   export default {
 *     title: 'Home',              // header title, or null to keep the brand
 *     tab: 'home',                // which tab bar item is highlighted
 *     chrome: 'default',          // 'default' | 'fullscreen' (hides tab bar) | 'bare'
 *     views: ['home'],            // page partials to load into .view
 *     async mount({ root, params, refs, partials }) -> cleanup?
 *   }
 *
 * The router guarantees the previous screen's cleanup runs before a new one mounts,
 * so timers, camera streams and event listeners never leak between screens.
 */
import { store, actions } from './store.js';
import { renderTemplate, templatePath, preloadTemplate } from './template.js';
import { clear, announce } from './dom.js';

/** Route table. `pattern` params are `:name` segments. */
const ROUTES = [
  { name: 'home', pattern: '/home', load: () => import('../screens/home.js'), tab: 'home' },
  { name: 'search', pattern: '/search', load: () => import('../screens/search.js'), tab: 'search' },
  { name: 'history', pattern: '/history', load: () => import('../screens/history.js'), tab: 'history' },
  { name: 'watchlist', pattern: '/watchlist', load: () => import('../screens/watchlist.js'), tab: 'watchlist' },
  { name: 'profile', pattern: '/profile', load: () => import('../screens/profile.js'), tab: 'profile' },
  { name: 'settings', pattern: '/settings', load: () => import('../screens/settings.js'), tab: 'profile' },
  { name: 'about', pattern: '/about', load: () => import('../screens/about.js'), tab: 'profile' },
  { name: 'auth', pattern: '/auth', load: () => import('../screens/auth.js'), tab: null, chrome: 'bare' },
  { name: 'camera', pattern: '/camera', load: () => import('../screens/camera.js'), tab: null, chrome: 'fullscreen' },
  { name: 'preview', pattern: '/preview', load: () => import('../screens/preview.js'), tab: null, chrome: 'fullscreen' },
  { name: 'result', pattern: '/result/:id', load: () => import('../screens/result.js'), tab: null },
  { name: 'detail', pattern: '/detail/:mediaType/:tmdbId', load: () => import('../screens/detail.js'), tab: null },
  { name: 'person', pattern: '/person/:id', load: () => import('../screens/person.js'), tab: null },
];

const DEFAULT_ROUTE = 'home';

function matchRoute(path) {
  const [pathname, queryString] = path.split('?');
  const segments = pathname.split('/').filter(Boolean);

  for (const route of ROUTES) {
    const patternSegments = route.pattern.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) continue;

    const params = {};
    if (queryString) {
      const searchParams = new URLSearchParams(queryString);
      for (const [key, val] of searchParams.entries()) {
        params[key] = val;
      }
    }
    let matched = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const pattern = patternSegments[i];
      if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(segments[i]);
      else if (pattern !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || `/${DEFAULT_ROUTE}`;
}

class Router {
  constructor() {
    this.current = null;
    this.cleanup = null;
    this.renderToken = 0;
    this.started = false;
  }

  get view() {
    return document.getElementById('view');
  }

  get headerBar() {
    return document.getElementById('app-header-bar');
  }

  get tabbar() {
    return document.getElementById('tabbar');
  }

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('hashchange', () => this.handle());
    if (!window.location.hash) {
      window.location.hash = `#/${DEFAULT_ROUTE}`;
    } else {
      this.handle();
    }
    // Warm the two most likely next screens so first navigation feels instant.
    preloadTemplate(templatePath.page('result'));
    preloadTemplate(templatePath.page('detail'));
  }

  /** Programmatic navigation. Replaces the hash and lets hashchange do the work. */
  navigate(path, { replace = false } = {}) {
    const target = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
    if (window.location.hash === target) {
      this.handle();
      return;
    }
    if (replace) window.history.replaceState(null, '', target);
    window.location.hash = target;
  }

  back(fallback = '/home') {
    if (window.history.length > 1) window.history.back();
    else this.navigate(fallback, { replace: true });
  }

  async handle() {
    const path = currentPath();
    const matched = matchRoute(path);

    if (!matched) {
      console.warn(`[router] no route for "${path}" — falling back to ${DEFAULT_ROUTE}`);
      this.navigate(DEFAULT_ROUTE, { replace: true });
      return;
    }

    const { route, params } = matched;
    const token = ++this.renderToken;

    // Tear down the previous screen before anything else.
    try {
      this.cleanup?.();
    } catch (error) {
      console.error('[router] cleanup failed', error);
    }
    this.cleanup = null;

    let module;
    try {
      module = (await route.load()).default ?? (await route.load());
    } catch (error) {
      console.error(`[router] failed to load screen "${route.name}"`, error);
      this.view.innerHTML = '';
      this.view.append(
        Object.assign(document.createElement('p'), {
          className: 't-body',
          style: 'padding:24px',
          textContent: 'This screen failed to load. Please restart the app.',
        })
      );
      return;
    }

    const screen = { ...module };
    this.current = { name: route.name, params, screen };

    actions.setRoute({ name: route.name, params });
    this.applyChrome(screen, route);

    // Load the screen's page partials into .view, then hand control to the screen.
    const partialNames = screen.views ?? [route.name];
    const root = clear(this.view);
    const partials = {};

    try {
      for (const partial of partialNames) {
        const { fragment } = await renderTemplate(templatePath.page(partial), {});
        if (token !== this.renderToken) return; // a newer navigation won
        root.append(fragment);
        partials[partial] = root;
      }
    } catch (error) {
      console.error('[router] partial load failed', error);
      root.innerHTML = '';
      root.append(
        Object.assign(document.createElement('p'), {
          className: 't-body',
          style: 'padding:24px',
          textContent: 'We could not open that screen. Please check your connection and try again.',
        })
      );
      return;
    }

    root.scrollTop = 0;

    try {
      const cleanup = await screen.mount?.({ root, params, partials, router: this });
      this.cleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch (error) {
      console.error(`[router] mount failed for "${route.name}"`, error);
    }

    if (screen.title) announce(screen.title);
  }

  /** Applies per-screen chrome: header title, back button, tab bar visibility. */
  applyChrome(screen, route) {
    const bar = this.headerBar;
    clear(bar);

    const needsBack = screen.back !== false && screen.chrome !== 'fullscreen' && !screen.tab && screen.tab !== undefined;
    const showBack = screen.showBack ?? needsBack;

    if (showBack) {
      const back = document.createElement('button');
      back.className = 'icon-btn icon-btn--plain';
      back.type = 'button';
      back.setAttribute('aria-label', 'Go back');
      back.innerHTML = '<svg aria-hidden="true"><use href="#i-back"></use></svg>';
      back.addEventListener('click', () => this.back());
      bar.append(back);
    }

    if (screen.title) {
      const title = document.createElement('span');
      title.className = 'app-header__title';
      title.textContent = screen.title;
      bar.append(title);
    } else {
      const brand = document.createElement('div');
      brand.className = 'app-header__brand';
      brand.innerHTML =
        '<svg class="app-header__logo" aria-hidden="true"><use href="#i-cinza-mark"></use></svg>' +
        '<span class="app-header__name">Cinza</span>';
      bar.append(brand);
    }

    const spacer = document.createElement('span');
    spacer.className = 'app-header__spacer';
    bar.append(spacer);

    if (screen.headerActions) {
      for (const action of screen.headerActions) {
        const button = document.createElement('button');
        button.className = 'icon-btn icon-btn--plain';
        button.type = 'button';
        button.setAttribute('aria-label', action.label);
        button.innerHTML = `<svg aria-hidden="true"><use href="#${action.icon}"></use></svg>`;
        if (action.href) {
          button.addEventListener('click', () => this.navigate(action.href));
        } else {
          button.addEventListener('click', () => action.onClick?.());
        }
        bar.append(button);
      }
    }

    const header = document.getElementById('app-header');
    header.hidden = screen.chrome === 'fullscreen';
    header.classList.toggle('app-header--solid', Boolean(screen.title));

    this.tabbar.hidden = screen.chrome === 'fullscreen' || screen.chrome === 'bare' || !screen.tab;
    this.view.classList.toggle('view--flush', screen.chrome === 'fullscreen');

    /* Highlight the tab HERE, not after `await screen.mount()`.
       mount() awaits partial loads and screen data, so doing it later left the tab
       bar pointing at the PREVIOUS screen while the header already showed the new
       one — briefly on a local catalog, and much longer when mount() has to wait on
       the network. Chrome must change as one atomic step. */
    this.updateTabbar(route.tab ?? screen.tab ?? null);
  }

  updateTabbar(tabName) {
    for (const item of this.tabbar.querySelectorAll('[data-tab]')) {
      if (item.dataset.tab === tabName) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    store.set({});
  }
}

export const router = new Router();
export default router;
