export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      award_candidates: {
        Row: {
          category: string
          created_at: string
          display_order: number
          flag_code: string | null
          id: string
          image_url: string | null
          is_active: boolean
          is_winner: boolean
          name: string
          team_name: string | null
        }
        Insert: {
          category: string
          created_at?: string
          display_order?: number
          flag_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_winner?: boolean
          name: string
          team_name?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          display_order?: number
          flag_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_winner?: boolean
          name?: string
          team_name?: string | null
        }
        Relationships: []
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          joined_at: string
          prediction_away: number
          prediction_home: number
          user_id: string
        }
        Insert: {
          challenge_id: string
          joined_at?: string
          prediction_away: number
          prediction_home: number
          user_id: string
        }
        Update: {
          challenge_id?: string
          joined_at?: string
          prediction_away?: number
          prediction_home?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          challenged_id: string | null
          created_at: string
          creator_id: string
          id: string
          league_id: string
          match_id: string
          points_bet: number
          status: string
          type: string
          winner_ids: string[] | null
        }
        Insert: {
          challenged_id?: string | null
          created_at?: string
          creator_id: string
          id?: string
          league_id: string
          match_id: string
          points_bet: number
          status?: string
          type: string
          winner_ids?: string[] | null
        }
        Update: {
          challenged_id?: string | null
          created_at?: string
          creator_id?: string
          id?: string
          league_id?: string
          match_id?: string
          points_bet?: number
          status?: string
          type?: string
          winner_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "challenges_challenged_id_fkey"
            columns: ["challenged_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      league_members: {
        Row: {
          id: string
          joined_at: string
          league_id: string
          payment_status: string
          role: string
          user_id: string
          wager_balance: number
        }
        Insert: {
          id?: string
          joined_at?: string
          league_id: string
          payment_status?: string
          role?: string
          user_id: string
          wager_balance?: number
        }
        Update: {
          id?: string
          joined_at?: string
          league_id?: string
          payment_status?: string
          role?: string
          user_id?: string
          wager_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          created_by: string
          header_word: string
          id: string
          invite_code: string
          name: string
          payment_amount: number | null
          payment_instructions: string | null
          requires_payment: boolean
          rules: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          header_word?: string
          id?: string
          invite_code: string
          name: string
          payment_amount?: number | null
          payment_instructions?: string | null
          requires_payment?: boolean
          rules?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          header_word?: string
          id?: string
          invite_code?: string
          name?: string
          payment_amount?: number | null
          payment_instructions?: string | null
          requires_payment?: boolean
          rules?: Json
        }
        Relationships: [
          {
            foreignKeyName: "leagues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          away_score: number | null
          away_source: string | null
          away_team: string
          away_team_code: string | null
          bracket_slot: number | null
          created_at: string
          external_ref: string | null
          group_label: string | null
          home_score: number | null
          home_source: string | null
          home_team: string
          home_team_code: string | null
          id: string
          match_time: string
          matchday: number | null
          stage: string | null
          status: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          away_score?: number | null
          away_source?: string | null
          away_team: string
          away_team_code?: string | null
          bracket_slot?: number | null
          created_at?: string
          external_ref?: string | null
          group_label?: string | null
          home_score?: number | null
          home_source?: string | null
          home_team: string
          home_team_code?: string | null
          id?: string
          match_time: string
          matchday?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          away_score?: number | null
          away_source?: string | null
          away_team?: string
          away_team_code?: string | null
          bracket_slot?: number | null
          created_at?: string
          external_ref?: string | null
          group_label?: string | null
          home_score?: number | null
          home_source?: string | null
          home_team?: string
          home_team_code?: string | null
          id?: string
          match_time?: string
          matchday?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      member_badges: {
        Row: {
          badge_label: string
          badge_type: string
          created_at: string
          earned_at: string
          id: string
          league_id: string
          matchday: number
          points: number
          reason: string
          user_id: string
        }
        Insert: {
          badge_label: string
          badge_type: string
          created_at?: string
          earned_at?: string
          id?: string
          league_id: string
          matchday: number
          points?: number
          reason: string
          user_id: string
        }
        Update: {
          badge_label?: string
          badge_type?: string
          created_at?: string
          earned_at?: string
          id?: string
          league_id?: string
          matchday?: number
          points?: number
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_badges_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_game_profiles: {
        Row: {
          computed_at: string
          created_at: string
          id: string
          league_id: string
          matchday: number
          profile_label: string
          profile_type: string
          summary: string
          user_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          id?: string
          league_id: string
          matchday: number
          profile_label: string
          profile_type: string
          summary: string
          user_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          id?: string
          league_id?: string
          matchday?: number
          profile_label?: string
          profile_type?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_game_profiles_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_game_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      point_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          league_id: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          league_id: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          league_id?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          away_score_pred: number
          created_at: string
          evaluated_at: string | null
          home_score_pred: number
          id: string
          league_id: string
          match_id: string
          multiplier: number
          points_earned: number | null
          prev_away_score_pred: number | null
          prev_home_score_pred: number | null
          prev_multiplier: number | null
          prev_saved_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          away_score_pred: number
          created_at?: string
          evaluated_at?: string | null
          home_score_pred: number
          id?: string
          league_id: string
          match_id: string
          multiplier?: number
          points_earned?: number | null
          prev_away_score_pred?: number | null
          prev_home_score_pred?: number | null
          prev_multiplier?: number | null
          prev_saved_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          away_score_pred?: number
          created_at?: string
          evaluated_at?: string | null
          home_score_pred?: number
          id?: string
          league_id?: string
          match_id?: string
          multiplier?: number
          points_earned?: number | null
          prev_away_score_pred?: number | null
          prev_home_score_pred?: number | null
          prev_multiplier?: number | null
          prev_saved_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_league_id: string | null
          avatar_url: string
          created_at: string
          display_name: string
          email: string | null
          id: string
        }
        Insert: {
          active_league_id?: string | null
          avatar_url?: string
          created_at?: string
          display_name?: string
          email?: string | null
          id: string
        }
        Update: {
          active_league_id?: string | null
          avatar_url?: string
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_league_id_fkey"
            columns: ["active_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      special_predictions: {
        Row: {
          candidate_id: string
          category: string
          created_at: string
          id: string
          league_id: string
          predicted_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          category: string
          created_at?: string
          id?: string
          league_id: string
          predicted_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          category?: string
          created_at?: string
          id?: string
          league_id?: string
          predicted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "special_predictions_candidate_id_category_fkey"
            columns: ["candidate_id", "category"]
            isOneToOne: false
            referencedRelation: "award_candidates"
            referencedColumns: ["id", "category"]
          },
          {
            foreignKeyName: "special_predictions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      tournament_phases: {
        Row: {
          created_at: string
          edits_locked: boolean
          ends_at: string | null
          id: string
          label: string
          phase_code: string
          reward_points: number
          sort_order: number
          starts_at: string | null
        }
        Insert: {
          created_at?: string
          edits_locked?: boolean
          ends_at?: string | null
          id?: string
          label: string
          phase_code: string
          reward_points: number
          sort_order: number
          starts_at?: string | null
        }
        Update: {
          created_at?: string
          edits_locked?: boolean
          ends_at?: string | null
          id?: string
          label?: string
          phase_code?: string
          reward_points?: number
          sort_order?: number
          starts_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      special_predictions_with_points: {
        Row: {
          candidate_id: string | null
          category: string | null
          created_at: string | null
          id: string | null
          is_correct: boolean | null
          league_id: string | null
          points: number | null
          predicted_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "special_predictions_candidate_id_category_fkey"
            columns: ["candidate_id", "category"]
            isOneToOne: false
            referencedRelation: "award_candidates"
            referencedColumns: ["id", "category"]
          },
          {
            foreignKeyName: "special_predictions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_challenge: {
        Args: {
          p_challenge_id: string
          p_prediction_away: number
          p_prediction_home: number
        }
        Returns: undefined
      }
      cancel_challenge: { Args: { p_challenge_id: string }; Returns: undefined }
      check_conservation_invariant: {
        Args: { p_league_id: string; p_user_id: string }
        Returns: boolean
      }
      create_challenge: {
        Args: {
          p_challenged_id?: string
          p_league_id: string
          p_match_id: string
          p_points_bet: number
          p_prediction_away?: number
          p_prediction_home?: number
          p_type: string
        }
        Returns: string
      }
      fn_admin_apply_knockout_advancement: {
        Args: { p_slots: Json }
        Returns: {
          away_score: number | null
          away_source: string | null
          away_team: string
          away_team_code: string | null
          bracket_slot: number | null
          created_at: string
          external_ref: string | null
          group_label: string | null
          home_score: number | null
          home_source: string | null
          home_team: string
          home_team_code: string | null
          id: string
          match_time: string
          matchday: number | null
          stage: string | null
          status: string
          updated_at: string
          venue: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fn_admin_set_match_result: {
        Args: {
          p_away_score: number
          p_home_score: number
          p_match_id: string
          p_status: string
        }
        Returns: {
          away_score: number | null
          away_source: string | null
          away_team: string
          away_team_code: string | null
          bracket_slot: number | null
          created_at: string
          external_ref: string | null
          group_label: string | null
          home_score: number | null
          home_source: string | null
          home_team: string
          home_team_code: string | null
          id: string
          match_time: string
          matchday: number | null
          stage: string | null
          status: string
          updated_at: string
          venue: string | null
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_are_special_predictions_locked: { Args: never; Returns: boolean }
      fn_create_league: {
        Args: {
          p_header_word?: string
          p_invite_code: string
          p_name: string
          p_payment_amount?: number
          p_payment_instructions?: string
          p_prediction_mode: string
          p_requires_payment?: boolean
        }
        Returns: {
          created_at: string
          created_by: string
          header_word: string
          id: string
          invite_code: string
          name: string
          payment_amount: number | null
          payment_instructions: string | null
          requires_payment: boolean
          rules: Json
        }
        SetofOptions: {
          from: "*"
          to: "leagues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_ensure_default_predictions: {
        Args: { p_league_id: string }
        Returns: number
      }
      fn_get_active_tournament_phase: {
        Args: never
        Returns: {
          created_at: string
          edits_locked: boolean
          ends_at: string | null
          id: string
          label: string
          phase_code: string
          reward_points: number
          sort_order: number
          starts_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tournament_phases"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fn_get_challenge_landing: {
        Args: { p_challenge_id: string }
        Returns: {
          away_team: string
          away_team_code: string
          challenge_id: string
          challenged_display_name: string
          challenged_id: string
          challenged_prediction_away: number
          challenged_prediction_home: number
          creator_avatar_url: string
          creator_display_name: string
          creator_id: string
          creator_prediction_away: number
          creator_prediction_home: number
          home_team: string
          home_team_code: string
          invite_code: string
          league_id: string
          league_name: string
          match_id: string
          match_status: string
          match_time: string
          points_bet: number
          status: string
          type: string
        }[]
      }
      fn_get_invite_landing: {
        Args: { p_invite_code: string }
        Returns: {
          creator_avatar_url: string
          creator_display_name: string
          invite_code: string
          league_name: string
          payment_amount: number
          payment_instructions: string
          requires_payment: boolean
        }[]
      }
      fn_join_league_by_invite: {
        Args: { p_invite_code: string }
        Returns: {
          id: string
          joined_at: string
          league_id: string
          payment_status: string
          role: string
          user_id: string
          wager_balance: number
        }
        SetofOptions: {
          from: "*"
          to: "league_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_current_round_ordinal: { Args: never; Returns: number }
      fn_leave_league: { Args: { p_league_id: string }; Returns: undefined }
      fn_match_editable: { Args: { p_match_id: string }; Returns: boolean }
      fn_match_round_ordinal: {
        Args: { p_matchday: number; p_stage: string }
        Returns: number
      }
      fn_match_unlocked: { Args: { p_match_id: string }; Returns: boolean }
      fn_prediction_multiplier: {
        Args: { p_matchday: number; p_stage: string }
        Returns: number
      }
      fn_promote_member_to_admin: {
        Args: { p_league_id: string; p_user_id: string }
        Returns: {
          id: string
          joined_at: string
          league_id: string
          payment_status: string
          role: string
          user_id: string
          wager_balance: number
        }
        SetofOptions: {
          from: "*"
          to: "league_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_remove_member: {
        Args: { p_league_id: string; p_user_id: string }
        Returns: undefined
      }
      fn_revert_prediction: {
        Args: { p_league_id: string; p_match_id: string }
        Returns: {
          away_score_pred: number
          created_at: string
          evaluated_at: string | null
          home_score_pred: number
          id: string
          league_id: string
          match_id: string
          multiplier: number
          points_earned: number | null
          prev_away_score_pred: number | null
          prev_home_score_pred: number | null
          prev_multiplier: number | null
          prev_saved_at: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "predictions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_save_prediction: {
        Args: {
          p_away_score_pred: number
          p_home_score_pred: number
          p_league_id: string
          p_match_id: string
        }
        Returns: {
          away_score_pred: number
          created_at: string
          evaluated_at: string | null
          home_score_pred: number
          id: string
          league_id: string
          match_id: string
          multiplier: number
          points_earned: number | null
          prev_away_score_pred: number | null
          prev_home_score_pred: number | null
          prev_multiplier: number | null
          prev_saved_at: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "predictions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_set_member_payment_status: {
        Args: { p_league_id: string; p_status: string; p_user_id: string }
        Returns: {
          id: string
          joined_at: string
          league_id: string
          payment_status: string
          role: string
          user_id: string
          wager_balance: number
        }
        SetofOptions: {
          from: "*"
          to: "league_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_set_active_league: {
        Args: { p_league_id: string }
        Returns: {
          active_league_id: string | null
          avatar_url: string
          created_at: string
          display_name: string
          email: string | null
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_sync_tournament_phases_from_matches: {
        Args: never
        Returns: undefined
      }
      fn_user_in_league: { Args: { p_league_id: string }; Returns: boolean }
      fn_user_is_any_league_admin: { Args: never; Returns: boolean }
      fn_user_is_league_admin: {
        Args: { p_league_id: string }
        Returns: boolean
      }
      refund_challenge_escrow: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      reject_challenge: { Args: { p_challenge_id: string }; Returns: undefined }
      score_prediction: {
        Args: {
          p_away_pred: number
          p_away_score: number
          p_home_pred: number
          p_home_score: number
          p_multiplier: number
        }
        Returns: number
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
