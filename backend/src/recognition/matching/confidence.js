/**
 * Verification + confidence calibration (sections 10, 13, 14).
 *
 * Two separate jobs, deliberately kept apart:
 *
 * 1. VERIFICATION — adversarial checks that try to FALSIFY the leading candidate.
 *    The weighted score says "these look alike"; verification asks "is there any
 *    evidence that contradicts this?" and applies explicit penalties. This is the
 *    "the system verifies the result" step of the product concept.
 *
 * 2. CONFIDENCE — a single 0-100 number combining:
 *      - the weighted evidence score
 *      - the vision model's own self-reported certainty (never used alone)
 *      - the MARGIN over the runner-up (a 0.71 vs 0.70 field is not a confident win)
 *      - verification adjustments
 *    The margin term is what stops the app from confidently announcing the wrong
 *    film when three candidates are statistical ties.
 */
import { clamp01, titleSimilarity, bestNameSimilarity } from '../../utils/similarity.js';

/** Verdict bands surfaced in the UI. */
export const VERDICT = {
  STRONG: 'strong',
  LIKELY: 'likely',
  UNCERTAIN: 'uncertain',
  NONE: 'none',
};

/**
 * Confidence bands. `combined` is the calibrated 0..1 score:
 *
 *   < 0.34          NONE       — report "could not identify" instead of a guess
 *   0.34 – 0.56     UNCERTAIN  — show the result but ask the user to confirm
 *   0.56 – 0.76     LIKELY     — show as the answer with a visible caveat
 *   >= 0.76         STRONG     — present as the identification
 *
 * Tuned so that a simulated (mock) result, capped at 0.62, can never reach STRONG.
 */
export const THRESHOLDS = {
  noMatch: 0.34,
  uncertain: 0.56,
  likely: 0.76,
};

/** Maps a calibrated 0..1 score to a verdict band. Exported for testing. */
export function verdictFor(combined) {
  if (combined < THRESHOLDS.noMatch) return VERDICT.NONE;
  if (combined < THRESHOLDS.uncertain) return VERDICT.UNCERTAIN;
  if (combined < THRESHOLDS.likely) return VERDICT.LIKELY;
  return VERDICT.STRONG;
}

const NAME_MATCH_THRESHOLD = 0.87;

/**
 * Runs contradiction checks against the leading candidate.
 * @returns {{ adjustments: number, notes: Array<{kind:string, reason:string, delta:number}> }}
 */
export function verifyCandidate({ analysis, candidate }) {
  const notes = [];
  const add = (kind, reason, delta) => notes.push({ kind, reason, delta });

  /* --- hard contradiction: movie vs series --- */
  if (analysis.contentType && analysis.contentType !== 'unknown' && analysis.contentType !== candidate.mediaType) {
    add('penalty', `The model believes this is a ${analysis.contentType}, the candidate is a ${candidate.mediaType}.`, -0.12);
  }

  /* --- year far outside tolerance --- */
  if (analysis.estimatedYear && candidate.year && Math.abs(analysis.estimatedYear - candidate.year) > 12) {
    add(
      'penalty',
      `Estimated year ${analysis.estimatedYear} is ${Math.abs(analysis.estimatedYear - candidate.year)} years from the candidate's ${candidate.year}.`,
      -0.08
    );
  }

  /* --- no actor overlap despite several recognised faces --- */
  const observedActors = analysis.actors ?? [];
  const cast = (candidate.cast ?? []).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
  if (observedActors.length >= 2 && cast.length >= 3) {
    const matches = observedActors.filter((a) => bestNameSimilarity(a, cast) >= NAME_MATCH_THRESHOLD);
    if (matches.length === 0) {
      add(
        'penalty',
        `${observedActors.length} cast members were recognised but none appear in this candidate's credits.`,
        -0.14
      );
    } else if (matches.length >= 2) {
      add('bonus', `${matches.length} recognised cast members appear in the credits.`, +0.07);
    }
  }

  /* --- characters named that the candidate does not contain --- */
  const observedCharacters = analysis.characters ?? [];
  const candidateCharacters = candidate.characters ?? [];
  if (observedCharacters.length >= 2 && candidateCharacters.length >= 3) {
    const matches = observedCharacters.filter((c) => bestNameSimilarity(c, candidateCharacters) >= NAME_MATCH_THRESHOLD);
    if (matches.length === 0) {
      add('penalty', `${observedCharacters.length} character names were recognised but none match this candidate.`, -0.08);
    }
  }

  /* --- the title we matched on barely resembles anything the model proposed --- */
  const hints = analysis.possibleTitles ?? [];
  if (hints.length > 0) {
    const best = Math.max(...hints.map((h) => titleSimilarity(h, candidate.title ?? '')));
    if (best < 0.35) {
      add(
        'penalty',
        `This candidate matched on secondary evidence only (best title similarity ${(best * 100).toFixed(0)}%).`,
        -0.1
      );
    } else if (best > 0.92) {
      add('bonus', `Title matches a proposed title almost exactly (${(best * 100).toFixed(0)}%).`, +0.05);
    }
  }

  /* --- on-screen text corroboration is strong evidence --- */
  const visibleText = (analysis.visibleText ?? '').trim();
  if (visibleText) {
    const targets = [candidate.title, ...cast, ...candidateCharacters].filter(Boolean);
    if (targets.some((t) => titleSimilarity(visibleText, t) > 0.5 || visibleText.toLowerCase().includes(String(t).toLowerCase()))) {
      add('bonus', 'On-screen text corroborates this candidate.', +0.06);
    }
  }

  const adjustments = notes.reduce((sum, n) => sum + n.delta, 0);
  return { adjustments, notes };
}

