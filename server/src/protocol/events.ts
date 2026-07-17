/**
 * Wire protocol event names, shared conceptually with the frontend
 * (lie-hard/src/lib/realtime.ts mirrors these string constants).
 */

// operator → server (require operator role)
export const OP = {
  START_SHOW: 'op:startShow',
  GOTO_PHASE: 'op:gotoPhase',
  WARMUP_NAV: 'op:warmupNav',
  OPEN_VOTE: 'op:openVote',
  LOCK_VOTE: 'op:lockVote',
  REVEAL: 'op:reveal',
  SELECT_STORYTELLER: 'op:selectStoryteller',
  SET_PLAYER_VOTE: 'op:setPlayerVote',
  TOGGLE_STATEMENT: 'op:toggleStatement',
  EDIT_SEG1: 'op:editSeg1',
  EDIT_SEG2: 'op:editSeg2',
  EDIT_SEG3: 'op:editSeg3',
  AWARD_SEGMENT: 'op:awardSegment',
  AWARD_SEGMENT3: 'op:awardSegment3',
  ADJUST_SCORE: 'op:adjustScore',
  TOGGLE_DISPLAY: 'op:toggleDisplay',
  TIMER_START: 'op:timerStart',
  TIMER_STOP: 'op:timerStop',
  TIMER_RESET: 'op:timerReset',
  RESET_GAME: 'op:resetGame',
  DELETE_USER_DATA: 'op:deleteUserData',
} as const;

// audience → server (require audience role / Firebase uid)
export const AUD = {
  REGISTER: 'aud:register',
  VOTE: 'aud:vote',
} as const;

// server → client
export const SRV = {
  STATE_FULL: 'state:full',
  STATE_PATCH: 'state:patch',
  ERROR: 'error',
} as const;

export interface Ack {
  ok: boolean;
  error?: string;
  /** For aud:vote — echo the accepted choice + round so the client can confirm. */
  choice?: string;
  votingRound?: string | null;
  /** For aud:register — echo the stored record. */
  registered?: boolean;
}
