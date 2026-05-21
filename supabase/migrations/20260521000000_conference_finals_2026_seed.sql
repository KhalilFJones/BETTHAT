-- ============================================================
-- 2026 NBA Conference Finals — Accurate Game Schedule Seed
-- Western: OKC Thunder vs SAS Spurs  (OKC leads 2-0, series 2-0 OKC)
-- Eastern: NYK Knicks  vs CLE Cavs   (NYK leads 1-0, G2 tonight)
-- Last updated: 2026-05-21
-- NOTE: G2 games were imported from ESPN (external_ids 401873198 / 401873342)
-- ============================================================

-- ── Teams ────────────────────────────────────────────────────────────────────
INSERT INTO public.nba_teams
  (abbreviation, full_name, city, conference, division, primary_color, secondary_color, arena, is_active)
VALUES
  ('OKC', 'Thunder',   'Oklahoma City', 'West', 'Northwest', '#007AC1', '#EF3B24', 'Paycom Center',              TRUE),
  ('SAS', 'Spurs',     'San Antonio',   'West', 'Southwest', '#C4CED4', '#000000', 'Frost Bank Center',          TRUE),
  ('NYK', 'Knicks',    'New York',      'East', 'Atlantic',  '#F58426', '#006BB6', 'Madison Square Garden',      TRUE),
  ('CLE', 'Cavaliers', 'Cleveland',     'East', 'Central',   '#860038', '#FDBB30', 'Rocket Mortgage FieldHouse', TRUE)
ON CONFLICT (abbreviation) DO UPDATE SET
  full_name       = EXCLUDED.full_name,
  city            = EXCLUDED.city,
  conference      = EXCLUDED.conference,
  division        = EXCLUDED.division,
  primary_color   = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  arena           = EXCLUDED.arena,
  is_active       = TRUE;

-- ── Western Conference Finals — OKC Thunder vs SAS Spurs ─────────────────────
-- OKC is the higher seed: hosts G1, G2, G5, G7. SAS hosts G3, G4, G6.

-- G1 — SAS wins at OKC (May 18, Final — score TBD)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g1', '2025-26', 'Thunder', 'OKC', 'Spurs', 'SAS',
   '2026-05-18', '2026-05-19T00:30:00Z', 'final', TRUE, 1, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G2 — OKC wins at OKC (May 20, Final 122-113) — ESPN import id 401873198
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status,
   home_score, away_score,
   is_playoffs, series_game_number, broadcast)
