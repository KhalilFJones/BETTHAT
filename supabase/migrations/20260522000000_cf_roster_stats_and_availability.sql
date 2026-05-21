-- Migration: Conference Finals roster stats, player availability, and prop lines
-- Covers: OKC/SAS player season stats, all CF game availability, prop lines for G3+

-- ============================================================
-- 1. Delete stale NY team (duplicate of canonical NYK)
-- ============================================================
DELETE FROM public.nba_teams WHERE id = '6fd21296-440f-4375-be60-60f357b26b5d';

-- ============================================================
-- 2. Update OKC player season stats and salary tiers (2024-25)
-- ============================================================
UPDATE public.nba_players SET salary_tier = 'superstar',
  season_avg_pts = 32.7, season_avg_reb = 5.5, season_avg_ast = 6.4,
  season_avg_3pm = 1.7, season_avg_blk = 0.7, season_avg_stl = 1.9,
  season_avg_to = 2.8, season_avg_min = 34.5, season_games_played = 68,
  season_avg_fpts = 32.7 + 5.5*1.2 + 6.4*1.5 + 1.9*3 + 0.7*3 - 2.8
WHERE full_name = 'Shai Gilgeous-Alexander' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'star',
  season_avg_pts = 23.3, season_avg_reb = 4.5, season_avg_ast = 5.7,
  season_avg_3pm = 1.5, season_avg_blk = 0.5, season_avg_stl = 1.1,
  season_avg_to = 2.3, season_avg_min = 32.0, season_games_played = 65,
  season_avg_fpts = 23.3 + 4.5*1.2 + 5.7*1.5 + 1.1*3 + 0.5*3 - 2.3
WHERE full_name = 'Jalen Williams' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'star',
  season_avg_pts = 17.3, season_avg_reb = 7.8, season_avg_ast = 1.5,
  season_avg_3pm = 1.3, season_avg_blk = 2.3, season_avg_stl = 0.9,
  season_avg_to = 1.5, season_avg_min = 30.0, season_games_played = 60,
  season_avg_fpts = 17.3 + 7.8*1.2 + 1.5*1.5 + 0.9*3 + 2.3*3 - 1.5
WHERE full_name = 'Chet Holmgren' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 9.3, season_avg_reb = 10.8, season_avg_ast = 3.3,
  season_avg_3pm = 0.3, season_avg_blk = 0.9, season_avg_stl = 0.8,
  season_avg_to = 1.8, season_avg_min = 28.0, season_games_played = 62,
  season_avg_fpts = 9.3 + 10.8*1.2 + 3.3*1.5 + 0.8*3 + 0.9*3 - 1.8
WHERE full_name = 'Isaiah Hartenstein' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 12.3, season_avg_reb = 3.8, season_avg_ast = 2.3,
  season_avg_3pm = 2.1, season_avg_blk = 0.3, season_avg_stl = 1.0,
  season_avg_to = 1.2, season_avg_min = 28.5, season_games_played = 67,
  season_avg_fpts = 12.3 + 3.8*1.2 + 2.3*1.5 + 1.0*3 + 0.3*3 - 1.2
WHERE full_name = 'Luguentz Dort' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 8.3, season_avg_reb = 3.8, season_avg_ast = 3.2,
  season_avg_3pm = 1.4, season_avg_blk = 0.8, season_avg_stl = 1.5,
  season_avg_to = 1.3, season_avg_min = 26.0, season_games_played = 70,
  season_avg_fpts = 8.3 + 3.8*1.2 + 3.2*1.5 + 1.5*3 + 0.8*3 - 1.3
WHERE full_name = 'Alex Caruso' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 10.6, season_avg_reb = 3.0, season_avg_ast = 1.6,
  season_avg_3pm = 2.5, season_avg_blk = 0.3, season_avg_stl = 0.5,
  season_avg_to = 0.8, season_avg_min = 22.0, season_games_played = 58,
  season_avg_fpts = 10.6 + 3.0*1.2 + 1.6*1.5 + 0.5*3 + 0.3*3 - 0.8
