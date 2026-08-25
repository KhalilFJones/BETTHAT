export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          category: string
          created_at: string
          description: string
          icon_url: string | null
          id: string
          key: string
          name: string
          rarity: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          icon_url?: string | null
          id?: string
          key: string
          name: string
          rarity?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          icon_url?: string | null
          id?: string
          key?: string
          name?: string
          rarity?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          is_secret: boolean
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          description?: string | null
          is_secret?: boolean
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          description?: string | null
          is_secret?: boolean
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      draft_windows: {
        Row: {
          created_at: string
          game_date: string
          id: string
          is_active: boolean
          submission_close_at: string
          submission_open_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_date: string
          id?: string
          is_active?: boolean
          submission_close_at: string
          submission_open_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_date?: string
          id?: string
          is_active?: boolean
          submission_close_at?: string
          submission_open_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      entry_tier_caps: {
        Row: {
          description: string | null
          entry_tier: number
          min_cap: number
          salary_cap: number
        }
        Insert: {
          description?: string | null
          entry_tier: number
          min_cap: number
          salary_cap: number
        }
        Update: {
          description?: string | null
          entry_tier?: number
          min_cap?: number
          salary_cap?: number
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          disabled_user_ids: string[] | null
          enabled_for_pct: number | null
          enabled_user_ids: string[] | null
          environments: string[] | null
          flag_key: string
          id: string
          is_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          disabled_user_ids?: string[] | null
          enabled_for_pct?: number | null
          enabled_user_ids?: string[] | null
          environments?: string[] | null
          flag_key: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          disabled_user_ids?: string[] | null
          enabled_for_pct?: number | null
          enabled_user_ids?: string[] | null
          environments?: string[] | null
          flag_key?: string
          id?: string
          is_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_challenges: {
        Row: {
          challenger_id: string
          challenger_lineup_id: string
          created_at: string
          entry_tier: number
          expires_at: string
          id: string
          matchup_id: string | null
          message: string | null
          recipient_id: string
          status: string
          updated_at: string
        }
        Insert: {
          challenger_id: string
          challenger_lineup_id: string
          created_at?: string
          entry_tier: number
          expires_at?: string
          id?: string
          matchup_id?: string | null
          message?: string | null
          recipient_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          challenger_id?: string
          challenger_lineup_id?: string
          created_at?: string
          entry_tier?: number
          expires_at?: string
          id?: string
          matchup_id?: string | null
          message?: string | null
          recipient_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_challenges_challenger_id_fkey"
            columns: ["challenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_challenges_challenger_lineup_id_fkey"
            columns: ["challenger_lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_challenges_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_challenges_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friends: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          requester_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          requester_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          requester_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_entries: {
        Row: {
          calculated_at: string
          id: string
          losses: number
          period_key: string
          period_type: string
          rank: number
          score: number
          user_id: string
          win_rate: number | null
          wins: number
        }
        Insert: {
          calculated_at?: string
          id?: string
          losses?: number
          period_key: string
          period_type: string
          rank: number
          score?: number
          user_id: string
          win_rate?: number | null
          wins?: number
        }
        Update: {
          calculated_at?: string
          id?: string
          losses?: number
          period_key?: string
          period_type?: string
          rank?: number
          score?: number
          user_id?: string
          win_rate?: number | null
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lineup_players: {
        Row: {
          created_at: string
          fantasy_points_scored: number | null
          frozen_price: number
          game_id: string | null
          id: string
          lineup_id: string
          player_id: string
          slot_number: number
        }
        Insert: {
          created_at?: string
          fantasy_points_scored?: number | null
          frozen_price: number
          game_id?: string | null
          id?: string
          lineup_id: string
          player_id: string
          slot_number: number
        }
        Update: {
          created_at?: string
          fantasy_points_scored?: number | null
          frozen_price?: number
          game_id?: string | null
          id?: string
          lineup_id?: string
          player_id?: string
          slot_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lineup_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineup_players_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineup_players_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineup_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "lineup_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      lineups: {
        Row: {
          created_at: string
          entry_tier: number
          fantasy_points_total: number | null
          game_date: string | null
          id: string
          is_friend_challenge: boolean
          locked_at: string | null
          max_wager: number | null
          status: string
          submission_close_at: string | null
          submitted_at: string | null
          total_cap_used: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_tier: number
          fantasy_points_total?: number | null
          game_date?: string | null
          id?: string
          is_friend_challenge?: boolean
          locked_at?: string | null
          max_wager?: number | null
          status?: string
          submission_close_at?: string | null
          submitted_at?: string | null
          total_cap_used?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_tier?: number
          fantasy_points_total?: number | null
          game_date?: string | null
          id?: string
          is_friend_challenge?: boolean
          locked_at?: string | null
          max_wager?: number | null
          status?: string
          submission_close_at?: string | null
          submitted_at?: string | null
          total_cap_used?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_player_scores: {
        Row: {
          assists: number | null
          blocks: number | null
          fantasy_points: number
          game_id: string
          game_status: string | null
          id: string
          last_updated: string
          lineup_id: string
          lineup_player_id: string
          minutes_played: number | null
          player_id: string
          points: number | null
          rebounds: number | null
          steals: number | null
          turnovers: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          fantasy_points?: number
          game_id: string
          game_status?: string | null
          id?: string
          last_updated?: string
          lineup_id: string
          lineup_player_id: string
          minutes_played?: number | null
          player_id: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          turnovers?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          fantasy_points?: number
          game_id?: string
          game_status?: string | null
          id?: string
          last_updated?: string
          lineup_id?: string
          lineup_player_id?: string
          minutes_played?: number | null
          player_id?: string
          points?: number | null
          rebounds?: number | null
          steals?: number | null
          turnovers?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_player_scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_player_scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_player_scores_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_player_scores_lineup_player_id_fkey"
            columns: ["lineup_player_id"]
            isOneToOne: false
            referencedRelation: "lineup_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_player_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "live_player_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      matchmaking_queue: {
        Row: {
          entry_tier: number
          expires_at: string
          game_date: string
          id: string
          lineup_id: string
          max_wager: number | null
          queued_at: string
          user_id: string
        }
        Insert: {
          entry_tier: number
          expires_at?: string
          game_date: string
          id?: string
          lineup_id: string
          max_wager?: number | null
          queued_at?: string
          user_id: string
        }
        Update: {
          entry_tier?: number
          expires_at?: string
          game_date?: string
          id?: string
          lineup_id?: string
          max_wager?: number | null
          queued_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchmaking_queue_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: true
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchmaking_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matchup_activity_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          fpts_delta: number
          game_clock: string | null
          game_id: string | null
          game_period: number | null
          id: string
          lineup_id: string | null
          matchup_id: string
          player_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          fpts_delta?: number
          game_clock?: string | null
          game_id?: string | null
          game_period?: number | null
          id?: string
          lineup_id?: string | null
          matchup_id: string
          player_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          fpts_delta?: number
          game_clock?: string | null
          game_id?: string | null
          game_period?: number | null
          id?: string
          lineup_id?: string | null
          matchup_id?: string
          player_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matchup_activity_events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_activity_events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_activity_events_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_activity_events_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_activity_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "matchup_activity_events_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      matchup_disputes: {
        Row: {
          created_at: string
          details: string | null
          id: string
          matchup_id: string
          opened_by: string
          reason: string
          resolution: string | null
          resolved_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          matchup_id: string
          opened_by: string
          reason: string
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          matchup_id?: string
          opened_by?: string
          reason?: string
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchup_disputes_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_disputes_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_disputes_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matchup_games: {
        Row: {
          created_at: string
          game_id: string
          id: string
          matchup_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          matchup_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          matchup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchup_games_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_games_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_games_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
        ]
      }
      matchup_score_snapshots: {
        Row: {
          game_clock: string | null
          id: string
          matchup_id: string
          period: number | null
          recorded_at: string
          user1_score: number
          user2_score: number
        }
        Insert: {
          game_clock?: string | null
          id?: string
          matchup_id: string
          period?: number | null
          recorded_at?: string
          user1_score?: number
          user2_score?: number
        }
        Update: {
          game_clock?: string | null
          id?: string
          matchup_id?: string
          period?: number | null
          recorded_at?: string
          user1_score?: number
          user2_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "matchup_score_snapshots_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
        ]
      }
      matchups: {
        Row: {
          completed_at: string | null
          created_at: string
          entry_tier: number
          game_date: string | null
          id: string
          is_friend_challenge: boolean
          lineup1_id: string
          lineup2_id: string | null
          matched_at: string | null
          payout_amount: number
          pot_amount: number
          rake_amount: number
          score_margin: number | null
          settled_wager: number | null
          started_at: string | null
          status: string
          updated_at: string
          user1_final_score: number | null
          user1_id: string
          user1_max_wager: number | null
          user1_score: number | null
          user2_final_score: number | null
          user2_id: string | null
          user2_max_wager: number | null
          user2_score: number | null
          winner_lineup_id: string | null
          winner_user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          entry_tier: number
          game_date?: string | null
          id?: string
          is_friend_challenge?: boolean
          lineup1_id: string
          lineup2_id?: string | null
          matched_at?: string | null
          payout_amount: number
          pot_amount: number
          rake_amount: number
          score_margin?: number | null
          settled_wager?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user1_final_score?: number | null
          user1_id: string
          user1_max_wager?: number | null
          user1_score?: number | null
          user2_final_score?: number | null
          user2_id?: string | null
          user2_max_wager?: number | null
          user2_score?: number | null
          winner_lineup_id?: string | null
          winner_user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          entry_tier?: number
          game_date?: string | null
          id?: string
          is_friend_challenge?: boolean
          lineup1_id?: string
          lineup2_id?: string | null
          matched_at?: string | null
          payout_amount?: number
          pot_amount?: number
          rake_amount?: number
          score_margin?: number | null
          settled_wager?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user1_final_score?: number | null
          user1_id?: string
          user1_max_wager?: number | null
          user1_score?: number | null
          user2_final_score?: number | null
          user2_id?: string | null
          user2_max_wager?: number | null
          user2_score?: number | null
          winner_lineup_id?: string | null
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matchups_lineup1_id_fkey"
            columns: ["lineup1_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_lineup2_id_fkey"
            columns: ["lineup2_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_winner_lineup_id_fkey"
            columns: ["winner_lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_winner_user_id_fkey"
            columns: ["winner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nba_games: {
        Row: {
          arena: string | null
          away_score: number | null
          away_team: string
          away_team_abbreviation: string
          away_team_id: string | null
          broadcast: string | null
          created_at: string
          external_id: string | null
          game_clock: string | null
          game_date: string
          home_score: number | null
          home_team: string
          home_team_abbreviation: string
          home_team_id: string | null
          id: string
          is_playoffs: boolean
          period: number | null
          season: string
          series_game_number: number | null
          status: string
          tip_off_time: string | null
          updated_at: string
        }
        Insert: {
          arena?: string | null
          away_score?: number | null
          away_team: string
          away_team_abbreviation: string
          away_team_id?: string | null
          broadcast?: string | null
          created_at?: string
          external_id?: string | null
          game_clock?: string | null
          game_date: string
          home_score?: number | null
          home_team: string
          home_team_abbreviation: string
          home_team_id?: string | null
          id?: string
          is_playoffs?: boolean
          period?: number | null
          season: string
          series_game_number?: number | null
          status?: string
          tip_off_time?: string | null
          updated_at?: string
        }
        Update: {
          arena?: string | null
          away_score?: number | null
          away_team?: string
          away_team_abbreviation?: string
          away_team_id?: string | null
          broadcast?: string | null
          created_at?: string
          external_id?: string | null
          game_clock?: string | null
          game_date?: string
          home_score?: number | null
          home_team?: string
          home_team_abbreviation?: string
          home_team_id?: string | null
          id?: string
          is_playoffs?: boolean
          period?: number | null
          season?: string
          series_game_number?: number | null
          status?: string
          tip_off_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nba_games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nba_games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "nba_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nba_games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nba_games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "nba_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      nba_players: {
        Row: {
          birth_date: string | null
          created_at: string
          external_id: string | null
          first_name: string
          full_name: string
          headshot_url: string | null
          height_inches: number | null
          id: string
          injury_expected_return: string | null
          injury_note: string | null
          is_active: boolean
          is_injured: boolean
          jersey_number: string | null
          last_name: string
          last5_avg_3pm: number | null
          last5_avg_ast: number | null
          last5_avg_blk: number | null
          last5_avg_fpts: number | null
          last5_avg_min: number | null
          last5_avg_pts: number | null
          last5_avg_reb: number | null
          last5_avg_stl: number | null
          last5_avg_to: number | null
          last5_games_played: number | null
          position: string
          salary_tier: string | null
          season_avg_3pm: number | null
          season_avg_ast: number | null
          season_avg_blk: number | null
          season_avg_fpts: number | null
          season_avg_min: number | null
          season_avg_pts: number | null
          season_avg_reb: number | null
          season_avg_stl: number | null
          season_avg_to: number | null
          season_games_played: number | null
          team: string
          team_abbreviation: string
          team_id: string | null
          ticker_handle: string | null
          updated_at: string
          weight_lbs: number | null
          years_experience: number | null
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          external_id?: string | null
          first_name: string
          full_name: string
          headshot_url?: string | null
          height_inches?: number | null
          id?: string
          injury_expected_return?: string | null
          injury_note?: string | null
          is_active?: boolean
          is_injured?: boolean
          jersey_number?: string | null
          last_name: string
          last5_avg_3pm?: number | null
          last5_avg_ast?: number | null
          last5_avg_blk?: number | null
          last5_avg_fpts?: number | null
          last5_avg_min?: number | null
          last5_avg_pts?: number | null
          last5_avg_reb?: number | null
          last5_avg_stl?: number | null
          last5_avg_to?: number | null
          last5_games_played?: number | null
          position: string
          salary_tier?: string | null
          season_avg_3pm?: number | null
          season_avg_ast?: number | null
          season_avg_blk?: number | null
          season_avg_fpts?: number | null
          season_avg_min?: number | null
          season_avg_pts?: number | null
          season_avg_reb?: number | null
          season_avg_stl?: number | null
          season_avg_to?: number | null
          season_games_played?: number | null
          team: string
          team_abbreviation: string
          team_id?: string | null
          ticker_handle?: string | null
          updated_at?: string
          weight_lbs?: number | null
          years_experience?: number | null
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          external_id?: string | null
          first_name?: string
          full_name?: string
          headshot_url?: string | null
          height_inches?: number | null
          id?: string
          injury_expected_return?: string | null
          injury_note?: string | null
          is_active?: boolean
          is_injured?: boolean
          jersey_number?: string | null
          last_name?: string
          last5_avg_3pm?: number | null
          last5_avg_ast?: number | null
          last5_avg_blk?: number | null
          last5_avg_fpts?: number | null
          last5_avg_min?: number | null
          last5_avg_pts?: number | null
          last5_avg_reb?: number | null
          last5_avg_stl?: number | null
          last5_avg_to?: number | null
          last5_games_played?: number | null
          position?: string
          salary_tier?: string | null
          season_avg_3pm?: number | null
          season_avg_ast?: number | null
          season_avg_blk?: number | null
          season_avg_fpts?: number | null
          season_avg_min?: number | null
          season_avg_pts?: number | null
          season_avg_reb?: number | null
          season_avg_stl?: number | null
          season_avg_to?: number | null
          season_games_played?: number | null
          team?: string
          team_abbreviation?: string
          team_id?: string | null
          ticker_handle?: string | null
          updated_at?: string
          weight_lbs?: number | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nba_players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nba_players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "nba_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      nba_teams: {
        Row: {
          abbreviation: string
          arena: string | null
          city: string
          conference: string
          created_at: string
          division: string
          full_name: string
          id: string
          is_active: boolean
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          updated_at: string
        }
        Insert: {
          abbreviation: string
          arena?: string | null
          city: string
          conference: string
          created_at?: string
          division: string
          full_name: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          arena?: string | null
          city?: string
          conference?: string
          created_at?: string
          division?: string
          full_name?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          email_matchup_results: boolean
          email_promotions: boolean
          email_security_alerts: boolean
          email_weekly_summary: boolean
          id: string
          inapp_price_alerts: boolean
          push_achievement_earned: boolean
          push_deposit_confirmed: boolean
          push_friend_challenge: boolean
          push_friend_request: boolean
          push_game_final: boolean
          push_game_starting: boolean
          push_matchup_found: boolean
          push_price_alert: boolean
          push_withdrawal_processed: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          email_matchup_results?: boolean
          email_promotions?: boolean
          email_security_alerts?: boolean
          email_weekly_summary?: boolean
          id?: string
          inapp_price_alerts?: boolean
          push_achievement_earned?: boolean
          push_deposit_confirmed?: boolean
          push_friend_challenge?: boolean
          push_friend_request?: boolean
          push_game_final?: boolean
          push_game_starting?: boolean
          push_matchup_found?: boolean
          push_price_alert?: boolean
          push_withdrawal_processed?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          email_matchup_results?: boolean
          email_promotions?: boolean
          email_security_alerts?: boolean
          email_weekly_summary?: boolean
          id?: string
          inapp_price_alerts?: boolean
          push_achievement_earned?: boolean
          push_deposit_confirmed?: boolean
          push_friend_challenge?: boolean
          push_friend_request?: boolean
          push_game_final?: boolean
          push_game_starting?: boolean
          push_matchup_found?: boolean
          push_price_alert?: boolean
          push_withdrawal_processed?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          id: string
          is_push_sent: boolean
          is_read: boolean
          push_error: string | null
          sent_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          id?: string
          is_push_sent?: boolean
          is_read?: boolean
          push_error?: string | null
          sent_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          id?: string
          is_push_sent?: boolean
          is_read?: boolean
          push_error?: string | null
          sent_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_methods: {
        Row: {
          account_last4: string | null
          bank_name: string | null
          created_at: string
          display_name: string
          email_or_handle: string | null
          id: string
          is_active: boolean
          is_default: boolean
          is_verified: boolean
          method_type: string
          plaid_account_id: string | null
          routing_last4: string | null
          stripe_bank_account_id: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          account_last4?: string | null
          bank_name?: string | null
          created_at?: string
          display_name: string
          email_or_handle?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_verified?: boolean
          method_type: string
          plaid_account_id?: string | null
          routing_last4?: string | null
          stripe_bank_account_id?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          account_last4?: string | null
          bank_name?: string | null
          created_at?: string
          display_name?: string
          email_or_handle?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_verified?: boolean
          method_type?: string
          plaid_account_id?: string | null
          routing_last4?: string | null
          stripe_bank_account_id?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      player_game_availability: {
        Row: {
          created_at: string
          game_date: string
          game_id: string
          is_confirmed: boolean
          is_draftable: boolean
          player_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_date: string
          game_id: string
          is_confirmed?: boolean
          is_draftable?: boolean
          player_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_date?: string
          game_id?: string
          is_confirmed?: boolean
          is_draftable?: boolean
          player_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_game_availability_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_availability_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_availability_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_game_availability_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_game_stats: {
        Row: {
          assists: number | null
          blocks: number | null
          created_at: string
          fantasy_points: number | null
          field_goals_attempted: number | null
          field_goals_made: number | null
          free_throws_attempted: number | null
          free_throws_made: number | null
          game_id: string
          id: string
          is_final: boolean
          minutes_played: number | null
          player_id: string
          plus_minus: number | null
          points: number | null
          rebounds: number | null
          status: string
          steals: number | null
          three_pointers_made: number | null
          turnovers: number | null
          updated_at: string
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          fantasy_points?: number | null
          field_goals_attempted?: number | null
          field_goals_made?: number | null
          free_throws_attempted?: number | null
          free_throws_made?: number | null
          game_id: string
          id?: string
          is_final?: boolean
          minutes_played?: number | null
          player_id: string
          plus_minus?: number | null
          points?: number | null
          rebounds?: number | null
          status?: string
          steals?: number | null
          three_pointers_made?: number | null
          turnovers?: number | null
          updated_at?: string
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          created_at?: string
          fantasy_points?: number | null
          field_goals_attempted?: number | null
          field_goals_made?: number | null
          free_throws_attempted?: number | null
          free_throws_made?: number | null
          game_id?: string
          id?: string
          is_final?: boolean
          minutes_played?: number | null
          player_id?: string
          plus_minus?: number | null
          points?: number | null
          rebounds?: number | null
          status?: string
          steals?: number | null
          three_pointers_made?: number | null
          turnovers?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_game_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_game_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_news: {
        Row: {
          body: string | null
          created_at: string
          headline: string
          id: string
          impact: string | null
          news_type: string
          player_id: string
          published_at: string
          source: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          headline: string
          id?: string
          impact?: string | null
          news_type: string
          player_id: string
          published_at?: string
          source?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          headline?: string
          id?: string
          impact?: string | null
          news_type?: string
          player_id?: string
          published_at?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_news_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_news_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_prices: {
        Row: {
          avg_price_24h: number | null
          base_price: number
          created_at: string
          current_price: number
          demand_count_1h: number | null
          demand_level: string | null
          fair_price: number | null
          id: string
          injury_modifier: number | null
          is_locked: boolean
          lock_reason: string | null
          market_close_at: string | null
          market_open_at: string | null
          matchup_modifier: number | null
          next_game_id: string | null
          player_id: string
          price_acceleration: number | null
          price_ceiling: number
          price_change_24h: number | null
          price_change_pct_24h: number | null
          price_floor: number
          price_velocity: number | null
          tier: string | null
          total_selections: number | null
          updated_at: string
        }
        Insert: {
          avg_price_24h?: number | null
          base_price: number
          created_at?: string
          current_price: number
          demand_count_1h?: number | null
          demand_level?: string | null
          fair_price?: number | null
          id?: string
          injury_modifier?: number | null
          is_locked?: boolean
          lock_reason?: string | null
          market_close_at?: string | null
          market_open_at?: string | null
          matchup_modifier?: number | null
          next_game_id?: string | null
          player_id: string
          price_acceleration?: number | null
          price_ceiling: number
          price_change_24h?: number | null
          price_change_pct_24h?: number | null
          price_floor: number
          price_velocity?: number | null
          tier?: string | null
          total_selections?: number | null
          updated_at?: string
        }
        Update: {
          avg_price_24h?: number | null
          base_price?: number
          created_at?: string
          current_price?: number
          demand_count_1h?: number | null
          demand_level?: string | null
          fair_price?: number | null
          id?: string
          injury_modifier?: number | null
          is_locked?: boolean
          lock_reason?: string | null
          market_close_at?: string | null
          market_open_at?: string | null
          matchup_modifier?: number | null
          next_game_id?: string | null
          player_id?: string
          price_acceleration?: number | null
          price_ceiling?: number
          price_change_24h?: number | null
          price_change_pct_24h?: number | null
          price_floor?: number
          price_velocity?: number | null
          tier?: string | null
          total_selections?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_prices_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_prices_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_season_stats: {
        Row: {
          assist_to_ratio: number | null
          assists_per_game: number | null
          blocks_per_game: number | null
          created_at: string
          def_reb_pg: number | null
          fantasy_pts_pg: number | null
          fg_pct: number | null
          fg3_pct: number | null
          ft_pct: number | null
          games_played: number
          games_started: number
          id: string
          last_synced_at: string
          minutes_per_game: number | null
          off_reb_pg: number | null
          player_id: string
          points_per_game: number | null
          reb_per_game: number | null
          season: string
          season_type: string
          steals_per_game: number | null
          turnovers_pg: number | null
          updated_at: string
        }
        Insert: {
          assist_to_ratio?: number | null
          assists_per_game?: number | null
          blocks_per_game?: number | null
          created_at?: string
          def_reb_pg?: number | null
          fantasy_pts_pg?: number | null
          fg_pct?: number | null
          fg3_pct?: number | null
          ft_pct?: number | null
          games_played?: number
          games_started?: number
          id?: string
          last_synced_at?: string
          minutes_per_game?: number | null
          off_reb_pg?: number | null
          player_id: string
          points_per_game?: number | null
          reb_per_game?: number | null
          season: string
          season_type?: string
          steals_per_game?: number | null
          turnovers_pg?: number | null
          updated_at?: string
        }
        Update: {
          assist_to_ratio?: number | null
          assists_per_game?: number | null
          blocks_per_game?: number | null
          created_at?: string
          def_reb_pg?: number | null
          fantasy_pts_pg?: number | null
          fg_pct?: number | null
          fg3_pct?: number | null
          ft_pct?: number | null
          games_played?: number
          games_started?: number
          id?: string
          last_synced_at?: string
          minutes_per_game?: number | null
          off_reb_pg?: number | null
          player_id?: string
          points_per_game?: number | null
          reb_per_game?: number | null
          season?: string
          season_type?: string
          steals_per_game?: number | null
          turnovers_pg?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_season_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_season_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      price_engine_config: {
        Row: {
          base_price_range_max: number
          base_price_range_min: number
          created_at: string
          demand_sensitivity: number
          id: string
          injury_discount: number
          matchup_modifier_range: number
          max_velocity: number
          tier: string
          updated_at: string
        }
        Insert: {
          base_price_range_max: number
          base_price_range_min: number
          created_at?: string
          demand_sensitivity?: number
          id?: string
          injury_discount?: number
          matchup_modifier_range?: number
          max_velocity?: number
          tier: string
          updated_at?: string
        }
        Update: {
          base_price_range_max?: number
          base_price_range_min?: number
          created_at?: string
          demand_sensitivity?: number
          id?: string
          injury_discount?: number
          matchup_modifier_range?: number
          max_velocity?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          id: string
          player_id: string
          price: number
          recorded_at: string
          volume: number | null
        }
        Insert: {
          id?: string
          player_id: string
          price: number
          recorded_at?: string
          volume?: number | null
        }
        Update: {
          id?: string
          player_id?: string
          price?: number
          recorded_at?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "price_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          date_of_birth: string | null
          display_name: string | null
          id: string
          is_banned: boolean
          kyc_status: string
          last_active_at: string | null
          onboarding_step: string | null
          phone_number: string | null
          pin_hash: string | null
          push_token: string | null
          rank_tier: string | null
          referral_code: string | null
          referred_by: string | null
          state: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          total_earnings: number
          total_entries: number
          total_losses: number
          total_wins: number
          tutorial_completed: boolean
          tutorial_completed_at: string | null
          updated_at: string
          username: string
          win_rate: number | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          id: string
          is_banned?: boolean
          kyc_status?: string
          last_active_at?: string | null
          onboarding_step?: string | null
          phone_number?: string | null
          pin_hash?: string | null
          push_token?: string | null
          rank_tier?: string | null
          referral_code?: string | null
          referred_by?: string | null
          state?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          total_earnings?: number
          total_entries?: number
          total_losses?: number
          total_wins?: number
          tutorial_completed?: boolean
          tutorial_completed_at?: string | null
          updated_at?: string
          username: string
          win_rate?: number | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_name?: string | null
          id?: string
          is_banned?: boolean
          kyc_status?: string
          last_active_at?: string | null
          onboarding_step?: string | null
          phone_number?: string | null
          pin_hash?: string | null
          push_token?: string | null
          rank_tier?: string | null
          referral_code?: string | null
          referred_by?: string | null
          state?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          total_earnings?: number
          total_entries?: number
          total_losses?: number
          total_wins?: number
          tutorial_completed?: boolean
          tutorial_completed_at?: string | null
          updated_at?: string
          username?: string
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          max_uses_per_user: number
          min_deposit: number | null
          type: string
          updated_at: string
          uses_count: number
          value: number
          value_type: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number
          min_deposit?: number | null
          type: string
          updated_at?: string
          uses_count?: number
          value: number
          value_type?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number
          min_deposit?: number | null
          type?: string
          updated_at?: string
          uses_count?: number
          value?: number
          value_type?: string
        }
        Relationships: []
      }
      prop_lines: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_active: boolean
          line_value: number
          over_odds: number | null
          player_id: string
          source: string | null
          stat_category: string
          under_odds: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_active?: boolean
          line_value: number
          over_odds?: number | null
          player_id: string
          source?: string | null
          stat_category: string
          under_odds?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_active?: boolean
          line_value?: number
          over_odds?: number | null
          player_id?: string
          source?: string | null
          stat_category?: string
          under_odds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop_lines_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "mv_todays_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop_lines_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nba_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mv_player_market"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "prop_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string | null
          id: string
          is_active: boolean
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          paid_at: string | null
          referred_id: string
          referrer_id: string
          reward_amount: number
          reward_type: string
          status: string
          transaction_id: string | null
          trigger_event: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          referred_id: string
          referrer_id: string
          reward_amount?: number
          reward_type: string
          status?: string
          transaction_id?: string | null
          trigger_event: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          paid_at?: string | null
          referred_id?: string
          referrer_id?: string
          reward_amount?: number
          reward_type?: string
          status?: string
          transaction_id?: string | null
          trigger_event?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      responsible_gaming_settings: {
        Row: {
          cooling_off_until: string | null
          created_at: string
          daily_deposit_limit: number | null
          daily_entry_limit: number | null
          id: string
          is_permanently_excluded: boolean
          last_reality_check_at: string | null
          loss_limit_daily: number | null
          loss_limit_weekly: number | null
          max_open_bets: number | null
          monthly_deposit_limit: number | null
          reality_check_interval: number | null
          self_excluded_until: string | null
          session_time_limit_mins: number | null
          updated_at: string
          user_id: string
          weekly_deposit_limit: number | null
        }
        Insert: {
          cooling_off_until?: string | null
          created_at?: string
          daily_deposit_limit?: number | null
          daily_entry_limit?: number | null
          id?: string
          is_permanently_excluded?: boolean
          last_reality_check_at?: string | null
          loss_limit_daily?: number | null
          loss_limit_weekly?: number | null
          max_open_bets?: number | null
          monthly_deposit_limit?: number | null
          reality_check_interval?: number | null
          self_excluded_until?: string | null
          session_time_limit_mins?: number | null
          updated_at?: string
          user_id: string
          weekly_deposit_limit?: number | null
        }
        Update: {
          cooling_off_until?: string | null
          created_at?: string
          daily_deposit_limit?: number | null
          daily_entry_limit?: number | null
          id?: string
          is_permanently_excluded?: boolean
          last_reality_check_at?: string | null
          loss_limit_daily?: number | null
          loss_limit_weekly?: number | null
          max_open_bets?: number | null
          monthly_deposit_limit?: number | null
          reality_check_interval?: number | null
          self_excluded_until?: string | null
          session_time_limit_mins?: number | null
          updated_at?: string
          user_id?: string
          weekly_deposit_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "responsible_gaming_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spend_tracking: {
        Row: {
          deposits_this_month: number
          deposits_this_week: number
          deposits_today: number
          entries_today: number
          id: string
          last_reset_daily: string
          last_reset_monthly: string
          last_reset_weekly: string
          losses_this_month: number
          losses_this_week: number
          losses_today: number
          session_start_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          deposits_this_month?: number
          deposits_this_week?: number
          deposits_today?: number
          entries_today?: number
          id?: string
          last_reset_daily?: string
          last_reset_monthly?: string
          last_reset_weekly?: string
          losses_this_month?: number
          losses_this_week?: number
          losses_today?: number
          session_start_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          deposits_this_month?: number
          deposits_this_week?: number
          deposits_today?: number
          entries_today?: number
          id?: string
          last_reset_daily?: string
          last_reset_monthly?: string
          last_reset_weekly?: string
          losses_this_month?: number
          losses_this_week?: number
          losses_today?: number
          session_start_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spend_tracking_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      state_restrictions: {
        Row: {
          id: string
          is_allowed: boolean
          notes: string | null
          restriction_type: string | null
          state_code: string
          state_name: string
          updated_at: string
        }
        Insert: {
          id?: string
          is_allowed?: boolean
          notes?: string | null
          restriction_type?: string | null
          state_code: string
          state_name: string
          updated_at?: string
        }
        Update: {
          id?: string
          is_allowed?: boolean
          notes?: string | null
          restriction_type?: string | null
          state_code?: string
          state_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          status: string
          stripe_event_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          stripe_event_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          metadata: Json | null
          reference_id: string | null
          reference_type: string | null
          status: string
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          type: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          type: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json | null
          reference_id?: string | null
          reference_type?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          type?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_kyc: {
        Row: {
          address_city: string | null
          address_line1: string | null
          address_state: string | null
          address_zip: string | null
          created_at: string
          date_of_birth: string | null
          expires_at: string | null
          first_name: string | null
          id: string
          id_document_type: string | null
          last_name: string | null
          provider: string | null
          provider_session_id: string | null
          rejection_reason: string | null
          ssn_last4: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          address_zip?: string | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          first_name?: string | null
          id?: string
          id_document_type?: string | null
          last_name?: string | null
          provider?: string | null
          provider_session_id?: string | null
          rejection_reason?: string | null
          ssn_last4?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          address_zip?: string | null
          created_at?: string
          date_of_birth?: string | null
          expires_at?: string | null
          first_name?: string | null
          id?: string
          id_document_type?: string | null
          last_name?: string | null
          provider?: string | null
          provider_session_id?: string | null
          rejection_reason?: string | null
          ssn_last4?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_kyc_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_follows_following_id_fkey"
            columns: ["following_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          attachment_at: string | null
          attachment_kind: string | null
          allow_comments: boolean
          attachment_price: number | null
          audience: string
          body: string | null
          created_at: string
          gif_url: string | null
          id: string
          matchup_id: string | null
          matchup_snapshot: Json | null
          player_id: string | null
          share_count: number
          user_id: string
        }
        Insert: {
          attachment_at?: string | null
          attachment_kind?: string | null
          allow_comments?: boolean
          attachment_price?: number | null
          audience?: string
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          matchup_id?: string | null
          matchup_snapshot?: Json | null
          player_id?: string | null
          share_count?: number
          user_id: string
        }
        Update: {
          attachment_at?: string | null
          attachment_kind?: string | null
          allow_comments?: boolean
          attachment_price?: number | null
          audience?: string
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          matchup_id?: string | null
          matchup_snapshot?: Json | null
          player_id?: string | null
          share_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "nba_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_comments: {
        Row: {
          audio_duration_ms: number | null
          audio_url: string | null
          body: string | null
          created_at: string
          gif_url: string | null
          id: string
          parent_id: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          audio_duration_ms?: number | null
          audio_url?: string | null
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          audio_duration_ms?: number | null
          audio_url?: string | null
          body?: string | null
          created_at?: string
          gif_url?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_promo_redemptions: {
        Row: {
          created_at: string
          credit_amount: number
          id: string
          promo_code_id: string
          status: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credit_amount: number
          id?: string
          promo_code_id: string
          status?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credit_amount?: number
          id?: string
          promo_code_id?: string
          status?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_promo_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_promo_redemptions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_promo_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          context_id: string | null
          context_type: string | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_id: string
          reporter_id: string
          resolution: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_id: string
          reporter_id: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_id?: string
          reporter_id?: string
          resolution?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_search: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          rank_tier: string | null
          search_vector: unknown
          total_wins: number | null
          user_id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          rank_tier?: string | null
          search_vector?: unknown
          total_wins?: number | null
          user_id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          rank_tier?: string | null
          search_vector?: unknown
          total_wins?: number | null
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_search_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          escrow_balance: number
          id: string
          last_deposit_at: string | null
          last_withdrawal_at: string | null
          lifetime_winnings: number
          pending_withdrawal: number
          stripe_customer_id: string | null
          total_deposited: number
          total_withdrawn: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          escrow_balance?: number
          id?: string
          last_deposit_at?: string | null
          last_withdrawal_at?: string | null
          lifetime_winnings?: number
          pending_withdrawal?: number
          stripe_customer_id?: string | null
          total_deposited?: number
          total_withdrawn?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          escrow_balance?: number
          id?: string
          last_deposit_at?: string | null
          last_withdrawal_at?: string | null
          lifetime_winnings?: number
          pending_withdrawal?: number
          stripe_customer_id?: string | null
          total_deposited?: number
          total_withdrawn?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_requests: {
        Row: {
          amount: number
          created_at: string
          destination_details: Json
          id: string
          method: string
          payout_method_id: string | null
          processed_at: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          stripe_transfer_id: string | null
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          destination_details?: Json
          id?: string
          method: string
          payout_method_id?: string | null
          processed_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          destination_details?: Json
          id?: string
          method?: string
          payout_method_id?: string | null
          processed_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_transfer_id?: string | null
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_requests_payout_method_id_fkey"
            columns: ["payout_method_id"]
            isOneToOne: false
            referencedRelation: "payout_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawal_requests_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mv_player_market: {
        Row: {
          assists_per_game: number | null
          blocks_per_game: number | null
          current_price: number | null
          demand_level: string | null
          fantasy_pts_pg: number | null
          full_name: string | null
          games_played: number | null
          is_active: boolean | null
          is_injured: boolean | null
          jersey_number: string | null
          player_id: string | null
          points_per_game: number | null
          position: string | null
          price_updated_at: string | null
          price_velocity: number | null
          reb_per_game: number | null
          salary_tier: string | null
          steals_per_game: number | null
          team_abbr: string | null
          team_color: string | null
          team_id: string | null
          team_logo: string | null
          team_name: string | null
        }
        Relationships: []
      }
      mv_todays_games: {
        Row: {
          away_score: number | null
          away_team: string | null
          away_team_abbreviation: string | null
          away_team_color: string | null
          away_team_logo: string | null
          broadcast: string | null
          external_id: string | null
          game_clock: string | null
          game_date: string | null
          home_score: number | null
          home_team: string | null
          home_team_abbreviation: string | null
          home_team_color: string | null
          home_team_logo: string | null
          id: string | null
          is_playoffs: boolean | null
          period: number | null
          season: string | null
          status: string | null
          tip_off_time: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// =============================================================================
// CONVENIENCE TYPE ALIASES
// Re-exported from the generated table definitions so app code can write
// `Profile` instead of `Database['public']['Tables']['profiles']['Row']`.
// Add new aliases here as additional tables are referenced from the UI layer.
// =============================================================================

type _PublicTables = Database['public']['Tables'];
type _PublicViews  = Database['public']['Views'];

export type Profile               = _PublicTables['profiles']['Row'];
export type Wallet                = _PublicTables['wallets']['Row'];
export type Transaction           = _PublicTables['transactions']['Row'];
export type NbaPlayer             = _PublicTables['nba_players']['Row'];
export type NbaTeam               = _PublicTables['nba_teams']['Row'];
export type NbaGame               = _PublicTables['nba_games']['Row'];
export type PlayerPrice           = _PublicTables['player_prices']['Row'];
export type PriceHistoryRow       = _PublicTables['price_history']['Row'];
export type Lineup                = _PublicTables['lineups']['Row'];
export type LineupPlayer          = _PublicTables['lineup_players']['Row'];
export type Matchup               = _PublicTables['matchups']['Row'];
export type MatchmakingQueue      = _PublicTables['matchmaking_queue']['Row'];
export type MatchupActivityEvent  = _PublicTables['matchup_activity_events']['Row'];
export type Friend                = _PublicTables['friends']['Row'];
export type FriendChallenge       = _PublicTables['friend_challenges']['Row'];
export type Achievement           = _PublicTables['achievements']['Row'];
export type UserAchievement       = _PublicTables['user_achievements']['Row'];
export type Notification          = _PublicTables['notifications']['Row'];
export type UserNotification      = Notification;
export type NotificationPreference= _PublicTables['notification_preferences']['Row'];
export type ResponsibleGamingConfig = _PublicTables['responsible_gaming_settings']['Row'];
export type LeaderboardEntry      = _PublicTables['leaderboard_entries']['Row'];
export type AppConfig             = _PublicTables['app_config']['Row'];
export type FeatureFlag           = _PublicTables['feature_flags']['Row'];
export type StateRestriction      = _PublicTables['state_restrictions']['Row'];
export type EntryTierCap          = _PublicTables['entry_tier_caps']['Row'];
export type PlayerNews            = _PublicTables['player_news']['Row'];
export type PlayerGameStats       = _PublicTables['player_game_stats']['Row'];
export type PlayerSeasonStats     = _PublicTables['player_season_stats']['Row'];
export type PromoCode             = _PublicTables['promo_codes']['Row'];
export type PayoutMethod          = _PublicTables['payout_methods']['Row'];
export type WithdrawalRequest     = _PublicTables['withdrawal_requests']['Row'];
export type DraftWindow           = _PublicTables['draft_windows']['Row'];

// Materialized views (when present)
export type PlayerMarket          = _PublicViews extends { mv_player_market: { Row: infer R } } ? R : never;
export type TodayGame             = _PublicViews extends { mv_todays_games: { Row: infer R } } ? R : never;
