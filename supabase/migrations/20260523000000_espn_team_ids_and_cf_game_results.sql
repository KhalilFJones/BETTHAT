-- =============================================================================
-- ESPN team external_ids + CF game results
-- Sets ESPN API external_ids on all 30 nba_teams rows and records real
-- Conference Finals game scores/status from ESPN.
-- =============================================================================

-- ── 1. Update nba_teams with ESPN external_ids ────────────────────────────────
-- ESPN uses numeric IDs (as strings in our schema). The nba_teams table never
-- had an external_id column (unlike nba_players/nba_games), so add it first.
ALTER TABLE public.nba_teams ADD COLUMN IF NOT EXISTS external_id TEXT;

UPDATE nba_teams SET external_id = '1'  WHERE abbreviation = 'ATL';
UPDATE nba_teams SET external_id = '2'  WHERE abbreviation = 'BOS';
UPDATE nba_teams SET external_id = '3'  WHERE abbreviation = 'NOP';
UPDATE nba_teams SET external_id = '4'  WHERE abbreviation = 'CHI';
UPDATE nba_teams SET external_id = '5'  WHERE abbreviation = 'CLE';
UPDATE nba_teams SET external_id = '6'  WHERE abbreviation = 'DAL';
UPDATE nba_teams SET external_id = '7'  WHERE abbreviation = 'DEN';
UPDATE nba_teams SET external_id = '8'  WHERE abbreviation = 'DET';
UPDATE nba_teams SET external_id = '9'  WHERE abbreviation = 'GSW';
UPDATE nba_teams SET external_id = '10' WHERE abbreviation = 'HOU';
UPDATE nba_teams SET external_id = '11' WHERE abbreviation = 'IND';
UPDATE nba_teams SET external_id = '12' WHERE abbreviation = 'LAC';
UPDATE nba_teams SET external_id = '13' WHERE abbreviation = 'LAL';
UPDATE nba_teams SET external_id = '14' WHERE abbreviation = 'MIA';
UPDATE nba_teams SET external_id = '15' WHERE abbreviation = 'MIL';
UPDATE nba_teams SET external_id = '16' WHERE abbreviation = 'MIN';
UPDATE nba_teams SET external_id = '17' WHERE abbreviation = 'BKN';
UPDATE nba_teams SET external_id = '18' WHERE abbreviation = 'NYK';
UPDATE nba_teams SET external_id = '19' WHERE abbreviation = 'ORL';
UPDATE nba_teams SET external_id = '20' WHERE abbreviation = 'PHI';
UPDATE nba_teams SET external_id = '21' WHERE abbreviation = 'PHX';
UPDATE nba_teams SET external_id = '22' WHERE abbreviation = 'POR';
UPDATE nba_teams SET external_id = '23' WHERE abbreviation = 'SAC';
UPDATE nba_teams SET external_id = '24' WHERE abbreviation = 'SAS';
UPDATE nba_teams SET external_id = '25' WHERE abbreviation = 'OKC';
UPDATE nba_teams SET external_id = '26' WHERE abbreviation = 'UTA';
UPDATE nba_teams SET external_id = '27' WHERE abbreviation = 'WAS';
UPDATE nba_teams SET external_id = '28' WHERE abbreviation = 'TOR';
UPDATE nba_teams SET external_id = '29' WHERE abbreviation = 'MEM';
UPDATE nba_teams SET external_id = '30' WHERE abbreviation = 'CHA';

-- ── 2. Delete any stale duplicate teams (NY/SA created by ESPN sync before fix) ─
DELETE FROM nba_teams WHERE abbreviation = 'NY';
DELETE FROM nba_teams WHERE abbreviation = 'SA';

-- ── 3. Link CF games to ESPN event IDs and update final scores ─────────────────
-- WCF G1 (May 18): SAS @ OKC — SAS won 122-115
UPDATE nba_games
SET external_id = '401873197',
    status      = 'final',
    home_score  = 115,
    away_score  = 122,
    updated_at  = now()
