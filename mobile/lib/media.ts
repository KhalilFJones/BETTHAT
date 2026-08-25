// =============================================================================
// BETTHAT — remote imagery
//
// Player headshots and team logos both come from ESPN's public CDN. Headshot
// URLs are stored on nba_players.headshot_url (backfilled from ESPN athlete
// ids), but team logos are derivable from the abbreviation alone, which means
// any card holding a game row can draw its own crest without another query.
//
// 30 of 273 players have no ESPN athlete id — mostly names off current rosters.
// Those fall through to the monogram, so every consumer must handle a null.
// =============================================================================

const LOGO_BASE = 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard';

/**
 * ESPN's slug differs from the league's three-letter code for exactly two
 * teams; using the standard code for these 404s. Verified by HTTP probe.
 */
const ESPN_TEAM_SLUG: Record<string, string> = {
  NOP: 'no',
  UTA: 'utah',
};

/** Crest for a team abbreviation, e.g. "MIA" -> .../scoreboard/mia.png */
export function teamLogoUrl(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null;
  const abbr = abbreviation.trim().toUpperCase();
  if (abbr.length < 2 || abbr.length > 4) return null;
  return `${LOGO_BASE}/${ESPN_TEAM_SLUG[abbr] ?? abbr.toLowerCase()}.png`;
}

/** Headshot for a raw ESPN athlete id, when a row carries the id but no URL. */
export function headshotUrlFromEspnId(externalId: string | null | undefined): string | null {
  if (!externalId || !/^\d+$/.test(externalId)) return null;
  return `https://a.espncdn.com/i/headshots/nba/players/full/${externalId}.png`;
}

/** Prefers the stored URL, falling back to deriving one from external_id. */
export function resolveHeadshot(player: {
  headshot_url?: string | null;
  external_id?: string | null;
} | null | undefined): string | null {
  if (!player) return null;
  return player.headshot_url ?? headshotUrlFromEspnId(player.external_id);
}

/**
 * The image to use as a poster figure.
 *
 * Prefers a real action shot when one has been supplied. headshot_url is only
 * a head-and-shoulders cutout — the sole free, predictable source — so posters
 * degrade to that rather than showing nothing.
 */
export function resolvePosterImage(player: {
  action_photo_url?: string | null;
  headshot_url?: string | null;
  external_id?: string | null;
} | null | undefined): string | null {
  if (!player) return null;
  return player.action_photo_url ?? resolveHeadshot(player);
}

/** True when the figure is a plain headshot, which needs a tighter crop. */
export function isHeadshotOnly(player: {
  action_photo_url?: string | null;
} | null | undefined): boolean {
  return !player?.action_photo_url;
}

/** "Jayson Tatum" -> "JT". Falls back to the first two letters of one word. */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
