import { z } from 'zod';

/**
 * Zod schemas for every inbound event payload. Handlers reject (ack error)
 * anything that fails to parse. Array sizes and string lengths are bounded to
 * blunt oversized-payload abuse.
 */

const phase = z.enum(['SETUP', 'WARMUP', 'SEGMENT1', 'SEGMENT2', 'SEGMENT3', 'FINAL']);
const voteSegment = z.enum(['warmup', 'segment1', 'segment2', 'segment3']);
const segmentKey = z.enum(['segment1', 'segment2']);
const displayKey = z.enum([
  'showScoreboard',
  'showLeaderboardModal',
  'showScorePopup',
  'showVoteBars',
  'showLogo',
  'showTopVoters',
]);

const shortStr = z.string().max(500);
// Player photos are small base64 data URIs (~<80KB after client downscale to 400px).
const photoStr = z.string().max(300_000);

export const startShowSchema = z.object({
  players: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(80),
        photo: photoStr.default(''),
      }),
    )
    .min(1)
    .max(10),
  warmup: z
    .array(z.object({ statement: shortStr, isLie: z.boolean() }))
    .max(100),
  segment1: z
    .array(
      z.object({
        playerId: z.number().int(),
        playerName: shortStr,
        statement: shortStr,
        isLie: z.boolean(),
      }),
    )
    .max(50),
  segment2: z
    .array(
      z.object({
        playerId: z.number().int(),
        playerName: shortStr,
        statements: z.array(shortStr).min(1).max(8),
        lieIndex: z.number().int().min(0),
      }),
    )
    .max(50),
  segment3: z.object({
    photoUrl: photoStr.nullable().default(null),
    photoTitle: z.string().max(200).nullable().default(null),
  }),
});

export const gotoPhaseSchema = z.object({ phase });
export const warmupNavSchema = z.object({ index: z.number().int().min(0).max(200) });
export const voteSegmentSchema = z.object({ segment: voteSegment });
export const selectStorytellerSchema = z.object({
  segment: segmentKey,
  playerId: z.number().int(),
});
export const setPlayerVoteSchema = z.object({
  segment: segmentKey,
  playerId: z.number().int(),
  vote: z.string().max(40),
});
export const toggleStatementSchema = z.object({ index: z.number().int().min(0).max(20) });
export const awardSegmentSchema = z.object({ segment: segmentKey });
export const awardSegment3Schema = z.object({ winnerId: z.number().int() });
export const adjustScoreSchema = z.object({
  playerId: z.number().int(),
  delta: z.number().int().min(-100_000).max(100_000),
});
export const toggleDisplaySchema = z.object({ key: displayKey, value: z.boolean() });
export const timerStartSchema = z.object({ totalSeconds: z.number().int().min(1).max(3600) });
export const timerResetSchema = z.object({ totalSeconds: z.number().int().min(1).max(3600) });

export const registerSchema = z.object({
  name: z.string().min(1).max(80),
  phone: z.string().min(3).max(30),
});
export const voteSchema = z.object({ choice: z.string().min(1).max(40) });

export const operatorLoginSchema = z.object({ password: z.string().min(1).max(200) });
