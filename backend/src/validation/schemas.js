/**
 * zod schemas for every endpoint that accepts input.
 *
 * Kept in one file so the API contract can be read top-to-bottom and so the app's
 * validation rules can be kept in sync with a single source of truth.
 */
import { z } from 'zod';
import { MediaType, RecognitionMode, RecognitionSource, StreamingCategory, REGIONS, toCountryCode } from '../database/constants.js';

const regionCodes = new Set(REGIONS.map((r) => r.code));
export const regionSchema = z
  .string()
  .trim()
  .transform((v) => toCountryCode(v, null))
  .refine((v) => Boolean(v && regionCodes.has(v)), {
    message: `region must be one of: ${REGIONS.map((r) => r.code).join(', ')}`,
  });

export const mediaTypeSchema = z.enum([MediaType.MOVIE, MediaType.TV]);

/* ------------------------------- auth ------------------------------- */

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(180),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(200)
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.'),
  displayName: z.string().trim().min(1).max(60).optional(),
  region: regionSchema.optional(),
  language: z.string().trim().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(400),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(400),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(200)
    .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.'),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  region: regionSchema.optional(),
  language: z.string().trim().max(20).optional(),
  theme: z.enum(['dark', 'system']).optional(),
  notificationsEnabled: z.boolean().optional(),
  privateEnabled: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({
  confirm: z.literal(true, { errorMap: () => ({ message: 'Set confirm: true to delete your account.' }) }),
});

/* ---------------------------- recognition ---------------------------- */

const clientFileMetaSchema = z.object({
  // 64-bit hex perceptual hashes computed on-device. Advisory only.
  pHash: z.string().regex(/^[0-9a-fA-F]{16}$/).optional().nullable(),
  dHash: z.string().regex(/^[0-9a-fA-F]{16}$/).optional().nullable(),
  aHash: z.string().regex(/^[0-9a-fA-F]{16}$/).optional().nullable(),
  thumbDataUrl: z.string().startsWith('data:image/').max(400_000).optional().nullable(),
  frameTimeMs: z.number().int().min(0).max(3600_000).optional().nullable(),
});

export const recognitionMetaSchema = z.object({
  mode: z.enum([RecognitionMode.IMAGE, RecognitionMode.VIDEO, RecognitionMode.DESCRIBE]).default(RecognitionMode.IMAGE),
  source: z.enum([RecognitionSource.CAMERA, RecognitionSource.GALLERY, RecognitionSource.VIDEO, RecognitionSource.TEXT]).optional(),
  describe: z.string().trim().max(1200).optional().default(''),
  hint: z.string().trim().max(300).optional().default(''),
  region: regionSchema.optional(),
  language: z.string().trim().max(20).optional(),
  video: z
    .object({
      durationSeconds: z.number().min(0).max(3600).optional(),
      sizeBytes: z.number().int().min(0).optional(),
      width: z.number().int().min(0).optional(),
      height: z.number().int().min(0).optional(),
    })
    .optional(),
  files: z.array(clientFileMetaSchema).max(12).optional().default([]),
});

export const recognitionQuerySchema = z.object({
  debug: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

/* ------------------------------ history ----------------------------- */

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  cursor: z.string().min(1).max(60).optional(),
  mediaType: mediaTypeSchema.optional(),
  status: z.enum(['pending', 'processing', 'completed', 'no_match', 'failed']).optional(),
});

/* ----------------------------- watchlist ---------------------------- */

export const watchlistQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).max(60).optional(),
  mediaType: mediaTypeSchema.optional(),
});

export const watchlistAddSchema = z.object({
  mediaType: mediaTypeSchema,
  tmdbId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  seasonNumber: z.coerce.number().int().min(0).max(200).optional(),
  episodeNumber: z.coerce.number().int().min(0).max(2000).optional(),
  note: z.string().trim().max(280).optional(),
});

export const watchlistRemoveSchema = z.object({
  mediaType: mediaTypeSchema.optional(),
  tmdbId: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
});

export const watchlistCheckSchema = z.object({
  mediaType: mediaTypeSchema,
  tmdbId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  seasonNumber: z.coerce.number().int().min(0).max(200).optional(),
  episodeNumber: z.coerce.number().int().min(0).max(2000).optional(),
});

/* ------------------------------- search ----------------------------- */

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter something to search for.').max(120),
  type: z.enum(['all', 'movie', 'tv', 'person']).optional().default('all'),
  page: z.coerce.number().int().min(1).max(20).optional().default(1),
  region: regionSchema.optional(),
});

/* ------------------------------ catalog ----------------------------- */

export const catalogQuerySchema = z.object({
  region: regionSchema.optional(),
  refresh: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const seasonParamsSchema = z.object({
  id: z.string().min(1).max(30),
  seasonNumber: z.coerce.number().int().min(0).max(200),
});

export const sortBySchema = z
  .enum(['popularity.desc', 'vote_average.desc', 'release_date.desc', 'vote_count.desc'])
  .optional()
  .default('popularity.desc');

export const discoverQuerySchema = z.object({
  region: regionSchema.optional(),
  genreId: z.coerce.number().int().min(1).max(1000).optional(),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(12),
  sortBy: sortBySchema,
});

export const genreQuerySchema = z.object({
  region: regionSchema.optional(),
  genreId: z.coerce.number().int().min(1).max(1000).optional(),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: sortBySchema,
});

/* ------------------------------ feedback ---------------------------- */

export const feedbackSchema = z
  .object({
    recognitionId: z.string().min(1).max(60),
    correct: z.boolean(),
    correctedTmdbId: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
    correctedTitle: z.string().trim().max(200).optional(),
    correctedMediaType: mediaTypeSchema.optional(),
    correctedSeason: z.coerce.number().int().min(0).max(200).optional(),
    correctedEpisode: z.coerce.number().int().min(0).max(2000).optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.correct === true || v.correctedTitle || v.correctedTmdbId, {
    message: 'A correction must include the correct title or TMDB id.',
    path: ['correctedTitle'],
  });

/* ------------------------------ streaming --------------------------- */

export const availabilityQuerySchema = z.object({
  region: regionSchema.optional(),
  refresh: z
    .union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const availabilityCategorySchema = z.enum([
  StreamingCategory.STREAM,
  StreamingCategory.RENT,
  StreamingCategory.BUY,
]);

export default {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  deleteAccountSchema,
  recognitionMetaSchema,
  recognitionQuerySchema,
  historyQuerySchema,
  watchlistQuerySchema,
  watchlistAddSchema,
  watchlistRemoveSchema,
  watchlistCheckSchema,
  searchQuerySchema,
  catalogQuerySchema,
  seasonParamsSchema,
  discoverQuerySchema,
  genreQuerySchema,
  sortBySchema,
  feedbackSchema,
  availabilityQuerySchema,
};