/**
 * Combines evidence into a final confidence.
 *
 * @param {object} input
 * @param {number} input.weightedScore  evidence score from the scorers (0..1)
 * @param {object} input.analysis       normalised vision analysis
 * @param {number} input.margin         (best - second) / best, 0..1. Pass null when there is no runner-up.
 * @param {number} input.verificationAdjustments
 * @param {boolean} input.isMock
 * @returns {{confidence:number, verdict:string, components:object}}
 */
export function calibrateConfidence({
  weightedScore,
  analysis,
  margin,
  verificationAdjustments = 0,
  isMock = false,
  frameAgreement = null,
}) {
  const evidence = clamp01(weightedScore + verificationAdjustments);

  const selfConfidence = clamp01((analysis?.confidence ?? 0) / 100);
  // The model's self-report is deliberately the weakest term: vision models are
  // systematically over-confident on famous-looking frames.
  const marginTerm = margin === null || margin === undefined ? 0.5 : clamp01(margin);

  let combined = evidence * 0.58 + selfConfidence * 0.2 + marginTerm * 0.22;

  // Multi-frame agreement is genuine extra evidence, so it gets its own small term.
  if (frameAgreement !== null && frameAgreement !== undefined) {
    combined = combined * 0.88 + clamp01(frameAgreement) * 0.12;
  }

  // A simulated result must never present itself as a confident identification.
  if (isMock) combined = Math.min(combined, 0.62);

  const confidence = Math.round(clamp01(combined) * 100);
  const verdict = verdictFor(combined);

  return {
    confidence,
    verdict,
    components: {
      evidenceScore: Number(evidence.toFixed(4)),
      weightedScore: Number(weightedScore.toFixed(4)),
      selfConfidence: Number(selfConfidence.toFixed(4)),
      margin: Number(marginTerm.toFixed(4)),
      frameAgreement,
      verificationAdjustments: Number(verificationAdjustments.toFixed(4)),
      mockCapped: isMock,
    },
  };
}

export const verdictLabel = (verdict) =>
  ({
    [VERDICT.STRONG]: 'Confident match',
    [VERDICT.LIKELY]: 'Likely match',
    [VERDICT.UNCERTAIN]: 'Uncertain — please confirm',
    [VERDICT.NONE]: 'No reliable match',
  })[verdict] ?? 'Unknown';

export default { verifyCandidate, calibrateConfidence, VERDICT, THRESHOLDS, verdictLabel };
