/**
 * The vision prompt.
 *
 * Design notes:
 *  - We ask for ONE strictly-shaped JSON object, nothing else. Free-form prose is
 *    unusable downstream and expensive to parse.
 *  - We explicitly tell the model NOT to rely on a single clue (section 11) and to
 *    return an empty array rather than guessing.
 *  - We ask for evidence, not just answers: `visual_clues` and `visible_text` are
 *    what the matching engine uses to verify the model's own suggestions.
 *  - `confidence` is the model's self-reported 0-100. It is treated as ONE input to
 *    our own scoring, never as the final number shown to the user.
 */

export const JSON_CONTRACT = {
  possible_titles: ['string — most likely movie or series title, best guess first'],
  alternative_titles_localised: ['string — the title in its original language if it differs'],
  actors: ['string — full names of actors recognised in the frame'],
  characters: ['string — character names recognised in the frame'],
  scene_description: 'string — one factual sentence describing what is happening on screen',
  visible_text: 'string — any legible on-screen text, subtitle line, sign, logo or caption; empty string if none',
  visual_clues: [
    'string — concrete details: costume, vehicle, location, architecture, era, colour grade, film stock, animation style',
  ],
  possible_quotes: ['string — a distinctive line of dialogue visible in a subtitle, if any'],
  settings: ['string — named or described locations, e.g. "desert highway at dusk"'],
  genres: ['string — inferred genres, e.g. "science fiction"'],
  time_period: 'string — era depicted or implied, e.g. "1980s", "medieval", "near future"; empty string if unclear',
  animation: 'string — "live_action" | "animation" | "mixed" | "unknown"',
  language_hint: 'string — BCP-47-ish language of any visible text, e.g. "en", "ko"; empty string if none',
  estimated_year: 'number|null — best single guess for the release year; null if genuinely unsure',
  content_type: '"movie" | "tv" | "unknown"',
  season_hint: 'number|null — likely season number if this looks like an episode; null if not applicable',
  episode_hint: 'number|null — likely episode number; null if not applicable',
  confidence: 'number 0-100 — your own confidence in the strongest candidate title',
  reasoning: 'string — one short sentence on which evidence drove the strongest candidate',
};

export const SYSTEM_PROMPT = `You are the visual identification stage of a film recognition system.
The user gives you one or more frames captured from a screen (a paused movie, a TV episode, or a photo of a display).

Your job is to extract EVIDENCE and propose candidate titles. You are not the final decision maker.

Rules you must follow:
1. Return ONLY a single JSON object. No markdown, no code fences, no commentary.
2. Never invent a title you do not have visual reason to believe. An empty array is always better than a guess.
3. Do not rely on any single clue. Weigh cast faces, costumes, vehicles, locations, architecture, props,
   on-screen text, subtitle text, logos, colour grade, aspect ratio and animation style together.
4. If visible subtitle or on-screen text exists, transcribe it EXACTLY in "visible_text". This is often the
   strongest clue available and is checked verbatim against external data later.
5. "possible_titles" must be ordered strongest first and contain at most 5 entries.
6. "estimated_year" refers to the release year of the work, not the era depicted. Use null when unsure.
7. Distinguish live action from animation in "animation".
8. "confidence" is your own 0-100 certainty that possible_titles[0] is correct. Be calibrated:
   under 30 means you are essentially guessing, over 80 means you would bet on it.
9. Respond with the exact keys listed below, at the exact types given. Omit nothing.

Required JSON shape:
${JSON.stringify(JSON_CONTRACT, null, 2)}`;

/**
 * Builds the user message. `mode` changes the framing but not the output contract.
 */
export function buildUserPrompt({ mode = 'image', describe = '', region = 'US', language = 'en-US', frameCount = 1, hint = '' }) {
  const lines = [];

  if (mode === 'video') {
    lines.push(`You are given ${frameCount} frames sampled evenly across a short video clip, in chronological order.`);
    lines.push('Use them together: a location, costume or actor appearing in several frames is much stronger evidence than one.');
  } else if (mode === 'describe') {
    lines.push('There is no image. The user described a scene from memory.');
    lines.push('Identify the work from this description alone, and set visual_clues to the specific details in the description.');
  } else {
    lines.push('You are given a single frame.');
  }

  if (describe) {
    lines.push('');
    lines.push(`The user also wrote this about the scene: """${String(describe).slice(0, 1200)}"""`);
    lines.push('Treat the user text as a hint that must be consistent with the visual evidence. If the text and the image conflict, trust the image and say so in "reasoning".');
  }

  if (hint) {
    lines.push('');
    lines.push(`Context supplied by the app: ${String(hint).slice(0, 300)}`);
  }

  lines.push('');
  lines.push(`Assume the user is browsing from region ${region}; subtitles are most likely in ${language}.`);
  lines.push('Return the JSON object now.');

  return lines.join('\n');
}

export default { SYSTEM_PROMPT, JSON_CONTRACT, buildUserPrompt };