VALUES
  ('401873198', '2025-26', 'Thunder', 'OKC', 'Spurs', 'SAS',
   '2026-05-20', '2026-05-21T00:30:00Z', 'final',
   122, 113,
   TRUE, 2, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, home_score = EXCLUDED.home_score,
  away_score = EXCLUDED.away_score, game_date = EXCLUDED.game_date,
  home_team_abbreviation = EXCLUDED.home_team_abbreviation,
  away_team_abbreviation = EXCLUDED.away_team_abbreviation;

-- G3 — at SAS (May 22, 8:30 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g3', '2025-26', 'Spurs', 'SAS', 'Thunder', 'OKC',
   '2026-05-22', '2026-05-23T00:30:00Z', 'scheduled', TRUE, 3, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G4 — at SAS (May 24, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g4', '2025-26', 'Spurs', 'SAS', 'Thunder', 'OKC',
   '2026-05-24', '2026-05-25T00:00:00Z', 'scheduled', TRUE, 4, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G5 (if needed) — at OKC (May 27, 8:30 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g5', '2025-26', 'Thunder', 'OKC', 'Spurs', 'SAS',
   '2026-05-27', '2026-05-28T00:30:00Z', 'scheduled', TRUE, 5, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G6 (if needed) — at SAS (May 29, 8:30 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g6', '2025-26', 'Spurs', 'SAS', 'Thunder', 'OKC',
   '2026-05-29', '2026-05-30T00:30:00Z', 'scheduled', TRUE, 6, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G7 (if needed) — at OKC (May 31, 8:30 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-wcf-g7', '2025-26', 'Thunder', 'OKC', 'Spurs', 'SAS',
   '2026-05-31', '2026-06-01T00:30:00Z', 'scheduled', TRUE, 7, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- ── Eastern Conference Finals — NYK Knicks vs CLE Cavaliers ──────────────────
-- NYK is the higher seed: hosts G1, G2, G5, G7. CLE hosts G3, G4, G6.

-- G1 — NYK wins at NYK (May 19, Final — score TBD)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g1', '2025-26', 'Knicks', 'NYK', 'Cavaliers', 'CLE',
   '2026-05-19', '2026-05-20T00:00:00Z', 'final', TRUE, 1, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G2 — at NYK (May 21, Tonight 8:00 PM ET) — ESPN import id 401873342
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('401873342', '2025-26', 'Knicks', 'NYK', 'Cavaliers', 'CLE',
   '2026-05-21', '2026-05-22T00:00:00Z', 'scheduled', TRUE, 2, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date,
  home_team_abbreviation = EXCLUDED.home_team_abbreviation,
  away_team_abbreviation = EXCLUDED.away_team_abbreviation;

-- G3 — at CLE (May 23, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g3', '2025-26', 'Cavaliers', 'CLE', 'Knicks', 'NYK',
   '2026-05-23', '2026-05-24T00:00:00Z', 'scheduled', TRUE, 3, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G4 — at CLE (May 25, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g4', '2025-26', 'Cavaliers', 'CLE', 'Knicks', 'NYK',
   '2026-05-25', '2026-05-26T00:00:00Z', 'scheduled', TRUE, 4, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G5 (if needed) — at NYK (May 28, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g5', '2025-26', 'Knicks', 'NYK', 'Cavaliers', 'CLE',
   '2026-05-28', '2026-05-29T00:00:00Z', 'scheduled', TRUE, 5, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G6 (if needed) — at CLE (May 30, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g6', '2025-26', 'Cavaliers', 'CLE', 'Knicks', 'NYK',
   '2026-05-30', '2026-05-31T00:00:00Z', 'scheduled', TRUE, 6, 'ESPN')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- G7 (if needed) — at NYK (Jun 1, 8:00 PM ET)
INSERT INTO public.nba_games
  (external_id, season, home_team, home_team_abbreviation,
   away_team,   away_team_abbreviation,
   game_date, tip_off_time, status, is_playoffs, series_game_number, broadcast)
VALUES
  ('2026-ecf-g7', '2025-26', 'Knicks', 'NYK', 'Cavaliers', 'CLE',
   '2026-06-01', '2026-06-02T00:00:00Z', 'scheduled', TRUE, 7, 'TNT')
ON CONFLICT (external_id) DO UPDATE SET
  status = EXCLUDED.status, game_date = EXCLUDED.game_date;

-- ── Player Game Availability ──────────────────────────────────────────────────
-- WCF G2 (May 20) — OKC and SAS players
-- ECF G2 (May 21) — NYK and CLE players
-- Uses subqueries to resolve game UUIDs from external_id

INSERT INTO public.player_game_availability (player_id, game_id, game_date, is_draftable, is_confirmed)
SELECT p.id, g.id, g.game_date, true, true
FROM public.nba_players p
CROSS JOIN (SELECT id, game_date FROM public.nba_games WHERE external_id = '401873198') g
WHERE p.team_abbreviation IN ('OKC', 'SAS')
ON CONFLICT DO NOTHING;

INSERT INTO public.player_game_availability (player_id, game_id, game_date, is_draftable, is_confirmed)
SELECT p.id, g.id, g.game_date, true, true
FROM public.nba_players p
CROSS JOIN (SELECT id, game_date FROM public.nba_games WHERE external_id = '401873342') g
WHERE p.team_abbreviation IN ('NYK', 'CLE')
ON CONFLICT DO NOTHING;

-- ── Prop Lines for ECF G2 (tonight — NYK vs CLE) ─────────────────────────────

INSERT INTO public.prop_lines (player_id, game_id, stat_category, line_value, over_odds, under_odds, source, is_active)
SELECT pl.player_id, pl.game_id, pl.stat_category, pl.line_value, pl.over_odds, pl.under_odds, pl.source, pl.is_active
FROM (
  SELECT
    p.id AS player_id,
    g.id AS game_id,
    v.stat_category,
    v.line_value,
    v.over_odds,
    v.under_odds,
    'DraftKings' AS source,
    true AS is_active
  FROM public.nba_games g
  CROSS JOIN (VALUES
    -- Jalen Brunson (NYK PG)
    ('Jalen Brunson',    'points',         27.5, -115, -105),
    ('Jalen Brunson',    'assists',         7.5, -110, -110),
    ('Jalen Brunson',    'rebounds',        3.5, -115, -105),
    ('Jalen Brunson',    'three_pointers',  2.5, -115, -105),
    -- Karl-Anthony Towns (NYK C)
    ('Karl-Anthony Towns', 'points',       24.5, -110, -110),
    ('Karl-Anthony Towns', 'rebounds',     11.5, -115, -105),
    ('Karl-Anthony Towns', 'assists',       2.5, -115, -105),
    ('Karl-Anthony Towns', 'three_pointers', 2.5, -105, -115),
    -- Mikal Bridges (NYK SF)
    ('Mikal Bridges',    'points',         15.5, -110, -110),
    ('Mikal Bridges',    'rebounds',        4.5, -110, -110),
    ('Mikal Bridges',    'three_pointers',  1.5, -125,  105),
    -- Josh Hart (NYK SG)
    ('Josh Hart',        'points',         11.5, -110, -110),
    ('Josh Hart',        'rebounds',        9.5, -110, -110),
    ('Josh Hart',        'assists',         2.5, -110, -110),
    -- OG Anunoby (NYK SF)
    ('OG Anunoby',       'points',         14.5, -110, -110),
    ('OG Anunoby',       'rebounds',        5.5, -115, -105),
    ('OG Anunoby',       'three_pointers',  1.5, -125,  105),
    -- Miles McBride (NYK PG)
    ('Miles McBride',    'points',         10.5, -110, -110),
    ('Miles McBride',    'assists',         3.5, -110, -110),
    -- Mitchell Robinson (NYK C)
    ('Mitchell Robinson','points',          8.5, -110, -110),
    ('Mitchell Robinson','rebounds',        9.5, -115, -105),
    -- Donovan Mitchell (CLE SG)
    ('Donovan Mitchell', 'points',         29.5, -110, -110),
    ('Donovan Mitchell', 'assists',         5.5, -110, -110),
    ('Donovan Mitchell', 'rebounds',        5.5, -115, -105),
    ('Donovan Mitchell', 'three_pointers',  2.5, -115, -105)
  ) AS v(player_name, stat_category, line_value, over_odds, under_odds)
  JOIN public.nba_players p ON p.full_name = v.player_name
  WHERE g.external_id = '401873342'
) pl
ON CONFLICT DO NOTHING;
