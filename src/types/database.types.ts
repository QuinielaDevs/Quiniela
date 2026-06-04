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
      league_members: {
        Row: {
          id: string
          joined_at: string
          league_id: string
          payment_status: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          league_id: string
          payment_status?: string
          role?: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          league_id?: string
          payment_status?: string
          role?: string
          user_id?: string
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
          away_team: string
          away_team_code: string | null
          created_at: string
          external_ref: string | null
          home_score: number | null
          home_team: string
          home_team_code: string | null
          id: string
          match_time: string
          matchday: number | null
          stage: string | null
          status: string
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team: string
          away_team_code?: string | null
          created_at?: string
          external_ref?: string | null
          home_score?: number | null
          home_team: string
          home_team_code?: string | null
          id?: string
          match_time: string
          matchday?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team?: string
          away_team_code?: string | null
          created_at?: string
          external_ref?: string | null
          home_score?: number | null
          home_team?: string
          home_team_code?: string | null
          id?: string
          match_time?: string
          matchday?: number | null
          stage?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      predictions: {
        Row: {
          away_score_pred: number
          created_at: string
          home_score_pred: number
          id: string
          league_id: string
          match_id: string
          multiplier: number
          points_earned: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          away_score_pred: number
          created_at?: string
          home_score_pred: number
          id?: string
          league_id: string
          match_id: string
          multiplier?: number
          points_earned?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          away_score_pred?: number
          created_at?: string
          home_score_pred?: number
          id?: string
          league_id?: string
          match_id?: string
          multiplier?: number
          points_earned?: number | null
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
          avatar_url: string
          created_at: string
          display_name: string
          email: string | null
          id: string
        }
        Insert: {
          avatar_url?: string
          created_at?: string
          display_name?: string
          email?: string | null
          id: string
        }
        Update: {
          avatar_url?: string
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fn_create_league: {
        Args: {
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
        }
        SetofOptions: {
          from: "*"
          to: "league_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_match_editable: { Args: { p_match_id: string }; Returns: boolean }
      fn_match_unlocked: { Args: { p_match_id: string }; Returns: boolean }
      fn_prediction_multiplier: {
        Args: { p_match_time: string }
        Returns: number
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
          home_score_pred: number
          id: string
          league_id: string
          match_id: string
          multiplier: number
          points_earned: number | null
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
      fn_user_in_league: { Args: { p_league_id: string }; Returns: boolean }
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

