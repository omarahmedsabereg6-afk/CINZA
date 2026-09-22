import { el, qs, on, clear } from '../core/dom.js';
import { router } from '../core/router.js';
import * as catalog from '../services/catalog.js';
import { year, mediaTypeLabel, voteAverage } from '../core/format.js';
import { mountArtwork, mountAvatar } from '../ui/artwork.js';
import { posterCard, mediaRow, banner, skeletonBlock, skeletonRail, ratingBadge } from '../ui/components.js';

export default {
  title: null,
  tab: null,
  showBack: true,

  async mount({ root, params }) {
    const personId = params.id;
    const profileSlot = qs('#person-profile', root);
    const nameNode = qs('#person-name', root);
    const metaNode = qs('#person-meta', root);
    const bioNode = qs('#person-bio', root);
    const factsNode = qs('#person-facts', root);
    const noticesNode = qs('#person-notices', root);
    const filmographyNode = qs('#person-filmography', root);
    const backButton = qs('#person-back', root);
    const backdrop = qs('#person-backdrop', root);

    on(backButton, 'click', () => router.back());

    // Show loading state in both profile and filmography areas
    showLoading();

    try {
      const [person, credits] = await Promise.all([
        catalog.person(personId),
        catalog.personCredits(personId),
      ]);

      hideLoading();

      if (!person) {
        const fallback = el('p', { class: 't-body', text: 'That person could not be found.' });
        root.innerHTML = '';
        root.append(fallback);
        return () => {};
      }

      nameNode.textContent = person.name ?? 'Untitled';

      // Profile image — use the same mountAvatar but upgrade the container size
      if (person.profileUrl) {
        mountAvatar(profileSlot, { url: person.profileUrl, name: person.name });
      } else {
        profileSlot.textContent = '';
        profileSlot.append(
          el('div', { class: 'poster-ph', style: { width: '100%', minHeight: '210px' } }, [
            el('span', { class: 'poster-ph__text', text: person.name ?? 'Actor' }),
          ])
        );
      }

      // Meta line: department + birthday
      const infoParts = [
        person.department ?? null,
        person.birthday ? `Born ${person.birthday}` : null,
        person.placeOfBirth ? person.placeOfBirth : null,
      ].filter(Boolean);
      for (const [index, part] of infoParts.entries()) {
        if (index > 0) metaNode.append(el('span', { class: 'result__dot', 'aria-hidden': 'true' }));
        metaNode.append(el('span', { text: part }));
      }

      // Biography — clamp long bios with a "Read more" toggle
      if (person.biography) {
        bioNode.textContent = person.biography;
        bioNode.classList.add('t-clamp-3');
        requestAnimationFrame(() => {
          if (bioNode.scrollHeight > bioNode.clientHeight + 4) {
            const toggle = el('button', {
              class: 'detail__readmore',
              type: 'button',
              text: 'Read more',
            });
            toggle.addEventListener('click', () => {
              const clamped = bioNode.classList.toggle('t-clamp-3');
              toggle.textContent = clamped ? 'Read more' : 'Show less';
            });
            bioNode.insertAdjacentElement('afterend', toggle);
          }
        });
      } else {
        bioNode.textContent = 'No biography is available for this person.';
        bioNode.style.color = 'var(--c-text-3)';
        bioNode.style.fontStyle = 'italic';
      }

      // Fact grid — only show entries that have real values
      const factEntries = [
        ['Known for', person.department ?? null],
        ['Birthday', person.birthday ?? null],
        ['Place of birth', person.placeOfBirth ?? null],
        ['Also known as', (person.alsoKnownAs ?? []).slice(0, 1).join('') || null],
      ].filter(([, v]) => v);

      for (const [label, value] of factEntries) {
        factsNode.append(
          el('div', { class: 'fact' }, [
            el('div', { class: 'fact__label', text: label }),
            el('div', { class: 'fact__value', text: value }),
          ])
        );
      }

      // Blurred backdrop from profile image
      if (person.profileUrl) {
        backdrop.hidden = false;
        backdrop.alt = '';
        backdrop.src = person.profileUrl;
      }

      // Filmography — Movies and TV Shows in separate labelled groups
      const groups = [
        { label: 'Movies', items: credits.movies ?? [] },
        { label: 'TV Shows', items: credits.tvShows ?? [] },
      ].filter((g) => g.items.length > 0);

      if (groups.length === 0) {
        filmographyNode.append(
          el('p', { class: 't-body', style: { color: 'var(--c-text-3)', fontStyle: 'italic' }, text: 'No filmography entries are available yet.' })
        );
      } else {
        for (const group of groups) {
          filmographyNode.append(
            el('p', { class: 'search-group__label', style: { marginTop: 'var(--s-4)' }, text: group.label })
          );
          // Sort by year descending so most recent work appears first
          const sorted = [...group.items].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
          for (const item of sorted.slice(0, 14)) {
            const row = mediaRow(
              {
                ...item,
                title: item.title,
                year: item.year,
                mediaType: item.mediaType,
                posterUrl: item.posterUrl,
                voteAverage: item.voteAverage,
              },
              {
                subtitle: [
                  item.year ? year(item.year) : null,
                  mediaTypeLabel(item.mediaType),
                  item.character ? `as ${item.character}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                onSelect: (selected) =>
                  router.navigate(`/detail/${selected.mediaType}/${selected.tmdbId}`),
              }
            );
            filmographyNode.append(row);
          }
        }
      }
    } catch (error) {
      hideLoading();
      noticesNode.append(
        await banner({ variant: 'info', text: 'This person profile could not be loaded right now.' })
      );
    }

    function showLoading() {
      clear(filmographyNode);
      filmographyNode.append(skeletonBlock(4));
    }

    function hideLoading() {
      clear(filmographyNode);
    }

    return () => {};
  },
};
