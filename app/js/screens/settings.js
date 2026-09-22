/**
 * SETTINGS screen.
 *
 * A comprehensive native-style preferences and configuration hub:
 * - Streaming & Region availability (live search country picker, watch provider filters)
 * - Recognition & AI intelligence (upload quality, sensitivity, server specs)
 * - Content & Search (search history manager, SafeSearch, spoiler protection)
 * - Appearance & Feedback (theme, language, haptic feedback, reduce motion)
 * - Notifications & Availability alerts
 * - Storage & Cache management (usage estimation, cache cleaner, factory reset)
 * - Account & Cloud sync status
 * - Diagnostics & API endpoints
 */
import { el, qs, on, clear, icon } from '../core/dom.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { toast, hapticImpact, openSheet, actionSheet, confirm } from '../core/feedback.js';
import * as settings from '../services/settings.js';
import * as catalog from '../services/catalog.js';
import * as historyService from '../services/history.js';
import { getCapabilities } from '../services/capabilities.js';
import { KNOWN_COUNTRIES, countryName, countryFlag, toCountryCode } from '../core/countries.js';
import config, { clearApiBase, saveApiBase } from '../config.js';
import auth from '../services/auth.js';

export default {
  title: 'Settings',
  tab: 'profile',
  showBack: true,

  async mount({ root }) {
    const body = qs('#settings-body', root);
    render();

    /* ------------------------------------------------------------------ *
     * Row builders
     * ------------------------------------------------------------------ */
    function row({ iconName, title, sub, value, onClick, danger = false, rightBadge = null }) {
      const node = el('button', {
        class: `list-row ${danger ? 'list-row--danger' : ''}`,
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
      if (value) {
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

    function toggleRow({ iconName, title, sub, checked, onToggle, danger = false }) {
      const node = el('div', {
        class: `list-row ${danger ? 'list-row--danger' : ''}`,
        style: { cursor: 'pointer' },
      });
      if (iconName) node.append(el('span', { class: 'list-row__icon' }, [icon(iconName)]));

      const textCol = el('span', { class: 'list-row__text' }, [
        el('span', { class: 'list-row__title', text: title }),
        sub ? el('span', { class: 'list-row__sub', text: sub }) : null,
      ].filter(Boolean));
      node.append(textCol);

      const sw = el('button', {
        class: 'switch',
        type: 'button',
        role: 'switch',
        'aria-checked': String(checked),
        'aria-label': title,
      });
      node.append(sw);

      const handleToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hapticImpact('light');
        const next = !checked;
        sw.setAttribute('aria-checked', String(next));
        onToggle?.(next);
      };

      on(node, 'click', handleToggle);
      return node;
    }

    function infoRow(label, value, sub = null) {
      const node = el('div', { class: 'list-row' });
      const textCol = el('span', { class: 'list-row__text' }, [
        el('span', { class: 'list-row__title', text: label }),
        sub ? el('span', { class: 'list-row__sub', text: sub }) : null,
      ].filter(Boolean));
      node.append(
        textCol,
        el('span', {
          class: 'list-row__value',
          text: String(value),
          style: { maxWidth: '55%', textAlign: 'right', wordBreak: 'break-word' },
        })
      );
      return node;
    }

    function section(title, node, description) {
      const wrapper = el('section', { style: { marginBottom: '24px' } });
      wrapper.append(el('h2', { class: 'search-group__label', text: title }));
      if (description) {
        wrapper.append(el('p', { class: 't-meta', style: { marginBottom: '10px' }, text: description }));
      }
      wrapper.append(node);
      return wrapper;
    }

    /* ------------------------------------------------------------------ *
     * Main Screen Render
     * ------------------------------------------------------------------ */
    function render() {
      clear(body);
      const caps = getCapabilities();
      const session = store.getState().session;
      const currentRegion = settings.getRegion();
      const regionLabel = `${countryFlag(currentRegion)} ${countryName(currentRegion)} (${currentRegion})`;

      /* 1. Account & Cloud Sync */
      const accountGroup = el('div', { class: 'list-group' });
      if (session.status === 'authenticated') {
        const user = session.user || {};
        accountGroup.append(
          el('div', { class: 'list-row', style: { padding: '14px 12px' } }, [
            el('div', {
              style: {
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: 'var(--c-accent)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: '700',
                fontSize: '18px',
                flexShrink: 0,
              },
              text: (user.name || user.email || 'U').slice(0, 1).toUpperCase(),
            }),
            el('div', { class: 'list-row__text', style: { marginLeft: '12px' } }, [
              el('div', { class: 'list-row__title', text: user.name || user.email || 'CINZA Member' }),
              el('div', { class: 'list-row__sub', style: { color: 'var(--c-ok)', display: 'flex', alignItems: 'center', gap: '5px' } }, [
                el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--c-ok)', display: 'inline-block' } }),
                el('span', { text: 'Synced with Cloud' }),
              ]),
            ]),
          ]),
          row({
            iconName: 'i-logout',
            title: 'Sign Out',
            sub: 'Sign out on this device',
            onClick: handleSignOut,
          }),
          row({
            iconName: 'i-trash',
            title: 'Delete Account',
            sub: 'Permanently remove your account and synced data',
            danger: true,
            onClick: handleDeleteAccount,
          })
        );
        body.append(section('Account', accountGroup));
      } else {
        accountGroup.append(
          el('div', { class: 'list-row', style: { padding: '14px 12px', alignItems: 'flex-start' } }, [
            el('span', { class: 'list-row__icon', style: { marginTop: '2px' } }, [icon('i-user')]),
            el('div', { class: 'list-row__text', style: { marginLeft: '8px' } }, [
              el('div', { class: 'list-row__title', text: 'Guest Mode' }),
              el('div', {
                class: 'list-row__sub',
                text: 'Sign in or register to backup your Watchlist and Recognition History to the cloud.',
              }),
            ]),
          ]),
          row({
            iconName: 'i-user',
            title: 'Sign In or Register',
            sub: 'Sync your data across all your devices',
            onClick: () => router.navigate('/auth'),
          })
        );
        body.append(section('Account & Sync', accountGroup));
      }

      /* 2. Streaming & Availability */
      const streamingFiltersMap = {
        all: 'All Providers',
        flatrate: 'Subscription Only',
        free: 'Free & Ad-Supported',
        buy_rent: 'Rent & Buy',
      };
      const streamingGroup = el('div', { class: 'list-group' });
      streamingGroup.append(
        row({
          iconName: 'i-globe',
          title: 'Watch Region',
          sub: 'Drives which legal streaming providers are displayed',
          value: regionLabel,
          onClick: pickRegion,
        }),
        row({
          iconName: 'i-film',
          title: 'Streaming Filter',
          sub: 'Filter displayed provider tiers across movies and shows',
          value: streamingFiltersMap[settings.getStreamingFilter()] ?? 'All Providers',
          onClick: pickStreamingFilter,
        })
      );
      body.append(section('Streaming & Availability', streamingGroup, 'Availability data is loaded directly for your country using TMDB Watch Providers.'));

      /* 3. Recognition & AI Intelligence */
      const qualityMap = {
        high: 'High (1080p)',
        balanced: 'Balanced (720p)',
        saver: 'Data Saver (480p)',
      };
      const sensitivityMap = {
        strict: 'Strict',
        balanced: 'Balanced',
        relaxed: 'Relaxed',
      };
      const recognitionGroup = el('div', { class: 'list-group' });
      recognitionGroup.append(
        row({
          iconName: 'i-sliders',
          title: 'Image Upload Quality',
          sub: 'Resolution and compression used during scene recognition',
          value: qualityMap[settings.getUploadQuality()] ?? 'Balanced',
          onClick: pickUploadQuality,
        }),
        row({
          iconName: 'i-sparkle',
          title: 'Matching Sensitivity',
          sub: 'Threshold for accepting AI scene candidates',
          value: sensitivityMap[settings.getMatchingSensitivity()] ?? 'Balanced',
          onClick: pickMatchingSensitivity,
        }),
        row({
          iconName: 'i-info',
          title: 'Server AI Specs & Limits',
          sub: 'View models, hashes, and upload constraints',
          onClick: viewServerAiLimits,
        })
      );
      body.append(section('Recognition & AI', recognitionGroup));

      /* 4. Content & Search */
      const selectedHistoryItems = catalog.selectedHistory();
      const contentGroup = el('div', { class: 'list-group' });
      contentGroup.append(
        row({
          iconName: 'i-history',
          title: 'Search & Pick History',
          sub: 'Titles you viewed or selected from search',
          value: `${selectedHistoryItems.length} title${selectedHistoryItems.length === 1 ? '' : 's'}`,
          onClick: manageSearchHistory,
        }),
        toggleRow({
          iconName: 'i-shield',
          title: 'SafeSearch (18+)',
          sub: 'Filter adult and explicit content from catalog & search',
          checked: settings.getSafeSearch(),
          onToggle: async (val) => {
            settings.setSafeSearch(val);
            catalog.invalidateAll();
            toast(val ? 'SafeSearch enabled: adult titles filtered.' : 'SafeSearch disabled: all titles included.', { variant: 'info' });
            render();
          },
        }),
        toggleRow({
          iconName: 'i-eye',
          title: 'Spoiler Protection',
          sub: 'Conceal plot twists and synopses on unreleased titles',
          checked: settings.getSpoilerProtection(),
          onToggle: async (val) => {
            settings.setSpoilerProtection(val);
            toast(val ? 'Spoiler protection enabled.' : 'Spoiler protection disabled.', { variant: 'info' });
            render();
          },
        })
      );
      body.append(section('Content & Search', contentGroup));

      /* 5. Appearance & Feedback */
      const themeMap = {
        dark: 'Dark',
        light: 'Light',
        system: 'System',
      };
      const appearanceGroup = el('div', { class: 'list-group' });
      appearanceGroup.append(
        row({
          iconName: 'i-moon',
          title: 'Appearance Theme',
          sub: 'Dark is optimized for cinema artwork and dim rooms',
          value: themeMap[settings.getTheme()] ?? 'Dark',
          onClick: pickTheme,
        }),
        row({
          iconName: 'i-globe',
          title: 'Metadata Language',
          sub: 'Database language for titles, overviews, and crew',
          value: settings.getLanguage(),
          onClick: pickLanguage,
        }),
        toggleRow({
          iconName: 'i-smartphone',
          title: 'Haptic Feedback',
          sub: 'Tactile vibration response on taps and recognition matches',
          checked: settings.getHaptics(),
          onToggle: (val) => {
            settings.setHaptics(val);
            toast(val ? 'Haptic feedback enabled.' : 'Haptic feedback disabled.', { variant: 'info' });
            render();
          },
        }),
        toggleRow({
          iconName: 'i-play',
          title: 'Reduce Motion',
          sub: 'Minimize animations and transitions across the interface',
          checked: settings.getReduceMotion(),
          onToggle: (val) => {
            settings.setReduceMotion(val);
            toast(val ? 'Reduce motion enabled.' : 'Reduce motion disabled.', { variant: 'info' });
            render();
          },
        })
      );
      body.append(section('Appearance & Feedback', appearanceGroup));

      /* 6. Notifications */
      const notificationsGroup = el('div', { class: 'list-group' });
      notificationsGroup.append(
        toggleRow({
          iconName: 'i-bell',
          title: 'Push Notifications',
          sub: 'Announcements, updates, and featured cinema picks',
          checked: settings.getNotifications(),
          onToggle: async (val) => {
            await settings.setNotifications(val);
            toast(val ? 'Notifications enabled.' : 'Notifications disabled.', { variant: 'info' });
            render();
          },
        }),
        toggleRow({
          iconName: 'i-bookmark',
          title: 'Watchlist Streaming Alerts',
          sub: 'Notify when saved watchlist items become streamable in your region',
          checked: settings.getWatchlistAlerts(),
          onToggle: (val) => {
            settings.setWatchlistAlerts(val);
            toast(val ? 'Watchlist availability alerts enabled.' : 'Watchlist alerts disabled.', { variant: 'info' });
            render();
          },
        })
      );
      body.append(section('Notifications', notificationsGroup));

      /* 7. Storage & Data Management */
      const storageUsage = settings.calculateStorageUsage();
      const storageGroup = el('div', { class: 'list-group' });
      storageGroup.append(
        infoRow('Local Storage Used', storageUsage.formatted, `${storageUsage.itemCount} items stored on device`),
        row({
          iconName: 'i-database',
          title: 'Clear App Cache',
          sub: 'Free up memory and refresh cached catalog responses',
          onClick: handleClearCache,
        }),
        row({
          iconName: 'i-trash',
          title: 'Reset All Local Data',
          sub: 'Clear local history, watchlist, and preferences on this device',
          danger: true,
          onClick: handleResetAllData,
        })
      );
      body.append(section('Storage & Data', storageGroup));

      /* 8. Diagnostics & About */
      const deviceGroup = el('div', { class: 'list-group' });
      deviceGroup.append(
        infoRow('Version', `CINZA v1.2.0 (${config.build})`),
        infoRow('Platform', `${config.platform}${config.isNative ? ' (native)' : ' (web)'}`),
        infoRow('API Endpoint', config.apiBase),
        row({
          iconName: 'i-sliders',
          title: 'Change API Endpoint',
          sub: 'Point this device at a different server',
          onClick: changeApi,
        }),
        row({
          iconName: 'i-refresh',
          title: 'Restore Default Settings',
          sub: 'Reset region, quality, theme, and filters to defaults',
          onClick: handleResetSettings,
        })
      );
      body.append(section('About CINZA', deviceGroup));
    }

    /* ------------------------------------------------------------------ *
     * Actions & Sheets
     * ------------------------------------------------------------------ */

    /** Region selector with instant live search */
    function pickRegion() {
      const caps = getCapabilities();
      const currentCode = settings.getRegion();

      // Combine KNOWN_COUNTRIES and any extra server advertised regions
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
        style: {
          maxHeight: '48vh',
          overflowY: 'auto',
          paddingRight: '2px',
        },
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
              style: {
                textAlign: 'center',
                padding: '24px 16px',
                color: 'var(--c-text-3)',
                fontSize: 'var(--fs-base)',
              },
              text: 'No countries found matching your search.',
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

          const flagEl = el('span', {
            style: {
              fontSize: '22px',
              marginRight: '12px',
              lineHeight: '1',
              flexShrink: 0,
            },
            text: country.flag,
          });

          const titleCol = el('span', { class: 'list-row__text' }, [
            el('span', {
              class: 'list-row__title',
              style: { fontWeight: isSelected ? '700' : '500' },
              text: country.name,
            }),
          ]);

          const codeBadge = el('span', {
            class: 'badge',
            style: {
              background: isSelected ? 'var(--c-accent)' : 'var(--c-surface-3)',
              color: isSelected ? '#fff' : 'var(--c-text-2)',
              marginLeft: '8px',
            },
            text: country.code,
          });

          node.append(flagEl, titleCol, codeBadge);

          if (isSelected) {
            node.append(
              el('span', {
                style: {
                  color: 'var(--c-accent)',
                  marginLeft: '8px',
                  display: 'grid',
                  placeItems: 'center',
                },
              }, [icon('i-check')])
            );
          }

          on(node, 'click', async () => {
            document.querySelector('.scrim')?.click();
            await settings.setRegion(country.code);
            catalog.invalidateAll();
            hapticImpact('medium');
            toast(`Watch region set to ${country.flag} ${country.name} (${country.code}).`, { variant: 'success' });
            render();
          });

          listContainer.append(node);
        }
      }

      on(searchInput, 'input', () => {
        renderFilteredList(searchInput.value);
      });

      renderFilteredList();

      openSheet({
        title: 'Watch Region & Country',
        content: [
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)' },
            text: 'Legal streaming providers are loaded based on your selected region.',
          }),
          searchInput,
          listContainer,
        ],
      });

      setTimeout(() => searchInput.focus(), 60);
    }

    /** Streaming monetization filter picker */
    async function pickStreamingFilter() {
      const current = settings.getStreamingFilter();
      const choice = await actionSheet({
        title: 'Streaming Provider Filter',
        actions: [
          { label: 'All Providers (Subscriptions, Free, Rent, Buy)', icon: 'i-film', value: 'all' },
          { label: 'Subscription Only (Netflix, Prime, OSN, etc.)', icon: 'i-tv', value: 'flatrate' },
          { label: 'Free / Ad-Supported', icon: 'i-sparkle', value: 'free' },
          { label: 'Rent & Buy (Apple TV, Amazon, Google)', icon: 'i-film', value: 'buy_rent' },
        ],
      });
      if (!choice || choice === current) return;
      settings.setStreamingFilter(choice);
      catalog.invalidateAll();
      toast('Streaming filter updated.', { variant: 'success' });
      render();
    }

    /** Image upload quality picker */
    async function pickUploadQuality() {
      const choice = await actionSheet({
        title: 'Recognition Image Quality',
        actions: [
          { label: 'High (1080p) — Best details and small text', icon: 'i-sliders', value: 'high' },
          { label: 'Balanced (720p) — Fast & accurate (Recommended)', icon: 'i-sliders', value: 'balanced' },
          { label: 'Data Saver (480p) — Optimized for slow connections', icon: 'i-sliders', value: 'saver' },
        ],
      });
      if (!choice) return;
      settings.setUploadQuality(choice);
      toast(`Recognition quality set to ${choice}.`, { variant: 'info' });
      render();
    }

    /** AI matching sensitivity picker */
    async function pickMatchingSensitivity() {
      const choice = await actionSheet({
        title: 'AI Matching Strictness',
        actions: [
          { label: 'Strict — Highest confidence threshold', icon: 'i-sparkle', value: 'strict' },
          { label: 'Balanced — Standard cinematic matching', icon: 'i-sparkle', value: 'balanced' },
          { label: 'Relaxed — Broader candidates for dark scenes', icon: 'i-sparkle', value: 'relaxed' },
        ],
      });
      if (!choice) return;
      settings.setMatchingSensitivity(choice);
      toast(`Sensitivity set to ${choice}.`, { variant: 'info' });
      render();
    }

    /** Server AI Specs & Limits modal */
    function viewServerAiLimits() {
      const caps = getCapabilities();
      const uploads = caps.uploads ?? {};
      const providers = caps.providers ?? {};

      const list = el('div', { class: 'list-group', style: { marginTop: '12px' } });
      list.append(
        infoRow('AI Vision Engine', `${providers.ai?.name || 'Gemini 1.5 Flash'} (${providers.ai?.mode || 'live'})`),
        infoRow('Metadata & Catalog', `${providers.tmdb?.name || 'TMDB'} (${providers.tmdb?.mode || 'live'})`),
        infoRow('Perceptual Hashes', 'aHash, dHash, pHash (computed on device)'),
        infoRow('Max Image Size', `${Math.round((uploads.maxImageBytes ?? 0) / 1024 / 1024)} MB`),
        infoRow('Max Dimensions', `${uploads.maxImageDimension ?? 6000}×${uploads.maxImageDimension ?? 6000} px`),
        infoRow('Max Video Duration', `${uploads.maxVideoDurationSeconds ?? 120} seconds`),
        infoRow('Video Keyframes', `${uploads.maxVideoFrames ?? 6} frames extracted on phone`),
        infoRow('Supported Formats', (uploads.allowedImageTypes ?? ['image/jpeg', 'image/png', 'image/webp']).map((t) => t.replace('image/', '').toUpperCase()).join(', '))
      );

      openSheet({
        title: 'AI Specifications & Limits',
        content: [
          el('p', {
            class: 't-body',
            style: { color: 'var(--c-text-2)' },
            text: 'CINZA processes high-resolution imagery and video keyframes locally before consulting the recognition intelligence backend.',
          }),
          list,
        ],
      });
    }

    /** Manage and clear search history */
    async function manageSearchHistory() {
      const items = catalog.selectedHistory();
      if (items.length === 0) {
        toast('Your search history is already clear.', { variant: 'info' });
        return;
      }
      const choice = await actionSheet({
        title: `Search History (${items.length} titles)`,
        actions: [
          { label: 'Clear Search History', icon: 'i-trash', value: 'clear', destructive: true },
        ],
      });
      if (choice === 'clear') {
        catalog.clearRecentSearches();
        hapticImpact('medium');
        toast('Search history cleared.', { variant: 'success' });
        render();
      }
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
      render();
    }

    /** Language picker */
    function pickLanguage() {
      const options = [
        { code: 'en-US', label: 'English (US)', flag: '🇺🇸' },
        { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
        { code: 'ar-SA', label: 'العربية (Arabic)', flag: '🇸🇦' },
        { code: 'fr-FR', label: 'Français (French)', flag: '🇫🇷' },
        { code: 'de-DE', label: 'Deutsch (German)', flag: '🇩🇪' },
        { code: 'es-ES', label: 'Español (Spanish)', flag: '🇪🇸' },
        { code: 'it-IT', label: 'Italiano (Italian)', flag: '🇮🇹' },
        { code: 'pt-BR', label: 'Português (Brasil)', flag: '🇧🇷' },
        { code: 'ja-JP', label: '日本語 (Japanese)', flag: '🇯🇵' },
        { code: 'ko-KR', label: '한국어 (Korean)', flag: '🇰🇷' },
      ];

      const list_ = el('div', { style: { maxHeight: '52vh', overflowY: 'auto' } });
      for (const opt of options) {
        const isSelected = settings.getLanguage() === opt.code;
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
          el('span', { style: { fontSize: '20px', marginRight: '10px' }, text: opt.flag }),
          el('span', { class: 'list-row__text' }, [
            el('span', { class: 'list-row__title', style: { fontWeight: isSelected ? '700' : '500' }, text: opt.label }),
          ]),
          el('span', { class: 'list-row__value', text: opt.code })
        );
        on(node, 'click', async () => {
          document.querySelector('.scrim')?.click();
          await settings.setLanguage(opt.code);
          catalog.invalidateAll();
          hapticImpact('medium');
          toast(`Language set to ${opt.label}.`, { variant: 'success' });
          render();
        });
        list_.append(node);
      }
      openSheet({
        title: 'Metadata & Catalog Language',
        content: [
          el('p', {
            class: 't-body',
            style: { marginBottom: '12px', color: 'var(--c-text-2)' },
            text: 'Movie and TV details, plots, and character names are requested from TMDB in this language.',
          }),
          list_,
        ],
      });
    }

    /** Clear app cache */
    async function handleClearCache() {
      await settings.clearAppCache();
      hapticImpact('light');
      toast('App cache cleared successfully.', { variant: 'success' });
      render();
    }

    /** Reset all local data */
    async function handleResetAllData() {
      const ok = await confirm({
        title: 'Reset All Local Data?',
        message: 'This will delete local search history, offline recognition history, and reset your preferences to defaults. This action cannot be undone.',
        confirmLabel: 'Reset Everything',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return;

      catalog.clearRecentSearches();
      await historyService.clear().catch(() => null);
      await settings.resetToDefaults();
      hapticImpact('heavy');
      toast('All local data and preferences have been reset.', { variant: 'warn' });
      render();
    }

    /** Reset settings only */
    async function handleResetSettings() {
      const ok = await confirm({
        title: 'Restore Default Settings?',
        message: 'This will reset your watch region, image quality, theme, and filters back to defaults.',
        confirmLabel: 'Restore Defaults',
        cancelLabel: 'Cancel',
        destructive: false,
      });
      if (!ok) return;

      await settings.resetToDefaults();
      hapticImpact('medium');
      toast('Settings restored to defaults.', { variant: 'success' });
      render();
    }

    /** Sign out handler */
    async function handleSignOut() {
      const ok = await confirm({
        title: 'Sign Out?',
        message: 'Your synced data will remain safely stored on your account and can be restored anytime you sign back in.',
        confirmLabel: 'Sign Out',
        cancelLabel: 'Cancel',
        destructive: false,
      });
      if (!ok) return;

      await auth.logout();
      hapticImpact('medium');
      toast('Signed out successfully.', { variant: 'info' });
      render();
    }

    /** Delete account handler */
    async function handleDeleteAccount() {
      const ok = await confirm({
        title: 'Delete Account?',
        message: 'This will permanently remove your CINZA account, watchlist, and server history. This cannot be undone.',
        confirmLabel: 'Delete Account',
        cancelLabel: 'Cancel',
        destructive: true,
      });
      if (!ok) return;

      try {
        await auth.deleteAccount();
        hapticImpact('heavy');
        toast('Account deleted.', { variant: 'warn' });
        render();
      } catch (err) {
        toast(err?.message || 'Failed to delete account.', { variant: 'error' });
      }
    }

    /** API endpoint configuration modal */
    function changeApi() {
      const input = el('input', {
        class: 'field',
        type: 'url',
        inputmode: 'url',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        value: config.apiBase,
        placeholder: 'http://192.168.1.20:8787',
      });

      openSheet({
        title: 'API Endpoint',
        content: [
          el('p', {
            class: 't-body',
            style: { marginBottom: '10px' },
            text: 'Where this device looks for the CINZA API. Handy when testing a build against a server on your local network. Changing it reloads the app.',
          }),
          input,
        ],
        actions: [
          {
            label: 'Save and Reload',
            variant: 'primary',
            onClick: () => {
              const value = input.value.trim();
              if (!/^https?:\/\//i.test(value)) {
                toast('Enter a full URL, including http:// or https://.', { variant: 'warn' });
                return;
              }
              saveApiBase(value);
              window.location.reload();
            },
          },
          {
            label: 'Reset to Default',
            variant: 'ghost',
            onClick: () => {
              clearApiBase();
              window.location.reload();
            },
          },
        ],
      });
    }

    const disposers = [store.subscribe(['session'], () => render())];
    return () => disposers.forEach((dispose) => dispose?.());
  },
};
