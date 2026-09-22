import { createLogger } from '../../utils/logger.js';

const log = createLogger('ai:fallback');

function unique(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].slice(0, 12);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function candidateScoreFromAnalysis(analysis = {}) {
  const hints = unique([...(analysis.possibleTitles ?? []), ...(analysis.alternativeTitles ?? [])]);
  const visibleText = String(analysis.visibleText ?? '').trim();
  const scene = String(analysis.sceneDescription ?? '').trim();
  const settings = unique(analysis.settings ?? []);
  const people = unique([...(analysis.actors ?? []), ...(analysis.characters ?? [])]);
  const locationWeight = settings.length > 0 ? 0.22 : 0;
  const textWeight = visibleText ? 0.18 : 0;
  const peopleWeight = people.length > 0 ? 0.14 : 0;
  const sceneWeight = scene ? 0.18 : 0;
  const hintWeight = hints.length > 0 ? 0.28 : 0;
  return clamp01(locationWeight + textWeight + peopleWeight + sceneWeight + hintWeight);
}

export const fallbackRecognizer = {
  name: 'fallback',
  isMock: false,

  async analyze({ images = [], analysis = {}, describe = '', hint = '', region = 'US', language = 'en-US' }) {
    const persons = unique([...(analysis.actors ?? []), ...(analysis.characters ?? [])]);
    const candidateTitles = unique([...(analysis.possibleTitles ?? []), ...(analysis.alternativeTitles ?? [])]);
    const visibleText = unique(
      (String(analysis.visibleText ?? '') || String(describe ?? '') || '')
        .split(/[,;\n]/)
        .flatMap((part) => part.split(/\s+/))
        .filter((part) => part.length >= 3)
        .slice(0, 8)
    );
    const settings = unique(analysis.settings ?? []);
    const sceneDescription = String(analysis.sceneDescription ?? describe ?? '').trim();
    const era = String(analysis.timePeriod ?? '').trim() || 'unknown';
    const visualClues = {
      people: persons,
      location: settings[0] || (visibleText[0] ?? ''),
      era,
      text: visibleText,
      clothing: unique([...(analysis.visualClues ?? []).filter((clue) => /shirt|suit|coat|uniform|dress|jacket|hoodie|cloak/i.test(String(clue)))]),
      cinematography: sceneDescription || hint || 'low-detail scene',
      other: unique([...(analysis.visualClues ?? []), ...(settings ?? [])].slice(0, 12)),
    };

    const candidates = candidateTitles.map((title) => ({
      title,
      year: analysis.estimatedYear ?? null,
      reason: [
        'Fallback review re-used the primary model hints and the scene clues while checking for a stronger TMDB match.',
        visualClues.location ? `Location context: ${visualClues.location}.` : null,
        visualClues.era && visualClues.era !== 'unknown' ? `Era context: ${visualClues.era}.` : null,
        visibleText.length > 0 ? `Visible text: ${visibleText.slice(0, 3).join(', ')}.` : null,
      ].filter(Boolean).join(' '),
      confidence: clamp01(candidateScoreFromAnalysis(analysis) + (visibleText.length > 0 ? 0.1 : 0) + (persons.length > 0 ? 0.08 : 0)),
    }));

    const baseConfidence = candidates.length > 0 ? Math.max(...candidates.map((entry) => entry.confidence)) : 0;
    const result = {
      candidates,
      visualClues,
      confidence: Number(clamp01(baseConfidence).toFixed(4)),
      provider: 'fallback',
      model: 'heuristic',
      region,
      language,
      evidence: {
        images: images.length,
        peopleCount: persons.length,
        settingsCount: settings.length,
        visibleTextCount: visibleText.length,
      },
      reason: candidates.length > 0
        ? 'Fallback stage reweighted the primary scene clues and title hints before TMDB verification.'
        : 'Fallback stage found insufficient title or scene evidence for a second-stage candidate pool.',
    };

    log.info('[TRACE recognition] fallback recognition evaluated scene', {
      imageCount: images.length,
      candidateCount: candidates.length,
      confidence: result.confidence,
      provider: 'fallback',
    });

    return result;
  },
};

export default fallbackRecognizer;
