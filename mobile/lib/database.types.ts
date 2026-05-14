// Auto-generated type stubs — run `supabase gen types typescript` to regenerate
// from the full Supabase project schema.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          total_wins: number;
          total_losses: number;
          total_earnings: number;
          rank_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
          is_banned: boolean;
          kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected';
          state: string | null;
          referral_code: string | null;
          referred_by: string | null;
          win_rate: number;
          email: string | null;
          full_name: string | null;
          push_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          total_wins?: number;
          total_losses?: number;
          total_earnings?: number;
          rank_tier?: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
          is_banned?: boolean;
          kyc_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
          state?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          email?: string | null;
          full_name?: string | null;
          push_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          total_wins?: number;
          total_losses?: number;
          total_earnings?: number;
          rank_tier?: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
          is_banned?: boolean;
          kyc_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
          state?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          email?: string | null;
          full_name?: string | null;
          push_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          balance: number;
          escrow_balance: number;
          total_deposited: number;
          total_withdrawn: number;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          balance?: number;
          escrow_balance?: number;
          total_deposited?: number;
          total_withdrawn?: number;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          balance?: number;
          escrow_balance?: number;
          total_deposited?: number;
          total_withdrawn?: number;
          stripe_customer_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          wallet_id: string;
          user_id: string;
          type: 'deposit' | 'withdrawal' | 'entry_fee' | 'payout' | 'rake' | 'escrow_hold' | 'escrow_release' | 'refund' | 'sidebet_wager' | 'sidebet_payout';
          amount: number;
          balance_after: number;
          reference_id: string | null;
          reference_type: string | null;
          description: string | null;
          status: 'pending' | 'completed' | 'failed' | 'reversed';
          created_at: string;
        };
        Insert: {
          id?: string;
          wallet_id?: string;
          user_id: string;
          type: 'deposit' | 'withdrawal' | 'entry_fee' | 'payout' | 'rake' | 'escrow_hold' | 'escrow_release' | 'refund' | 'sidebet_wager' | 'sidebet_payout';
          amount: number;
          balance_after: number;
          reference_id?: string | null;
          reference_type?: string | null;
          description?: string | null;
          status?: 'pending' | 'completed' | 'failed' | 'reversed';
          created_at?: string;
        };
        Update: {
          id?: string;
          wallet_id?: string;
          user_id?: string;
          type?: 'deposit' | 'withdrawal' | 'entry_fee' | 'payout' | 'rake' | 'escrow_hold' | 'escrow_release' | 'refund' | 'sidebet_wager' | 'sidebet_payout';
          amount?: number;
          balance_after?: number;
          reference_id?: string | null;
          reference_type?: string | null;
          description?: string | null;
          status?: 'pending' | 'completed' | 'failed' | 'reversed';
        };
        Relationships: [];
      };
      nba_players: {
        Row: {
          id: string;
          external_id: string | null;
          full_name: string;
          first_name: string;
          last_name: string;
          team: string;
          team_id: string | null;
          team_abbreviation: string;
          position: string;
          jersey_number: string | null;
          headshot_url: string | null;
          is_active: boolean;
          is_injured: boolean;
          injury_note: string | null;
          salary_tier: 'budget' | 'mid' | 'star' | 'superstar' | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id?: string | null;
          full_name: string;
          first_name?: string;
          last_name?: string;
          team?: string;
          team_id?: string | null;
          team_abbreviation?: string;
          position?: string;
          jersey_number?: string | null;
          headshot_url?: string | null;
          is_active?: boolean;
          is_injured?: boolean;
          injury_note?: string | null;
          salary_tier?: 'budget' | 'mid' | 'star' | 'superstar' | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string | null;
          full_name?: string;
          first_name?: string;
          last_name?: string;
          team?: string;
          team_id?: string | null;
          team_abbreviation?: string;
          position?: string;
          jersey_number?: string | null;
          headshot_url?: string | null;
          is_active?: boolean;
          is_injured?: boolean;
          injury_note?: string | null;
          salary_tier?: 'budget' | 'mid' | 'star' | 'superstar' | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      nba_games: {
        Row: {
          id: string;
          external_id: string | null;
          home_team_id: string | null;
          away_team_id: string | null;
          home_team: string;
          away_team: string;
          home_team_abbreviation: string;
          away_team_abbreviation: string;
          game_date: string;
          tip_off_time: string | null;
          status: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
          home_score: number;
          away_score: number;
          quarter: number | null;
          time_remaining: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          external_id?: string | null;
          home_team_id?: string | null;
          away_team_id?: string | null;
          home_team: string;
          away_team: string;
          home_team_abbreviation: string;
          away_team_abbreviation: string;
          game_date: string;
          tip_off_time?: string | null;
          status?: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
          home_score?: number;
          away_score?: number;
          quarter?: number | null;
          time_remaining?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          external_id?: string | null;
          home_team_id?: string | null;
          away_team_id?: string | null;
          home_team?: string;
          away_team?: string;
          home_team_abbreviation?: string;
          away_team_abbreviation?: string;
          game_date?: string;
          tip_off_time?: string | null;
          status?: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
          home_score?: number;
          away_score?: number;
          quarter?: number | null;
          time_remaining?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_game_stats: {
        Row: {
          id: string;
          player_id: string;
          game_id: string;
          points: number;
          rebounds: number;
          assists: number;
          steals: number;
          blocks: number;
          turnovers: number;
          minutes_played: number | null;
          fantasy_points: number; // generated column
          is_final: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          game_id: string;
          points?: number;
          rebounds?: number;
          assists?: number;
          steals?: number;
          blocks?: number;
          turnovers?: number;
          minutes_played?: number | null;
          is_final?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          game_id?: string;
          points?: number;
          rebounds?: number;
          assists?: number;
          steals?: number;
          blocks?: number;
          turnovers?: number;
          minutes_played?: number | null;
          is_final?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_prices: {
        Row: {
          id: string;
          player_id: string;
          current_price: number;
          base_price: number;
          demand_level: number;
          price_velocity: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          current_price: number;
          base_price?: number;
          demand_level?: number;
          price_velocity?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          current_price?: number;
          base_price?: number;
          demand_level?: number;
          price_velocity?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      lineups: {
        Row: {
          id: string;
          user_id: string;
          matchup_id: string | null;
          entry_tier: '$1' | '$5' | '$10' | '$20' | '$50';
          salary_cap: number;
          total_salary: number;
          status: 'draft' | 'submitted' | 'locked' | 'scored';
          total_fantasy_points: number | null;
          submission_close_at: string | null;
          locked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          matchup_id?: string | null;
          entry_tier: '$1' | '$5' | '$10' | '$20' | '$50';
          salary_cap?: number;
          total_salary?: number;
          status?: 'draft' | 'submitted' | 'locked' | 'scored';
          total_fantasy_points?: number | null;
          submission_close_at?: string | null;
          locked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          matchup_id?: string | null;
          entry_tier?: '$1' | '$5' | '$10' | '$20' | '$50';
          salary_cap?: number;
          total_salary?: number;
          status?: 'draft' | 'submitted' | 'locked' | 'scored';
          total_fantasy_points?: number | null;
          submission_close_at?: string | null;
          locked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      lineup_players: {
        Row: {
          id: string;
          lineup_id: string;
          player_id: string;
          price_at_selection: number;
          slot_position: string;
          fantasy_points_earned: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lineup_id: string;
          player_id: string;
          price_at_selection?: number;
          slot_position: string;
          fantasy_points_earned?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lineup_id?: string;
          player_id?: string;
          price_at_selection?: number;
          slot_position?: string;
          fantasy_points_earned?: number | null;
        };
        Relationships: [];
      };
      matchups: {
        Row: {
          id: string;
          creator_id: string;
          opponent_id: string | null;
          entry_tier: '$1' | '$5' | '$10' | '$20' | '$50';
          entry_fee: number;
          pot: number;
          rake_amount: number;
          status: 'pending' | 'matched' | 'live' | 'completed' | 'cancelled' | 'refunded';
          winner_id: string | null;
          creator_score: number | null;
          opponent_score: number | null;
          game_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          opponent_id?: string | null;
          entry_tier: '$1' | '$5' | '$10' | '$20' | '$50';
          entry_fee: number;
          pot?: number;
          rake_amount?: number;
          status?: 'pending' | 'matched' | 'live' | 'completed' | 'cancelled' | 'refunded';
          winner_id?: string | null;
          creator_score?: number | null;
          opponent_score?: number | null;
          game_date: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          opponent_id?: string | null;
          entry_tier?: '$1' | '$5' | '$10' | '$20' | '$50';
          entry_fee?: number;
          pot?: number;
          rake_amount?: number;
          status?: 'pending' | 'matched' | 'live' | 'completed' | 'cancelled' | 'refunded';
          winner_id?: string | null;
          creator_score?: number | null;
          opponent_score?: number | null;
          game_date?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sidebets: {
        Row: {
          id: string;
          creator_id: string;
          acceptor_id: string | null;
          player_id: string;
          game_id: string;
          prop_type: 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'fantasy_points';
          prop_line: number;
          creator_side: 'over' | 'under';
          wager_amount: number;
          rake_amount: number;
          status: 'open' | 'matched' | 'live' | 'completed' | 'cancelled' | 'expired';
          result: 'creator_win' | 'acceptor_win' | 'push' | null;
          is_friend_bet: boolean;
          targeted_user_id: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          acceptor_id?: string | null;
          player_id: string;
          game_id: string;
          prop_type: 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'fantasy_points';
          prop_line: number;
          creator_side: 'over' | 'under';
          wager_amount: number;
          rake_amount?: number;
          status?: 'open' | 'matched' | 'live' | 'completed' | 'cancelled' | 'expired';
          result?: 'creator_win' | 'acceptor_win' | 'push' | null;
          is_friend_bet?: boolean;
          targeted_user_id?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          acceptor_id?: string | null;
          player_id?: string;
          game_id?: string;
          prop_type?: 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'fantasy_points';
          prop_line?: number;
          creator_side?: 'over' | 'under';
          wager_amount?: number;
          rake_amount?: number;
          status?: 'open' | 'matched' | 'live' | 'completed' | 'cancelled' | 'expired';
          result?: 'creator_win' | 'acceptor_win' | 'push' | null;
          is_friend_bet?: boolean;
          targeted_user_id?: string | null;
          expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      friends: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: 'pending' | 'accepted' | 'declined' | 'blocked';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: 'pending' | 'accepted' | 'declined' | 'blocked';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          requester_id?: string;
          addressee_id?: string;
          status?: 'pending' | 'accepted' | 'declined' | 'blocked';
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          body: string;
          data: Json | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          body: string;
          data?: Json | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: string;
          title?: string;
          body?: string;
          data?: Json | null;
          is_read?: boolean;
        };
        Relationships: [];
      };
      achievements: {
        Row: {
          id: string;
          key: string;
          title: string;
          description: string;
          icon: string;
          points: number;
          rarity: 'common' | 'rare' | 'epic' | 'legendary' | null;
          points_required: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          title: string;
          description: string;
          icon: string;
          points: number;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary' | null;
          points_required?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          title?: string;
          description?: string;
          icon?: string;
          points?: number;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary' | null;
          points_required?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_achievements: {
        Row: {
          id: string;
          user_id: string;
          achievement_id: string;
          earned_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          achievement_id: string;
          earned_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          achievement_id?: string;
          earned_at?: string;
        };
        Relationships: [];
      };
      leaderboard_entries: {
        Row: {
          id: string;
          user_id: string;
          period_type: 'daily' | 'weekly' | 'monthly' | 'all_time';
          period_key: string;
          rank: number;
          total_earnings: number;
          wins: number;
          losses: number;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_type: 'daily' | 'weekly' | 'monthly' | 'all_time';
          period_key: string;
          rank?: number;
          total_earnings?: number;
          wins?: number;
          losses?: number;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_type?: 'daily' | 'weekly' | 'monthly' | 'all_time';
          period_key?: string;
          rank?: number;
          total_earnings?: number;
          wins?: number;
          losses?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_season_stats: {
        Row: {
          id: string;
          player_id: string;
          season: string;
          season_type: 'regular' | 'playoffs';
          games_played: number;
          points_per_game: number | null;
          reb_per_game: number | null;
          assists_per_game: number | null;
          steals_per_game: number | null;
          blocks_per_game: number | null;
          fg_pct: number | null;
          fg3_pct: number | null;
          ft_pct: number | null;
          fantasy_pts_pg: number | null;
          last_synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          season: string;
          season_type?: 'regular' | 'playoffs';
          games_played?: number;
          points_per_game?: number | null;
          reb_per_game?: number | null;
          assists_per_game?: number | null;
          steals_per_game?: number | null;
          blocks_per_game?: number | null;
          fg_pct?: number | null;
          fg3_pct?: number | null;
          ft_pct?: number | null;
          fantasy_pts_pg?: number | null;
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          season?: string;
          season_type?: 'regular' | 'playoffs';
          games_played?: number;
          points_per_game?: number | null;
          reb_per_game?: number | null;
          assists_per_game?: number | null;
          steals_per_game?: number | null;
          blocks_per_game?: number | null;
          fg_pct?: number | null;
          fg3_pct?: number | null;
          ft_pct?: number | null;
          fantasy_pts_pg?: number | null;
          last_synced_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      feature_flags: {
        Row: {
          id: string;
          flag_key: string;
          description: string | null;
          is_enabled: boolean;
          enabled_for_pct: number;
          enabled_user_ids: string[];
          disabled_user_ids: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          flag_key: string;
          description?: string | null;
          is_enabled?: boolean;
          enabled_for_pct?: number;
          enabled_user_ids?: string[];
          disabled_user_ids?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          flag_key?: string;
          description?: string | null;
          is_enabled?: boolean;
          enabled_for_pct?: number;
          enabled_user_ids?: string[];
          disabled_user_ids?: string[];
          updated_at?: string;
        };
        Relationships: [];
      };
      nba_teams: {
        Row: {
          id: string;
          external_id: string | null;
          full_name: string;
          abbreviation: string;
          city: string;
          conference: 'East' | 'West';
          division: string;
          primary_color: string | null;
          secondary_color: string | null;
          logo_url: string | null;
        };
        Insert: {
          id?: string;
          external_id?: string | null;
          full_name: string;
          abbreviation: string;
          city: string;
          conference: 'East' | 'West';
          division: string;
          primary_color?: string | null;
          secondary_color?: string | null;
          logo_url?: string | null;
        };
        Update: {
          id?: string;
          external_id?: string | null;
          full_name?: string;
          abbreviation?: string;
          city?: string;
          conference?: 'East' | 'West';
          division?: string;
          primary_color?: string | null;
          secondary_color?: string | null;
          logo_url?: string | null;
        };
        Relationships: [];
      };
      responsible_gaming_settings: {
        Row: {
          id: string;
          user_id: string;
          daily_deposit_limit: number | null;
          weekly_deposit_limit: number | null;
          monthly_deposit_limit: number | null;
          daily_spend_limit: number | null;
          weekly_spend_limit: number | null;
          monthly_spend_limit: number | null;
          self_exclusion_until: string | null;
          is_self_excluded: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          daily_deposit_limit?: number | null;
          weekly_deposit_limit?: number | null;
          monthly_deposit_limit?: number | null;
          daily_spend_limit?: number | null;
          weekly_spend_limit?: number | null;
          monthly_spend_limit?: number | null;
          self_exclusion_until?: string | null;
          is_self_excluded?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          daily_deposit_limit?: number | null;
          weekly_deposit_limit?: number | null;
          monthly_deposit_limit?: number | null;
          daily_spend_limit?: number | null;
          weekly_spend_limit?: number | null;
          monthly_spend_limit?: number | null;
          self_exclusion_until?: string | null;
          is_self_excluded?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      mv_player_market: {
        Row: {
          player_id: string;
          full_name: string;
          position: string;
          jersey_number: string | null;
          is_active: boolean;
          is_injured: boolean;
          salary_tier: string | null;
          team_id: string | null;
          team_name: string | null;
          team_abbr: string | null;
          team_color: string | null;
          team_logo: string | null;
          current_price: number | null;
          demand_level: number | null;
          price_velocity: number | null;
          price_updated_at: string | null;
          points_per_game: number | null;
          reb_per_game: number | null;
          assists_per_game: number | null;
          steals_per_game: number | null;
          blocks_per_game: number | null;
          fantasy_pts_pg: number | null;
          games_played: number | null;
        };
        Relationships: [];
      };
      mv_todays_games: {
        Row: {
          id: string;
          home_team: string;
          away_team: string;
          home_team_abbreviation: string;
          away_team_abbreviation: string;
          home_team_logo: string | null;
          away_team_logo: string | null;
          game_date: string;
          tip_off_time: string | null;
          status: string;
          home_score: number;
          away_score: number;
        };
        Relationships: [];
      };
      mv_open_sidebets: {
        Row: {
          id: string;
          creator_id: string;
          creator_username: string;
          creator_avatar: string | null;
          player_id: string;
          player_name: string;
          team_abbr: string;
          game_id: string;
          game_date: string;
          prop_type: string;
          prop_line: number;
          creator_side: 'over' | 'under';
          wager_amount: number;
          is_friend_bet: boolean;
          targeted_user_id: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience row types
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Wallet = Database['public']['Tables']['wallets']['Row'];
export type Transaction = Database['public']['Tables']['transactions']['Row'];
export type NBAPlayer = Database['public']['Tables']['nba_players']['Row'];
export type NBAGame = Database['public']['Tables']['nba_games']['Row'];
export type PlayerGameStats = Database['public']['Tables']['player_game_stats']['Row'];
export type PlayerPrice = Database['public']['Tables']['player_prices']['Row'];
export type Lineup = Database['public']['Tables']['lineups']['Row'];
export type LineupPlayer = Database['public']['Tables']['lineup_players']['Row'];
export type Matchup = Database['public']['Tables']['matchups']['Row'];
export type Sidebet = Database['public']['Tables']['sidebets']['Row'];
export type Friend = Database['public']['Tables']['friends']['Row'];
export type Notification = Database['public']['Tables']['notifications']['Row'];
export type Achievement = Database['public']['Tables']['achievements']['Row'];
export type UserAchievement = Database['public']['Tables']['user_achievements']['Row'];
export type LeaderboardEntry = Database['public']['Tables']['leaderboard_entries']['Row'];
export type PlayerSeasonStats = Database['public']['Tables']['player_season_stats']['Row'];
export type NBATeam = Database['public']['Tables']['nba_teams']['Row'];

// Aliases for screen compatibility - using actual table names
export type FriendRequest = Database['public']['Tables']['friends']['Row'];
export type UserNotification = Database['public']['Tables']['notifications']['Row'];
export type ResponsibleGamingConfig = Database['public']['Tables']['responsible_gaming_settings']['Row'];

// NotificationPreference is inline (no separate table in DB)
export type NotificationPreference = {
  user_id: string;
  matchup_result: boolean;
  lineup_lock_reminder: boolean;
  sidebet_updates: boolean;
  friend_activity: boolean;
  promotions: boolean;
};

// Materialized view types
export type PlayerMarket = Database['public']['Views']['mv_player_market']['Row'];
export type TodayGame = Database['public']['Views']['mv_todays_games']['Row'];
export type OpenSidebet = Database['public']['Views']['mv_open_sidebets']['Row'];
