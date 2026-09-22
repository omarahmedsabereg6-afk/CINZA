/**
 * PROFILE screen.
 *
 * A polished personal hub for cinema lovers:
 * - User identity card (or inviting Guest mode banner)
 * - 3 Interactive stat cards (Watchlist, Recognitions, Search Picks)
 * - My Collection shortcuts
 * - Preferences & Settings hub link
 * - Account management (display name editing, sessions, sign out)
 * - Privacy & About info
 * - Isolated destructive actions with double confirmation
 */
import { el, qs, on, clear, icon } from '../core/dom.js';
import { router } from '../core/router.js';
import { store, actions } from '../core/store.js';
import { toast, toastError, confirm, hapticImpact, actionSheet, openSheet } from '../core/feedback.js';
import * as auth from '../services/auth.js';
import * as settings from '../services/settings.js';
import * as watchlistService from '../services/watchlist.js';
import * as historyService from '../services/history.js';
import * as catalog from '../services/catalog.js';
import { getCapabilities } from '../services/capabilities.js';
import { KNOWN_COUNTRIES, countryName, countryFlag, toCountryCode } from '../core/countries.js';
import { initials } from '../core/format.js';
import config from '../config.js';

export default {
  title: 'Profile',
  tab: 'profile',

  async mount({ root }) {
    const headSlot = qs('#profile-head-slot', root);
    const statsSlot = qs('#profile-stats-slot', root);
    const bodySlot = qs('#profile-body-slot', root);
    const version = qs('#profile-version', root);

    let stats = {
      watchlistCount: 0,
      recognitionsCount: 0,
      searchPicksCount: 0,
    };

    renderShell();
    renderStats();
    renderBody();
    await loadData();

    async function loadData() {
      const session = store.getState().session;
      const authenticated = session.status === 'authenticated';

      try {
        const [wlResult, histResult] = await Promise.allSettled([
          watchlistService.list().catch(() => ({ total: 0 })),
          authenticated ? historyService.stats() : Promise.resolve({ total: historyService.localItems().length }),
        ]);

        const wlTotal = wlResult.status === 'fulfilled' ? (wlResult.value?.total ?? wlResult.value?.items?.length ?? 0) : 0;
        const histTotal = histResult.status === 'fulfilled' ? (histResult.value?.total ?? historyService.localItems().length ?? 0) : historyService.localItems().length;
        const searchTotal = catalog.selectedHistory().length;

        stats = {
          watchlistCount: wlTotal,
          recognitionsCount: histTotal,
          searchPicksCount: searchTotal,
        };

        renderShell();
        renderStats();
        renderBody();
      } catch (err) {
        console.warn('[profile] failed to load stats', err);
      }
    }

    /* ------------------------------------------------------------------ *
     * Shell (Header / Identity Card)
     * ------------------------------------------------------------------ */
    function renderShell() {
      clear(headSlot);
      const session = store.getState().session;
      const authenticated = session.status === 'authenticated';
      const user = session.user || {};
      const currentRegion = settings.getRegion();

      const headCard = el('div', { class: 'profile-head' });

      if (authenticated) {
        // User avatar with initials
        const avatar = el('div', { class: 'profile-avatar' });
        if (user.avatarColor) avatar.style.background = user.avatarColor;
        avatar.textContent = initials(user.displayName ?? user.name ?? user.email ?? 'U');
        headCard.append(avatar);

        // User info column
        const infoCol = el('div', { style: { flex: '1 1 auto', minWidth: '0' } });
        const nameRow = el('div', { class: 'profile-name' });
        nameRow.append(
          el('span', { text: user.displayName || user.name || 'CINZA Member' }),
          el('button', {
            class: 'icon-btn icon-btn--plain',
            type: 'button',
            style: { width: '26px', height: '26px', padding: '0', color: 'var(--c-text-3)' },
            title: 'Edit display name',
            onClick: editDisplayName,
          }, [icon('i-text')])
        );

        const emailRow = el('div', {
          class: 'profile-sub',
          text: user.email || 'Member account',
        });

        const badgesRow = el('div', { class: 'profile-badges' });
        badgesRow.append(
          el('span', { class: 'profile-badge profile-badge--ok', text: '● Synced' }),
          el('span', { class: 'profile-badge', text: `${countryFlag(currentRegion)} ${currentRegion}` }),
          el('span', { class: 'profile-badge', text: user.role === 'admin' ? 'Admin' : 'Member' })
        );

        infoCol.append(nameRow, emailRow, badgesRow);
        headCard.append(infoCol);
      } else {
        // Guest mode card
        const guestAvatar = el('div', {
          class: 'profile-avatar',
          style: {
            background: 'var(--c-surface-3)',
            color: 'var(--c-text-2)',
            border: '2px solid var(--c-line-strong)',
          },
        }, [icon('i-user')]);
        headCard.append(guestAvatar);

        const guestInfo = el('div', { style: { flex: '1 1 auto', minWidth: '0' } });
        guestInfo.append(
          el('div', { class: 'profile-name', text: 'Guest Explorer' }),
          el('div', {
            class: 'profile-sub',
            text: 'Your watchlist and history are saved on this phone. Sign in to sync across devices.',
          })
        );
        headCard.append(guestInfo);

        const signInBtn = el('button', {
          class: 'btn btn--primary btn--sm',
          type: 'button',
          style: { flexShrink: '0', whiteSpace: 'nowrap' },
          text: 'Sign In',
        });
        on(signInBtn, 'click', () => {
          hapticImpact('light');
          router.navigate('/auth');
        });
        headCard.append(signInBtn);
      }

      headSlot.append(headCard);

      if (version) {
        version.textContent = `CINZA v1.2.0 • ${config.build}`;
      }
    }

    /* ------------------------------------------------------------------ *
     * Interactive Stat Cards
     * ------------------------------------------------------------------ */
    function renderStats() {
      clear(statsSlot);
      const statsRow = el('div', { class: 'profile-stats' });

      function createStatButton(iconName, value, label, onClick) {
        const btn = el('button', {
          class: 'stat',
          type: 'button',
        });
        btn.append(
          el('span', { class: 'stat__icon' }, [icon(iconName)]),
          el('strong', { class: 'stat__value', text: String(value ?? 0) }),
          el('span', { class: 'stat__label', text: label })
        );
        on(btn, 'click', () => {
          hapticImpact('light');
          onClick?.();
        });
        return btn;
      }

      statsRow.append(
        createStatButton('i-bookmark', stats.watchlistCount, 'Watchlist', () => router.navigate('/watchlist')),
        createStatButton('i-sparkle', stats.recognitionsCount, 'Recognitions', () => router.navigate('/history')),
        createStatButton('i-search', stats.searchPicksCount, 'Search Picks', () => router.navigate('/search'))
      );

      statsSlot.append(statsRow);
    }

    /* ------------------------------------------------------------------ *
     * Section Groups
     * ------------------------------------------------------------------ */
    function row({ iconName, title, sub, value, onClick, danger = false, rightBadge = null }) {
      const node = el('button', {
        class: `list-row${danger ? ' list-row--danger' : ''}`,
        type: 'button',
      });
      if (iconName) node.append(el('span', { class: 'list-row__icon' }, [icon(iconName)]));

      const textCol = el('span', { class: 'list-row__text' }, [
        el('span', { class: 'list-row__title', text: title }),
        sub ? el('span', { class: 'list-row__sub', text: sub }) : null,
      ].filter(Boolean));
      node.append(textCol);

      if (rightBadge) {
        node.append(el('span', { class: 'badge', text: String(rightBadge) }));
      }
      if (value !== undefined && value !== null && value !== '') {
        node.append(el('span', { class: 'list-row__value', text: String(value) }));
      }
      if (onClick) {
        node.append(el('span', { class: 'list-row__chevron' }, [icon('i-chevron-right')]));
        on(node, 'click', (e) => {
          e.preventDefault();
          hapticImpact('light');
          onClick();
        });
      }
      return node;
    }

    function section(title, node, description) {
      const wrapper = el('section', { style: { marginBottom: '22px' } });
      wrapper.append(el('h2', { class: 'search-group__label', text: title }));
      if (description) {
        wrapper.append(el('p', { class: 't-meta', style: { marginBottom: '8px' }, text: description }));
      }
      wrapper.append(node);
      return wrapper;
    }

    function renderBody() {
      clear(bodySlot);
      const session = store.getState().session;
      const authenticated = session.status === 'authenticated';
      const user = session.user || {};
      const currentRegion = settings.getRegion();
      const regionDisplay = `${countryFlag(currentRegion)} ${countryName(currentRegion)}`;
      const themeLabel = { dark: 'Dark', light: 'Light', system: 'System' }[settings.getTheme()] ?? 'Dark';

      /* --- 1. My Collection & Activity --- */
      const collectionGroup = el('div', { class: 'list-group' });
      collectionGroup.append(
        row({
          iconName: 'i-bookmark',
          title: 'Watchlist',
          sub: authenticated ? 'Synced with your cloud account' : 'Saved locally on this device',
          value: `${stats.watchlistCount} title${stats.watchlistCount === 1 ? '' : 's'}`,
          onClick: () => router.navigate('/watchlist'),
        }),
        row({
          iconName: 'i-history',
          title: 'Recognition History',
          sub: authenticated ? 'AI visual recognition matches' : 'Local recognition scans',
          value: `${stats.recognitionsCount} scan${stats.recognitionsCount === 1 ? '' : 's'}`,
          onClick: () => router.navigate('/history'),
        }),
        row({
          iconName: 'i-search',
          title: 'Search & Pick History',
          sub: 'Titles and artists selected from search',
          value: `${stats.searchPicksCount} item${stats.searchPicksCount === 1 ? '' : 's'}`,
          onClick: () => router.navigate('/search'),
        })
      );
      bodySlot.append(section('My Collection', collectionGroup));

      /* --- 2. Preferences & Settings --- */
      const preferencesGroup = el('div', { class: 'list-group' });
      preferencesGroup.append(
        row({
          iconName: 'i-sliders',
          title: 'Settings Hub',
          sub: 'Streaming filters, AI quality, SafeSearch, and storage',
          value: 'Manage',
          onClick: () => router.navigate('/settings'),
        }),
        row({
          iconName: 'i-globe',
          title: 'Watch Region',
          sub: 'Changes where-to-watch legal streaming availability',
          value: regionDisplay,
          onClick: pickRegion,
        }),
        row({
          iconName: 'i-moon',
          title: 'Appearance Theme',
          sub: 'Cinema-tuned dark, light, or match system',
          value: themeLabel,
          onClick: pickTheme,
        }),
        row({
          iconName: 'i-bell',
          title: 'Notifications & Alerts',
          sub: 'Availability updates and movie alerts',
          value: settings.getNotifications() ? 'On' : 'Off',
          onClick: toggleNotifications,
        })
      );
      bodySlot.append(section('Preferences', preferencesGroup));

      /* --- 3. Account & Security (Authenticated) --- */
      if (authenticated) {
        const accountGroup = el('div', { class: 'list-group' });
        accountGroup.append(
          row({
            iconName: 'i-user',
            title: 'Display Name',
            sub: 'Change your public member name',
            value: user.displayName || user.name || 'Set Name',
            onClick: editDisplayName,
          }),
          row({
            iconName: 'i-lock',
            title: 'Security & Device Session',
            sub: 'View token storage and device authorization',
            onClick: accountSecuritySheet,
          }),
          row({
            iconName: 'i-users',
            title: 'Sign Out Everywhere',
            sub: 'End sessions on all devices',
            onClick: signOutEverywhere,
          }),
          row({
            iconName: 'i-logout',
            title: 'Sign Out',
            sub: 'Sign out of your account on this device',
            onClick: signOut,
          })
        );
        bodySlot.append(section('Account & Security', accountGroup));
      } else {
        const authCardGroup = el('div', { class: 'list-group' });
        authCardGroup.append(
          row({
            iconName: 'i-user',
            title: 'Create Account or Sign In',
            sub: 'Save your collection to the cloud and access it anywhere',
            onClick: () => router.navigate('/auth'),
          })
        );
        bodySlot.append(section('Account', authCardGroup));
      }

      /* --- 4. About & Privacy --- */
      const aboutGroup = el('div', { class: 'list-group' });
      aboutGroup.append(
        row({
          iconName: 'i-info',
          title: 'About CINZA',
          sub: 'Vision AI, TMDB catalog & streaming engine',
          value: 'v1.2.0',
          onClick: () => router.navigate('/about'),
        }),
        row({
          iconName: 'i-shield',
          title: 'Privacy & Data Protection',
          sub: 'On-device hashing and zero-disk image guarantees',
          onClick: showPrivacy,
        })
      );
      bodySlot.append(section('About CINZA', aboutGroup));

      /* --- 5. Danger Zone (Authenticated) --- */
      if (authenticated) {
        const dangerGroup = el('div', { class: 'list-group' });
        dangerGroup.append(
          row({
            iconName: 'i-trash',
            title: 'Delete Account',
            sub: 'Permanently remove your account, cloud watchlist, and history',
            danger: true,
            onClick: deleteAccount,
          })
        );
        bodySlot.append(section('Danger Zone', dangerGroup));
      }
    }

    /* ------------------------------------------------------------------ *
     * Actions & Sheets
     * ------------------------------------------------------------------ */

    /** Edit display name */
    function editDisplayName() {
      const session = store.getState().session;
      const currentName = session.user?.displayName || session.user?.name || '';

      const input = el('input', {
        class: 'field',
        type: 'text',
        value: currentName,
        placeholder: 'Enter your name...',
        maxlength: '60',
        style: { width: '100%', marginBottom: '14px' },
      });

      openSheet({
        title: 'Edit Display Name',
        content: [
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)' },
            text: 'This name will appear on your profile and device sync.',
          }),
          input,
        ],
        actions: [
          {
            label: 'Save Name',
            variant: 'primary',
            onClick: async () => {
              const val = input.value.trim();
              if (!val) {
                toast('Please enter a valid name.', { variant: 'warn' });
                return;
              }
              document.querySelector('.scrim')?.click();
              try {
                await auth.updateProfile({ displayName: val });
                hapticImpact('medium');
                toast('Display name updated.', { variant: 'success' });
                renderShell();
                renderBody();
              } catch (err) {
                toast(err?.message || 'Failed to update name.', { variant: 'error' });
              }
            },
          },
          {
            label: 'Cancel',
            variant: 'ghost',
            onClick: () => document.querySelector('.scrim')?.click(),
          },
        ],
      });

      setTimeout(() => input.focus(), 60);
    }

    /** Quick region selector with live search */
    function pickRegion() {
      const caps = getCapabilities();
      const currentCode = settings.getRegion();

      const countryMap = new Map();
      for (const c of KNOWN_COUNTRIES) {
        countryMap.set(c.code.toUpperCase(), {
          code: c.code.toUpperCase(),
          name: c.name,
          flag: countryFlag(c.code),
        });
      }
      for (const r of caps.regions ?? []) {
        const code = (r.code || '').toUpperCase();
        if (!countryMap.has(code) && code) {
          countryMap.set(code, {
            code,
            name: r.name || countryName(code),
            flag: countryFlag(code),
          });
        }
      }

      const allCountries = Array.from(countryMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      const searchInput = el('input', {
        class: 'field',
        type: 'search',
        placeholder: 'Search country or code (e.g. Egypt, US, France)...',
        style: { marginBottom: '14px', width: '100%' },
      });

      const listContainer = el('div', {
        style: { maxHeight: '48vh', overflowY: 'auto' },
      });

      function renderFilteredList(query = '') {
        clear(listContainer);
        const q = query.trim().toLowerCase();
        const matches = allCountries.filter((c) => {
          if (!q) return true;
          return (
            c.name.toLowerCase().includes(q) ||
            c.code.toLowerCase().includes(q) ||
            toCountryCode(q) === c.code
          );
        });

        if (matches.length === 0) {
          listContainer.append(
            el('div', {
              style: { textAlign: 'center', padding: '24px 16px', color: 'var(--c-text-3)' },
              text: 'No matching countries found.',
            })
          );
          return;
        }

        for (const country of matches) {
          const isSelected = country.code === currentCode;
          const node = el('button', {
            class: 'list-row',
            type: 'button',
            style: {
              borderRadius: '12px',
              background: isSelected ? 'var(--c-accent-soft)' : 'transparent',
              marginBottom: '2px',
            },
          });

          node.append(
            el('span', { style: { fontSize: '22px', marginRight: '12px', lineHeight: '1' }, text: country.flag }),
            el('span', { class: 'list-row__text' }, [
              el('span', { class: 'list-row__title', style: { fontWeight: isSelected ? '700' : '500' }, text: country.name }),
            ]),
            el('span', { class: 'badge', text: country.code })
          );

          if (isSelected) {
            node.append(el('span', { style: { color: 'var(--c-accent)', marginLeft: '8px' } }, [icon('i-check')]));
          }

          on(node, 'click', async () => {
            document.querySelector('.scrim')?.click();
            await settings.setRegion(country.code);
            catalog.invalidateAll();
            hapticImpact('medium');
            toast(`Watch region set to ${country.flag} ${country.name} (${country.code}).`, { variant: 'success' });
            renderShell();
            renderBody();
          });

          listContainer.append(node);
        }
      }

      on(searchInput, 'input', () => renderFilteredList(searchInput.value));
      renderFilteredList();

      openSheet({
        title: 'Watch Region',
        content: [
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)' },
            text: 'Select your country to display legal streaming providers for your region.',
          }),
          searchInput,
          listContainer,
        ],
      });

      setTimeout(() => searchInput.focus(), 60);
    }

    /** Theme picker */
    async function pickTheme() {
      const choice = await actionSheet({
        title: 'Appearance Theme',
        actions: [
          { label: 'Dark (Default Cinematic)', icon: 'i-moon', value: 'dark' },
          { label: 'Light', icon: 'i-sun', value: 'light' },
          { label: 'Match System Setting', icon: 'i-moon', value: 'system' },
        ],
      });
      if (!choice) return;
      await settings.setTheme(choice);
      renderBody();
    }

    /** Toggle notifications */
    async function toggleNotifications() {
      const next = !settings.getNotifications();
      await settings.setNotifications(next);
      hapticImpact('light');
      toast(next ? 'Notifications enabled.' : 'Notifications disabled.', { variant: 'info' });
      renderBody();
    }

    /** Security & Account sheet */
    function accountSecuritySheet() {
      const session = store.getState().session;
      const user = session.user || {};

      openSheet({
        title: 'Security & Device Authorization',
        content: el('div', { class: 'list-group' }, [
          el('div', { class: 'list-row' }, [
            el('span', { class: 'list-row__text' }, [
              el('span', { class: 'list-row__title', text: 'Account Email' }),
              el('span', { class: 'list-row__sub', text: user.email || '—' }),
            ]),
          ]),
          el('div', { class: 'list-row' }, [
            el('span', { class: 'list-row__text' }, [
              el('span', { class: 'list-row__title', text: 'Token Security' }),
              el('span', { class: 'list-row__sub', text: config.isNative ? 'Capacitor Secure Storage (Keystore / Keychain)' : 'Browser Encrypted Session Store' }),
            ]),
          ]),
          el('div', { class: 'list-row' }, [
            el('span', { class: 'list-row__text' }, [
              el('span', { class: 'list-row__title', text: 'Device Platform' }),
              el('span', { class: 'list-row__sub', text: `${config.platform} (${config.isNative ? 'Native' : 'Web'})` }),
            ]),
          ]),
        ]),
        actions: [
          {
            label: 'Close',
            variant: 'ghost',
            onClick: () => document.querySelector('.scrim')?.click(),
          },
        ],
      });
    }

    /** Show Privacy sheet */
    function showPrivacy() {
      openSheet({
        title: 'Privacy & Data Protection',
        content: el('div', {}, [
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)', lineHeight: '1.5' },
            text: 'CINZA respects your privacy. Photos and camera frames are downscaled and hashed on your device. Only irreversible perceptual hashes and compressed thumbnails are stored with your history.',
          }),
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)', lineHeight: '1.5' },
            text: 'Anonymous users store recognition history exclusively on the device without transmitting personal identity. Signed-in users have their history encrypted and synced to their personal account.',
          }),
          el('p', {
            class: 't-body',
            style: { color: 'var(--c-text-2)', lineHeight: '1.5' },
            text: 'API keys, database credentials, and recognition tokens stay safely on the backend server and are never exposed to the client.',
          }),
        ]),
      });
    }

    /** Sign Out */
    async function signOut() {
      const ok = await confirm({
        title: 'Sign Out?',
        message: 'Your watchlist and history will remain safely backed up on your account and will sync back when you sign in again.',
        confirmLabel: 'Sign Out',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;

      hapticImpact('medium');
      try {
        await auth.logout();
        toast('Signed out successfully.', { variant: 'info' });
        actions.touchHistory();
        actions.touchWatchlist();
        await loadData();
      } catch (err) {
        toastError(err);
      }
    }

    /** Sign Out Everywhere */
    async function signOutEverywhere() {
      const ok = await confirm({
        title: 'Sign Out Everywhere?',
        message: 'This will invalidate active sessions across all your phones, tablets, and web browsers.',
        confirmLabel: 'Sign Out All Devices',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return;

      hapticImpact('medium');
      try {
        await auth.logout({ everywhere: true });
        toast('Signed out on all devices.', { variant: 'info' });
        await loadData();
      } catch (err) {
        toastError(err);
      }
    }

    /** Delete Account */
    async function deleteAccount() {
      const first = await confirm({
        title: 'Delete Account?',
        message: 'This will permanently delete your account, your entire watchlist, and synced recognition history. This cannot be undone.',
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!first) return;

      const second = await confirm({
        title: 'Permanent Deletion',
        message: 'Are you absolutely sure? All your data will be permanently wiped from CINZA servers.',
        confirmLabel: 'Delete Permanently',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!second) return;

      try {
        await auth.deleteAccount();
        hapticImpact('heavy');
        toast('Account deleted.', { variant: 'warn' });
        actions.touchHistory();
        actions.touchWatchlist();
        await loadData();
      } catch (err) {
        toast(err?.message || 'Failed to delete account.', { variant: 'error' });
      }
    }

    /* ------------------------------------------------------------------ *
     * Subscriptions & Cleanup
     * ------------------------------------------------------------------ */
    const disposers = [
      store.subscribe(['session'], () => {
        renderShell();
        renderBody();
      }),
      store.subscribe(['watchlist', 'history'], () => {
        loadData();
      }),
    ];

    return () => disposers.forEach((dispose) => dispose?.());
  },
};
