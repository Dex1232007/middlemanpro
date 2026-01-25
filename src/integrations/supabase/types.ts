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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      deposits: {
        Row: {
          amount_ton: number
          confirmed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_confirmed: boolean
          profile_id: string
          status: string
          telegram_msg_id: number | null
          ton_tx_hash: string | null
          unique_code: string | null
        }
        Insert: {
          amount_ton: number
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_confirmed?: boolean
          profile_id: string
          status?: string
          telegram_msg_id?: number | null
          ton_tx_hash?: string | null
          unique_code?: string | null
        }
        Update: {
          amount_ton?: number
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_confirmed?: boolean
          profile_id?: string
          status?: string
          telegram_msg_id?: number | null
          ton_tx_hash?: string | null
          unique_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          price_ton: number
          seller_id: string
          title: string
          unique_link: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          price_ton: number
          seller_id: string
          title: string
          unique_link: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          price_ton?: number
          seller_id?: string
          title?: string
          unique_link?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avg_rating: number | null
          balance: number
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string
          id: string
          is_blocked: boolean
          referral_code: string | null
          referred_by: string | null
          telegram_id: number | null
          telegram_username: string | null
          ton_wallet_address: string | null
          total_ratings: number | null
          total_referral_earnings: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avg_rating?: number | null
          balance?: number
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          id?: string
          is_blocked?: boolean
          referral_code?: string | null
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          ton_wallet_address?: string | null
          total_ratings?: number | null
          total_referral_earnings?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avg_rating?: number | null
          balance?: number
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string
          id?: string
          is_blocked?: boolean
          referral_code?: string | null
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          ton_wallet_address?: string | null
          total_ratings?: number | null
          total_referral_earnings?: number | null
          updated_at?: string
          user_id?: string | null
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
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rated_id: string
          rater_id: string
          rating: number
          transaction_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_id: string
          rater_id: string
          rating: number
          transaction_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rated_id?: string
          rater_id?: string
          rating?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_rated_id_fkey"
            columns: ["rated_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_earnings: {
        Row: {
          amount_ton: number
          created_at: string
          from_profile_id: string
          from_transaction_id: string
          id: string
          level: number
          referrer_id: string
        }
        Insert: {
          amount_ton: number
          created_at?: string
          from_profile_id: string
          from_transaction_id: string
          id?: string
          level: number
          referrer_id: string
        }
        Update: {
          amount_ton?: number
          created_at?: string
          from_profile_id?: string
          from_transaction_id?: string
          id?: string
          level?: number
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_earnings_from_profile_id_fkey"
            columns: ["from_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_earnings_from_transaction_id_fkey"
            columns: ["from_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_earnings_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          level: number
          referred_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          referred_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          referred_id?: string
          referrer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_ton: number
          buyer_id: string | null
          buyer_msg_id: number | null
          buyer_telegram_id: number | null
          commission_ton: number
          confirmed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          item_sent_at: string | null
          product_id: string | null
          seller_id: string | null
          seller_receives_ton: number
          status: Database["public"]["Enums"]["transaction_status"]
          ton_tx_hash: string | null
          unique_link: string
          updated_at: string
        }
        Insert: {
          amount_ton: number
          buyer_id?: string | null
          buyer_msg_id?: number | null
          buyer_telegram_id?: number | null
          commission_ton: number
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          item_sent_at?: string | null
          product_id?: string | null
          seller_id?: string | null
          seller_receives_ton: number
          status?: Database["public"]["Enums"]["transaction_status"]
          ton_tx_hash?: string | null
          unique_link: string
          updated_at?: string
        }
        Update: {
          amount_ton?: number
          buyer_id?: string | null
          buyer_msg_id?: number | null
          buyer_telegram_id?: number | null
          commission_ton?: number
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          item_sent_at?: string | null
          product_id?: string | null
          seller_id?: string | null
          seller_receives_ton?: number
          status?: Database["public"]["Enums"]["transaction_status"]
          ton_tx_hash?: string | null
          unique_link?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_states: {
        Row: {
          action: string
          created_at: string
          data: Json | null
          id: string
          msg_id: number | null
          telegram_id: number
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          data?: Json | null
          id?: string
          msg_id?: number | null
          telegram_id: number
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          data?: Json | null
          id?: string
          msg_id?: number | null
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          admin_notes: string | null
          amount_ton: number
          created_at: string
          destination_wallet: string
          id: string
          processed_at: string | null
          profile_id: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          telegram_msg_id: number | null
          ton_tx_hash: string | null
        }
        Insert: {
          admin_notes?: string | null
          amount_ton: number
          created_at?: string
          destination_wallet: string
          id?: string
          processed_at?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          telegram_msg_id?: number | null
          ton_tx_hash?: string | null
        }
        Update: {
          admin_notes?: string | null
          amount_ton?: number
          created_at?: string
          destination_wallet?: string
          id?: string
          processed_at?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          telegram_msg_id?: number | null
          ton_tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      transaction_status:
        | "pending_payment"
        | "payment_received"
        | "item_sent"
        | "completed"
        | "cancelled"
        | "disputed"
      withdrawal_status: "pending" | "approved" | "rejected" | "completed"
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
    Enums: {
      app_role: ["admin", "user"],
      transaction_status: [
        "pending_payment",
        "payment_received",
        "item_sent",
        "completed",
        "cancelled",
        "disputed",
      ],
      withdrawal_status: ["pending", "approved", "rejected", "completed"],
    },
  },
} as const