WHERE full_name = 'Isaiah Joe' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 9.3, season_avg_reb = 2.8, season_avg_ast = 1.4,
  season_avg_3pm = 1.8, season_avg_blk = 0.5, season_avg_stl = 0.6,
  season_avg_to = 0.7, season_avg_min = 20.0, season_games_played = 55,
  season_avg_fpts = 9.3 + 2.8*1.2 + 1.4*1.5 + 0.6*3 + 0.5*3 - 0.7
WHERE full_name = 'Aaron Wiggins' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 5.2, season_avg_reb = 3.8, season_avg_ast = 1.0,
  season_avg_3pm = 0.3, season_avg_blk = 0.4, season_avg_stl = 0.3,
  season_avg_to = 0.6, season_avg_min = 16.0, season_games_played = 45,
  season_avg_fpts = 5.2 + 3.8*1.2 + 1.0*1.5 + 0.3*3 + 0.4*3 - 0.6
WHERE full_name = 'Jaylin Williams' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 5.8, season_avg_reb = 2.0, season_avg_ast = 1.2,
  season_avg_3pm = 0.8, season_avg_blk = 0.4, season_avg_stl = 0.4,
  season_avg_to = 0.6, season_avg_min = 15.0, season_games_played = 40,
  season_avg_fpts = 5.8 + 2.0*1.2 + 1.2*1.5 + 0.4*3 + 0.4*3 - 0.6
WHERE full_name = 'Ousmane Dieng' AND team_abbreviation = 'OKC';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 4.0, season_avg_reb = 2.0, season_avg_ast = 2.5,
  season_avg_3pm = 0.5, season_avg_blk = 0.2, season_avg_stl = 0.5,
  season_avg_to = 1.0, season_avg_min = 12.0, season_games_played = 20,
  season_avg_fpts = 4.0 + 2.0*1.2 + 2.5*1.5 + 0.5*3 + 0.2*3 - 1.0
WHERE full_name = 'Nikola Topic' AND team_abbreviation = 'OKC';

-- ============================================================
-- 3. Update SAS player season stats and salary tiers (2024-25)
-- ============================================================
UPDATE public.nba_players SET salary_tier = 'superstar',
  season_avg_pts = 27.6, season_avg_reb = 10.7, season_avg_ast = 3.9,
  season_avg_3pm = 1.1, season_avg_blk = 3.7, season_avg_stl = 1.2,
  season_avg_to = 3.0, season_avg_min = 32.0, season_games_played = 56,
  season_avg_fpts = 27.6 + 10.7*1.2 + 3.9*1.5 + 1.2*3 + 3.7*3 - 3.0
WHERE full_name = 'Victor Wembanyama' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'star',
  season_avg_pts = 19.5, season_avg_reb = 3.8, season_avg_ast = 3.3,
  season_avg_3pm = 2.3, season_avg_blk = 0.5, season_avg_stl = 1.0,
  season_avg_to = 1.8, season_avg_min = 32.0, season_games_played = 62,
  season_avg_fpts = 19.5 + 3.8*1.2 + 3.3*1.5 + 1.0*3 + 0.5*3 - 1.8
WHERE full_name = 'Devin Vassell' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'star',
  season_avg_pts = 14.5, season_avg_reb = 4.0, season_avg_ast = 3.8,
  season_avg_3pm = 1.5, season_avg_blk = 0.7, season_avg_stl = 1.1,
  season_avg_to = 1.9, season_avg_min = 30.0, season_games_played = 70,
  season_avg_fpts = 14.5 + 4.0*1.2 + 3.8*1.5 + 1.1*3 + 0.7*3 - 1.9