WHERE away_team_abbreviation IN ('SAS','SA')
  AND home_team_abbreviation = 'OKC'
  AND game_date = '2026-05-18';

-- ECF G1 (May 19): CLE @ NYK — NYK won 115-104
UPDATE nba_games
SET external_id = '401873341',
    status      = 'final',
    home_score  = 115,
    away_score  = 104,
    updated_at  = now()
WHERE away_team_abbreviation = 'CLE'
  AND home_team_abbreviation IN ('NYK','NY')
  AND game_date = '2026-05-19';

-- WCF G2 (May 20): SAS @ OKC — OKC won 122-113
UPDATE nba_games
SET external_id = '401873198',
    status      = 'final',
    home_score  = 122,
    away_score  = 113,
    updated_at  = now()
WHERE away_team_abbreviation IN ('SAS','SA')
  AND home_team_abbreviation = 'OKC'
  AND game_date = '2026-05-20';

-- ECF G2 (May 21): CLE @ NYK — Scheduled
UPDATE nba_games
SET external_id = '401873342',
    status      = 'scheduled',
    home_score  = 0,
    away_score  = 0,
    updated_at  = now()
WHERE away_team_abbreviation = 'CLE'
  AND home_team_abbreviation IN ('NYK','NY')
  AND game_date BETWEEN '2026-05-21' AND '2026-05-22';

-- WCF G3 (May 22): OKC @ SAS — Scheduled
UPDATE nba_games
SET external_id = '401873199',
    status      = 'scheduled',
    home_score  = 0,
    away_score  = 0,
    updated_at  = now()
WHERE away_team_abbreviation = 'OKC'
  AND home_team_abbreviation IN ('SAS','SA')
  AND game_date = '2026-05-22';

-- ── 4. Fix home_team_abbreviation for any NYK games stored with 'NY' ──────────
UPDATE nba_games SET home_team_abbreviation = 'NYK' WHERE home_team_abbreviation = 'NY';
UPDATE nba_games SET away_team_abbreviation = 'NYK' WHERE away_team_abbreviation = 'NY';
UPDATE nba_games SET home_team_abbreviation = 'SAS'  WHERE home_team_abbreviation = 'SA';
UPDATE nba_games SET away_team_abbreviation = 'SAS'  WHERE away_team_abbreviation = 'SA';
UPDATE nba_games SET home_team_abbreviation = 'GSW'  WHERE home_team_abbreviation = 'GS';
UPDATE nba_games SET away_team_abbreviation = 'GSW'  WHERE away_team_abbreviation = 'GS';
UPDATE nba_games SET home_team_abbreviation = 'NOP'  WHERE home_team_abbreviation = 'NO';
UPDATE nba_games SET away_team_abbreviation = 'NOP'  WHERE away_team_abbreviation = 'NO';
UPDATE nba_games SET home_team_abbreviation = 'UTA'  WHERE home_team_abbreviation = 'UTAH';
UPDATE nba_games SET away_team_abbreviation = 'UTA'  WHERE away_team_abbreviation = 'UTAH';
UPDATE nba_games SET home_team_abbreviation = 'WAS'  WHERE home_team_abbreviation = 'WSH';
UPDATE nba_games SET away_team_abbreviation = 'WAS'  WHERE away_team_abbreviation = 'WSH';

-- ── 5. Fix nba_players abbreviations if any ESPN ones slipped in ──────────────
UPDATE nba_players SET team_abbreviation = 'NYK' WHERE team_abbreviation = 'NY';
UPDATE nba_players SET team_abbreviation = 'SAS'  WHERE team_abbreviation = 'SA';
UPDATE nba_players SET team_abbreviation = 'GSW'  WHERE team_abbreviation = 'GS';
UPDATE nba_players SET team_abbreviation = 'NOP'  WHERE team_abbreviation = 'NO';
UPDATE nba_players SET team_abbreviation = 'UTA'  WHERE team_abbreviation = 'UTAH';
UPDATE nba_players SET team_abbreviation = 'WAS'  WHERE team_abbreviation = 'WSH';
