/**
 * ABOUT (sections 21, 32).
 *
 * This screen exists to answer "is any of this real right now?" in one place. It
 * reports the actual runtime state of every provider, the storage driver used for
 * tokens, and the pipeline's cost limits — pulled live from the server, not
 * hard-coded. When something is simulated it says so plainly.
 */
import { el, qs, on, clear, icon } from '../core/dom.js';
import { router } from '../core/router.js';
import { toast, toastError, openSheet } from '../core/feedback.js';
import { getCapabilities, loadCapabilities, providerModes, isSimulated } from '../services/capabilities.js';
import { secureStore } from '../services/secureStore.js';
import { store } from '../core/store.js';
import config from '../config.js';
import { banner, skeletonBlock } from '../ui/components.js';

export default {
  title: 'About',
  tab: 'profile',
  showBack: true,

  async mount({ root }) {
    const versionNode = qs('#about-version', root);
    const runtimeSlot = qs('#about-runtime', root);
    const actionsSlot = qs('#about-actions', root);

    versionNode.textContent = `Version ${getCapabilities().api?.version ?? '1.0.0'} · ${config.build} build · ${config.platform}`;

    clear(runtimeSlot);
    runtimeSlot.append(skeletonBlock(2));

    /* -------- refresh capabilities so this is never stale -------- */
    try {
      await loadCapabilities({ force: true });
    } catch {
      /* keep whatever we have */
    }

    const caps = getCapabilities();
    const modes = providerModes();
    const storage = await secureStore.describe();

    clear(runtimeSlot);
    runtimeSlot.append(await renderRuntime(caps, modes, storage));
    runtimeSlot.append(await renderActions());
    runtimeSlot.append(await renderFeedbackStats());

    /* -------- actions -------- */
    async function renderActions() {
      const wrapper = el('section', { class: 'section' });
      wrapper.append(el('h2', { class: 'section__title', style: { marginBottom: '10px' }, text: 'Developer' }));

      const group = el('div', { class: 'list-group' });

      group.append(
        actionRow('Reload capabilities', 'Refetch /api/meta/config from the server', async () => {
          try {
            await loadCapabilities({ force: true });
            toast('Capabilities reloaded.', { variant: 'success' });
            router.navigate('/about');
          } catch (error) {
            toastError(error);
          }
        }),
        actionRow('Show pipeline metrics', 'Calls, cache hit rates and timings', showMetrics),
        actionRow('Show raw configuration', 'Exactly what the app knows about the server', () => {
          openSheet({
            title: 'Server configuration',
            content: el('pre', {
              class: 't-mono',
              style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '56vh', overflow: 'auto' },
              text: JSON.stringify(caps, null, 2),
            }),
          });
        })
      );

      wrapper.append(group);
      return wrapper;
    }

    function actionRow(title, sub, onClick) {
      const node = el('button', { class: 'list-row', type: 'button' });
      node.append(
        el('span', { class: 'list-row__text' }, [
          el('span', { class: 'list-row__title', text: title }),
          el('span', { class: 'list-row__sub', text: sub }),
        ]),
        el('span', { class: 'list-row__chevron' }, [icon('i-chevron-right')])
      );
      on(node, 'click', onClick);
      return node;
    }

    async function showMetrics() {
      const { api } = await import('../services/api.js');
      openSheet({
        title: 'Pipeline metrics',
        content: el('div', {}, [
          el('p', { class: 't-body', text: 'Loading…' }),
        ]),
      });
      try {
        const metrics = await api.get('/meta/metrics');
        openSheet({
          title: 'Pipeline metrics',
          content: el('pre', {
            class: 't-mono',
            style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '56vh', overflow: 'auto' },
            text: JSON.stringify(metrics, null, 2),
          }),
        });
      } catch (error) {
        toastError(error);
      }
    }

    async function renderFeedbackStats() {
      const wrapper = el('section', { class: 'section' });
      const node = el('div', { class: 'list-group' });
      node.append(infoRow('Confidence thresholds', JSON.stringify(caps.limits?.confidenceThresholds ?? {})));
      node.append(infoRow('Max search queries per recognition', String(caps.cost?.maxSearchQueriesPerRecognition ?? '—')));
      node.append(infoRow('Max detail fetches per recognition', String(caps.cost?.maxDetailFetchesPerRecognition ?? '—')));
      node.append(infoRow('Recognitions per hour', String(caps.limits?.recognitionPerHour ?? '—')));
      wrapper.append(el('h2', { class: 'section__title', style: { marginBottom: '10px' }, text: 'Cost controls' }));
      wrapper.append(node);
      return wrapper;
    }

    function infoRow(label, value) {
      const node = el('div', { class: 'list-row' });
      node.append(
        el('span', { class: 'list-row__text' }, [el('span', { class: 'list-row__title', text: label })]),
        el('span', { class: 'list-row__value', text: String(value), style: { maxWidth: '50%', textAlign: 'right', wordBreak: 'break-word' } })
      );
      return node;
    }

    /* -------- runtime report -------- */
    async function renderRuntime(caps, modes, storage) {
      const wrapper = el('section', { class: 'section' });

      if (isSimulated()) {
        const notice = await banner({
          variant: 'mock',
          title: 'This build is partly simulated',
          text: caps.mockNotice ?? 'At least one provider is running in mock mode, so results are labelled as simulated throughout the app.',
        });
        wrapper.append(notice);
        wrapper.append(el('div', { style: { height: '16px' } }));
      }

      wrapper.append(el('h2', { class: 'section__title', style: { marginBottom: '10px' }, text: 'What is running' }));

      const group = el('div', { class: 'list-group' });
      group.append(
        providerRow('AI vision', modes.ai, 'Reads the scene and proposes candidate titles'),
        providerRow('Movie database', modes.tmdb, 'Metadata, cast, artwork and episodes'),
        providerRow('Streaming availability', modes.streaming, 'Legal viewing options for your region'),
        providerRow(
          'Scene matching',
          { name: caps.providers?.sceneMatcher?.name, mode: caps.providers?.sceneMatcher?.mode },
          'Exact-frame matching against previously confirmed frames'
        ),
        providerRow('Video frames', { mode: caps.features?.serverSideVideoFrames ? 'live' : 'device' }, caps.features?.serverSideVideoFrames ? 'Extracted server-side with ffmpeg' : 'Extracted on this device (ffmpeg is not installed on the server)'),
        providerRow('Token storage', { mode: storage.secure ? 'live' : 'fallback' }, storage.label)
      );

      wrapper.append(group);

      if ((caps.warnings ?? []).length > 0) {
        wrapper.append(el('div', { style: { height: '16px' } }));
        const warnGroup = el('div', { class: 'list-group' });
        for (const warning of caps.warnings) {
          warnGroup.append(el('div', { class: 'list-row' }, [
            el('span', { class: 'list-row__icon' }, [icon('i-warning')]),
            el('span', { class: 'list-row__text' }, [el('span', { class: 'list-row__title', style: { fontWeight: '400', fontSize: 'var(--fs-sm)' }, text: warning })]),
          ]));
        }
        wrapper.append(warnGroup);
      }

      if (caps.__fallback) {
        wrapper.append(el('div', { style: { height: '16px' } }));
        wrapper.append(
          await banner({
            variant: 'warn',
            icon: 'i-warning',
            text: 'The server could not be reached, so these values are conservative defaults rather than real capability data.',
          })
        );
      }

      return wrapper;
    }

    function providerRow(label, mode, description) {
      const node = el('div', { class: 'list-row' });
      const isMock = mode?.mode === 'mock';
      const isLive = mode?.mode === 'live';

      node.append(el('span', { class: 'list-row__icon' }, [icon(isMock ? 'i-warning' : isLive ? 'i-eye' : 'i-info')]));

      const text = el('span', { class: 'list-row__text' });
      text.append(el('span', { class: 'list-row__title', text: label }));
      if (description) text.append(el('span', { class: 'list-row__sub', text: description }));
      node.append(text);

      node.append(
        el('span', {
          class: `pill ${isMock ? 'pill--mock' : isLive ? 'pill--strong' : 'pill--uncertain'}`,
          text: isMock ? 'Simulated' : isLive ? 'Live' : String(mode?.mode ?? 'unknown'),
        })
      );

      return node;
    }

    return () => {};
  },
};