WHERE full_name = 'Stephon Castle' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 14.3, season_avg_reb = 4.0, season_avg_ast = 5.0,
  season_avg_3pm = 0.8, season_avg_blk = 0.5, season_avg_stl = 0.8,
  season_avg_to = 2.2, season_avg_min = 30.0, season_games_played = 65,
  season_avg_fpts = 14.3 + 4.0*1.2 + 5.0*1.5 + 0.8*3 + 0.5*3 - 2.2
WHERE full_name = 'Dylan Harper' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 14.9, season_avg_reb = 5.0, season_avg_ast = 2.3,
  season_avg_3pm = 1.5, season_avg_blk = 0.4, season_avg_stl = 0.9,
  season_avg_to = 1.5, season_avg_min = 30.0, season_games_played = 68,
  season_avg_fpts = 14.9 + 5.0*1.2 + 2.3*1.5 + 0.9*3 + 0.4*3 - 1.5
WHERE full_name = 'Keldon Johnson' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 9.5, season_avg_reb = 4.5, season_avg_ast = 2.0,
  season_avg_3pm = 1.2, season_avg_blk = 0.3, season_avg_stl = 0.7,
  season_avg_to = 0.9, season_avg_min = 25.0, season_games_played = 60,
  season_avg_fpts = 9.5 + 4.5*1.2 + 2.0*1.5 + 0.7*3 + 0.3*3 - 0.9
WHERE full_name = 'Harrison Barnes' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'mid',
  season_avg_pts = 8.5, season_avg_reb = 3.2, season_avg_ast = 1.0,
  season_avg_3pm = 1.8, season_avg_blk = 0.3, season_avg_stl = 0.5,
  season_avg_to = 0.7, season_avg_min = 22.0, season_games_played = 55,
  season_avg_fpts = 8.5 + 3.2*1.2 + 1.0*1.5 + 0.5*3 + 0.3*3 - 0.7
WHERE full_name = 'Julian Champagnie' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 7.8, season_avg_reb = 2.5, season_avg_ast = 4.5,
  season_avg_3pm = 0.5, season_avg_blk = 0.3, season_avg_stl = 0.8,
  season_avg_to = 1.5, season_avg_min = 20.0, season_games_played = 58,
  season_avg_fpts = 7.8 + 2.5*1.2 + 4.5*1.5 + 0.8*3 + 0.3*3 - 1.5
WHERE full_name = 'Jordan McLaughlin' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 7.5, season_avg_reb = 5.5, season_avg_ast = 1.5,
  season_avg_3pm = 0.8, season_avg_blk = 1.2, season_avg_stl = 0.4,
  season_avg_to = 0.8, season_avg_min = 18.0, season_games_played = 52,
  season_avg_fpts = 7.5 + 5.5*1.2 + 1.5*1.5 + 0.4*3 + 1.2*3 - 0.8
WHERE full_name = 'Luke Kornet' AND team_abbreviation = 'SAS';

UPDATE public.nba_players SET salary_tier = 'budget',
  season_avg_pts = 3.0, season_avg_reb = 2.5, season_avg_ast = 0.8,
  season_avg_3pm = 0.5, season_avg_blk = 0.3, season_avg_stl = 0.3,
  season_avg_to = 0.5, season_avg_min = 12.0, season_games_played = 35,
  season_avg_fpts = 3.0 + 2.5*1.2 + 0.8*1.5 + 0.3*3 + 0.3*3 - 0.5
WHERE full_name = 'Carter Bryant' AND team_abbreviation = 'SAS';

-- ============================================================
-- 4. Populate player_game_availability for all upcoming CF games
-- ============================================================
INSERT INTO public.player_game_availability (player_id, game_id, game_date, is_confirmed, is_draftable)
SELECT DISTINCT
  p.id AS player_id,
  g.id AS game_id,
  g.game_date,
  true AS is_confirmed,
  true AS is_draftable
FROM public.nba_games g
JOIN public.nba_players p ON (
  p.team_abbreviation = g.home_team_abbreviation
  OR p.team_abbreviation = g.away_team_abbreviation
)
WHERE g.id IN (
  '2b97f43d-47f1-48f4-80d5-f5377f00820c',
  '976ceda1-945a-44fe-badc-c1f58b4d1dc1',
  '52795aac-47e3-47d6-a699-dc8fa83f37a6',
  'a40ce16a-b5d4-4322-97f2-1ae675abbac3',
  'f17a7c89-b58f-4460-86b1-6536d11e4be0',
  '1d0d2d0c-176b-4ce7-b9b2-131107f4125f',
  'f403fb96-cd2a-4199-8ab8-7f06e1c857a3',
  'd50d8f75-2a3f-4a0b-b92d-0a34b9f265e8',
  '0d530fdc-1ae3-4234-ba8f-52ebbb710659',
  '6d5eb025-a5d9-49c4-b395-206e6e96674d',
  '5bf0e47e-0e9e-40b0-833d-d0ab4919548c'
)
AND p.is_active = true
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. Generate prop lines for all upcoming CF games
-- ============================================================
INSERT INTO public.prop_lines (player_id, game_id, stat_category, line_value, over_odds, under_odds, source, is_active)
SELECT
  pga.player_id,
  pga.game_id,
  stat.category,
  ROUND(
    CASE stat.category
      WHEN 'points'         THEN GREATEST(ROUND(p.season_avg_pts::numeric * 2) / 2 - 0.5, 5.5)
      WHEN 'rebounds'       THEN GREATEST(ROUND(p.season_avg_reb::numeric * 2) / 2 - 0.5, 2.5)
      WHEN 'assists'        THEN GREATEST(ROUND(p.season_avg_ast::numeric * 2) / 2 - 0.5, 1.5)
      WHEN 'three_pointers' THEN GREATEST(ROUND(p.season_avg_3pm::numeric * 2) / 2 - 0.5, 0.5)
      WHEN 'blocks'         THEN GREATEST(ROUND(p.season_avg_blk::numeric * 2) / 2 - 0.3, 0.5)
    END, 1
  ) AS line_value,
  CASE WHEN p.salary_tier IN ('superstar','star') THEN -115 ELSE -110 END AS over_odds,
  CASE WHEN p.salary_tier IN ('superstar','star') THEN -105 ELSE -110 END AS under_odds,
  'synthetic' AS source,
  true AS is_active
FROM public.player_game_availability pga
JOIN public.nba_players p ON p.id = pga.player_id
CROSS JOIN (VALUES ('points'),('rebounds'),('assists'),('three_pointers'),('blocks')) AS stat(category)
WHERE pga.game_id IN (
  '2b97f43d-47f1-48f4-80d5-f5377f00820c',
  '976ceda1-945a-44fe-badc-c1f58b4d1dc1',
  '52795aac-47e3-47d6-a699-dc8fa83f37a6',
  'a40ce16a-b5d4-4322-97f2-1ae675abbac3',
  'f17a7c89-b58f-4460-86b1-6536d11e4be0',
  '1d0d2d0c-176b-4ce7-b9b2-131107f4125f',
  'f403fb96-cd2a-4199-8ab8-7f06e1c857a3',
  'd50d8f75-2a3f-4a0b-b92d-0a34b9f265e8',
  '0d530fdc-1ae3-4234-ba8f-52ebbb710659',
  '6d5eb025-a5d9-49c4-b395-206e6e96674d',
  '5bf0e47e-0e9e-40b0-833d-d0ab4919548c'
)
AND pga.is_draftable = true
AND (
  (stat.category = 'points'            AND p.season_avg_pts  >= 8.0)
  OR (stat.category = 'rebounds'       AND p.season_avg_reb  >= 3.5)
  OR (stat.category = 'assists'        AND p.season_avg_ast  >= 2.5)
  OR (stat.category = 'three_pointers' AND p.season_avg_3pm  >= 1.0)
  OR (stat.category = 'blocks'         AND p.season_avg_blk  >= 0.8)
)
ON CONFLICT DO NOTHING;
