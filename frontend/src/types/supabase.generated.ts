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
      air_emission_factors: {
        Row: {
          co2_kg_per_lto_cycle: number
          effective_from: string
          engine_type: string | null
          icao_type: string
          id: string
          source: string | null
        }
        Insert: {
          co2_kg_per_lto_cycle: number
          effective_from: string
          engine_type?: string | null
          icao_type: string
          id?: string
          source?: string | null
        }
        Update: {
          co2_kg_per_lto_cycle?: number
          effective_from?: string
          engine_type?: string | null
          icao_type?: string
          id?: string
          source?: string | null
        }
        Relationships: []
      }
      aircraft: {
        Row: {
          compliance_status: Database["public"]["Enums"]["compliance_status"]
          created_at: string
          engine_type: string | null
          icao_type: string | null
          icao24: string | null
          id: string
          jurisdiction_id: string
          mtow_kg: number | null
          operator_id: string | null
          registration: string | null
          updated_at: string
        }
        Insert: {
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          engine_type?: string | null
          icao_type?: string | null
          icao24?: string | null
          id?: string
          jurisdiction_id?: string
          mtow_kg?: number | null
          operator_id?: string | null
          registration?: string | null
          updated_at?: string
        }
        Update: {
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          engine_type?: string | null
          icao_type?: string | null
          icao24?: string | null
          id?: string
          jurisdiction_id?: string
          mtow_kg?: number | null
          operator_id?: string | null
          registration?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aircraft_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "aircraft_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "aircraft_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aircraft_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      aircraft_positions: {
        Row: {
          aircraft_id: string
          altitude_ft: number | null
          ground_speed_kt: number | null
          heading: number | null
          id: string
          in_fir: boolean
          lat: number
          lng: number
          recorded_at: string
        }
        Insert: {
          aircraft_id: string
          altitude_ft?: number | null
          ground_speed_kt?: number | null
          heading?: number | null
          id?: string
          in_fir?: boolean
          lat: number
          lng: number
          recorded_at?: string
        }
        Update: {
          aircraft_id?: string
          altitude_ft?: number | null
          ground_speed_kt?: number | null
          heading?: number | null
          id?: string
          in_fir?: boolean
          lat?: number
          lng?: number
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aircraft_positions_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      arrival_alerts: {
        Row: {
          aircraft_id: string | null
          arrived_at: string | null
          cancelled_reason: string | null
          created_at: string
          departed_eez_at: string | null
          detected_at: string
          detected_lat: number | null
          detected_lng: number | null
          detection_source: Database["public"]["Enums"]["detection_source"]
          distance_m: number | null
          distance_to_port_nm: number | null
          estimated_eta: string | null
          estimated_route_nm: number | null
          final_transaction_id: string | null
          id: string
          imo_number: string | null
          jurisdiction_id: string
          matched_agent_id: string | null
          matched_via: string | null
          mode: Database["public"]["Enums"]["transport_mode"]
          proforma_transaction_id: string | null
          status: Database["public"]["Enums"]["arrival_alert_status"]
          updated_at: string
          vessel_id: string | null
        }
        Insert: {
          aircraft_id?: string | null
          arrived_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          departed_eez_at?: string | null
          detected_at?: string
          detected_lat?: number | null
          detected_lng?: number | null
          detection_source?: Database["public"]["Enums"]["detection_source"]
          distance_m?: number | null
          distance_to_port_nm?: number | null
          estimated_eta?: string | null
          estimated_route_nm?: number | null
          final_transaction_id?: string | null
          id?: string
          imo_number?: string | null
          jurisdiction_id?: string
          matched_agent_id?: string | null
          matched_via?: string | null
          mode?: Database["public"]["Enums"]["transport_mode"]
          proforma_transaction_id?: string | null
          status?: Database["public"]["Enums"]["arrival_alert_status"]
          updated_at?: string
          vessel_id?: string | null
        }
        Update: {
          aircraft_id?: string | null
          arrived_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          departed_eez_at?: string | null
          detected_at?: string
          detected_lat?: number | null
          detected_lng?: number | null
          detection_source?: Database["public"]["Enums"]["detection_source"]
          distance_m?: number | null
          distance_to_port_nm?: number | null
          estimated_eta?: string | null
          estimated_route_nm?: number | null
          final_transaction_id?: string | null
          id?: string
          imo_number?: string | null
          jurisdiction_id?: string
          matched_agent_id?: string | null
          matched_via?: string | null
          mode?: Database["public"]["Enums"]["transport_mode"]
          proforma_transaction_id?: string | null
          status?: Database["public"]["Enums"]["arrival_alert_status"]
          updated_at?: string
          vessel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arrival_alerts_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arrival_alerts_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arrival_alerts_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "arrival_alerts_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "arrival_alerts_matched_agent_id_fkey"
            columns: ["matched_agent_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "arrival_alerts_matched_agent_id_fkey"
            columns: ["matched_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arrival_alerts_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_final_txn"
            columns: ["final_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_arrival_alert_proforma_txn"
            columns: ["proforma_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          details_json: Json
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
          jurisdiction_id: string | null
          ref: string | null
          severity: Database["public"]["Enums"]["audit_severity"]
          user_full_name: string
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          details_json?: Json
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: unknown
          jurisdiction_id?: string | null
          ref?: string | null
          severity?: Database["public"]["Enums"]["audit_severity"]
          user_full_name: string
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          details_json?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: unknown
          jurisdiction_id?: string | null
          ref?: string | null
          severity?: Database["public"]["Enums"]["audit_severity"]
          user_full_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "audit_logs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      carbon_projects: {
        Row: {
          area_hectares: number
          created_at: string
          credits_available: number
          credits_issued_total: number
          credits_retired_total: number
          description: string
          end_date: string | null
          estimated_tco2_per_year: number
          funding_usd: number
          id: string
          image_url: string | null
          last_verified_at: string | null
          location_lat: number
          location_lng: number
          location_name: string
          name: string
          next_verification_at: string | null
          operator_id: string
          operator_name: string
          price_per_credit_usd: number
          ref: string | null
          sdg_goals: number[]
          start_date: string
          status: Database["public"]["Enums"]["project_status"]
          total_value_usd: number
          type: Database["public"]["Enums"]["project_type"]
          updated_at: string
          verification_standard: Database["public"]["Enums"]["verification_standard"]
        }
        Insert: {
          area_hectares?: number
          created_at?: string
          credits_available?: number
          credits_issued_total?: number
          credits_retired_total?: number
          description: string
          end_date?: string | null
          estimated_tco2_per_year?: number
          funding_usd?: number
          id?: string
          image_url?: string | null
          last_verified_at?: string | null
          location_lat: number
          location_lng: number
          location_name: string
          name: string
          next_verification_at?: string | null
          operator_id: string
          operator_name: string
          price_per_credit_usd?: number
          ref?: string | null
          sdg_goals?: number[]
          start_date: string
          status?: Database["public"]["Enums"]["project_status"]
          total_value_usd?: number
          type: Database["public"]["Enums"]["project_type"]
          updated_at?: string
          verification_standard?: Database["public"]["Enums"]["verification_standard"]
        }
        Update: {
          area_hectares?: number
          created_at?: string
          credits_available?: number
          credits_issued_total?: number
          credits_retired_total?: number
          description?: string
          end_date?: string | null
          estimated_tco2_per_year?: number
          funding_usd?: number
          id?: string
          image_url?: string | null
          last_verified_at?: string | null
          location_lat?: number
          location_lng?: number
          location_name?: string
          name?: string
          next_verification_at?: string | null
          operator_id?: string
          operator_name?: string
          price_per_credit_usd?: number
          ref?: string | null
          sdg_goals?: number[]
          start_date?: string
          status?: Database["public"]["Enums"]["project_status"]
          total_value_usd?: number
          type?: Database["public"]["Enums"]["project_type"]
          updated_at?: string
          verification_standard?: Database["public"]["Enums"]["verification_standard"]
        }
        Relationships: []
      }
      collection_reminders: {
        Row: {
          cc_emails: string[]
          created_at: string
          debtor_response_at: string | null
          debtor_response_type: Database["public"]["Enums"]["debtor_response_type"]
          escalated_bailiff: boolean
          id: string
          seed_ref: string | null
          sent_at: string
          sent_email: string
          template_used: string
          tier: Database["public"]["Enums"]["reminder_tier"]
          transaction_id: string
        }
        Insert: {
          cc_emails?: string[]
          created_at?: string
          debtor_response_at?: string | null
          debtor_response_type?: Database["public"]["Enums"]["debtor_response_type"]
          escalated_bailiff?: boolean
          id?: string
          seed_ref?: string | null
          sent_at: string
          sent_email: string
          template_used: string
          tier: Database["public"]["Enums"]["reminder_tier"]
          transaction_id: string
        }
        Update: {
          cc_emails?: string[]
          created_at?: string
          debtor_response_at?: string | null
          debtor_response_type?: Database["public"]["Enums"]["debtor_response_type"]
          escalated_bailiff?: boolean
          id?: string
          seed_ref?: string | null
          sent_at?: string
          sent_email?: string
          template_used?: string
          tier?: Database["public"]["Enums"]["reminder_tier"]
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collection_reminders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      collections_event: {
        Row: {
          actor_profile_id: string | null
          actor_role: string | null
          amount_usd: number | null
          created_at: string
          event_type: string
          id: string
          note: string | null
          payload_hash: string
          prev_event_hash: string | null
          supersedes_event_id: string | null
          transaction_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          actor_role?: string | null
          amount_usd?: number | null
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
          payload_hash: string
          prev_event_hash?: string | null
          supersedes_event_id?: string | null
          transaction_id: string
        }
        Update: {
          actor_profile_id?: string | null
          actor_role?: string | null
          amount_usd?: number | null
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
          payload_hash?: string
          prev_event_hash?: string | null
          supersedes_event_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_event_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "collections_event_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_event_supersedes_event_id_fkey"
            columns: ["supersedes_event_id"]
            isOneToOne: false
            referencedRelation: "collections_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "collections_event_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      destination_match_proposals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          fuzzy_score: number
          id: string
          imo_number: string | null
          matched_port_guess: string | null
          mmsi: string
          normalized: string
          raw_destination: string
          status: Database["public"]["Enums"]["destination_proposal_status"]
          vessel_name: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fuzzy_score: number
          id?: string
          imo_number?: string | null
          matched_port_guess?: string | null
          mmsi: string
          normalized: string
          raw_destination: string
          status?: Database["public"]["Enums"]["destination_proposal_status"]
          vessel_name?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          fuzzy_score?: number
          id?: string
          imo_number?: string | null
          matched_port_guess?: string | null
          mmsi?: string
          normalized?: string
          raw_destination?: string
          status?: Database["public"]["Enums"]["destination_proposal_status"]
          vessel_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "destination_match_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "destination_match_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_intervals: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          id: string
          note: string | null
          opened_at: string
          opened_by: string | null
          resolution: string | null
          transaction_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          resolution?: string | null
          transaction_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          resolution?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispute_intervals_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "dispute_intervals_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intervals_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "dispute_intervals_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "dispute_intervals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      disputes: {
        Row: {
          created_at: string
          description: string
          evidence_urls: string[] | null
          id: string
          original_amount_usd: number
          reason: Database["public"]["Enums"]["dispute_reason"]
          ref: string | null
          review_note: string | null
          reviewer_id: string | null
          revised_amount_usd: number | null
          status: Database["public"]["Enums"]["dispute_status"]
          submitted_by: string
          transaction_id: string
          updated_at: string
          vessel_id: string
        }
        Insert: {
          created_at?: string
          description: string
          evidence_urls?: string[] | null
          id?: string
          original_amount_usd: number
          reason: Database["public"]["Enums"]["dispute_reason"]
          ref?: string | null
          review_note?: string | null
          reviewer_id?: string | null
          revised_amount_usd?: number | null
          status?: Database["public"]["Enums"]["dispute_status"]
          submitted_by: string
          transaction_id: string
          updated_at?: string
          vessel_id: string
        }
        Update: {
          created_at?: string
          description?: string
          evidence_urls?: string[] | null
          id?: string
          original_amount_usd?: number
          reason?: Database["public"]["Enums"]["dispute_reason"]
          ref?: string | null
          review_note?: string | null
          reviewer_id?: string | null
          revised_amount_usd?: number | null
          status?: Database["public"]["Enums"]["dispute_status"]
          submitted_by?: string
          transaction_id?: string
          updated_at?: string
          vessel_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "disputes_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "disputes_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "disputes_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "disputes_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      emission_factors: {
        Row: {
          active: boolean
          created_at: string
          grams_co2_per_nm: number
          gt_max: number | null
          gt_min: number | null
          id: string
          imo_number: string | null
          notes: string | null
          source: Database["public"]["Enums"]["emission_factor_source"]
          valid_from: string
          valid_until: string | null
          vessel_category: Database["public"]["Enums"]["vessel_category"] | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          grams_co2_per_nm: number
          gt_max?: number | null
          gt_min?: number | null
          id?: string
          imo_number?: string | null
          notes?: string | null
          source: Database["public"]["Enums"]["emission_factor_source"]
          valid_from?: string
          valid_until?: string | null
          vessel_category?:
            | Database["public"]["Enums"]["vessel_category"]
            | null
        }
        Update: {
          active?: boolean
          created_at?: string
          grams_co2_per_nm?: number
          gt_max?: number | null
          gt_min?: number | null
          id?: string
          imo_number?: string | null
          notes?: string | null
          source?: Database["public"]["Enums"]["emission_factor_source"]
          valid_from?: string
          valid_until?: string | null
          vessel_category?:
            | Database["public"]["Enums"]["vessel_category"]
            | null
        }
        Relationships: []
      }
      equasis_scrape_proposals: {
        Row: {
          applied: boolean
          id: string
          imo_number: string
          proposed_country: string | null
          proposed_email: string | null
          proposed_manager: string | null
          proposed_owner_name: string | null
          rejected_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scraped_at: string
          shipowner_id: string | null
          source: string
        }
        Insert: {
          applied?: boolean
          id?: string
          imo_number: string
          proposed_country?: string | null
          proposed_email?: string | null
          proposed_manager?: string | null
          proposed_owner_name?: string | null
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scraped_at?: string
          shipowner_id?: string | null
          source?: string
        }
        Update: {
          applied?: boolean
          id?: string
          imo_number?: string
          proposed_country?: string | null
          proposed_email?: string | null
          proposed_manager?: string | null
          proposed_owner_name?: string | null
          rejected_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scraped_at?: string
          shipowner_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "equasis_scrape_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "equasis_scrape_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equasis_scrape_proposals_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equasis_scrape_proposals_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equasis_scrape_proposals_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      eu_mrv_cache: {
        Row: {
          average_speed_knots: number
          distance_nm: number
          flag_code: string
          gross_tonnage: number
          id: string
          imo_number: string
          reporting_period: string
          ship_type: string
          synced_at: string | null
          time_at_sea_hours: number
          total_co2_emissions: number
          total_fuel_consumption: number
          transport_work: number
          vessel_name: string
        }
        Insert: {
          average_speed_knots?: number
          distance_nm?: number
          flag_code?: string
          gross_tonnage?: number
          id?: string
          imo_number: string
          reporting_period?: string
          ship_type?: string
          synced_at?: string | null
          time_at_sea_hours?: number
          total_co2_emissions?: number
          total_fuel_consumption?: number
          transport_work?: number
          vessel_name?: string
        }
        Update: {
          average_speed_knots?: number
          distance_nm?: number
          flag_code?: string
          gross_tonnage?: number
          id?: string
          imo_number?: string
          reporting_period?: string
          ship_type?: string
          synced_at?: string | null
          time_at_sea_hours?: number
          total_co2_emissions?: number
          total_fuel_consumption?: number
          transport_work?: number
          vessel_name?: string
        }
        Relationships: []
      }
      exemptions: {
        Row: {
          approved_by: string
          created_at: string
          id: string
          notes: string
          reason: Database["public"]["Enums"]["exemption_reason"]
          ref: string | null
          valid_until: string
          vessel_id: string
          vessel_name: string
        }
        Insert: {
          approved_by: string
          created_at?: string
          id?: string
          notes?: string
          reason: Database["public"]["Enums"]["exemption_reason"]
          ref?: string | null
          valid_until: string
          vessel_id: string
          vessel_name: string
        }
        Update: {
          approved_by?: string
          created_at?: string
          id?: string
          notes?: string
          reason?: Database["public"]["Enums"]["exemption_reason"]
          ref?: string | null
          valid_until?: string
          vessel_id?: string
          vessel_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "exemptions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "exemptions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exemptions_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          base_ccy: string
          fetched_at: string
          quote_ccy: string
          rate: number
          source: string
        }
        Insert: {
          base_ccy: string
          fetched_at?: string
          quote_ccy: string
          rate: number
          source: string
        }
        Update: {
          base_ccy?: string
          fetched_at?: string
          quote_ccy?: string
          rate?: number
          source?: string
        }
        Relationships: []
      }
      geofences: {
        Row: {
          active: boolean
          created_at: string
          geometry: Json
          id: string
          jurisdiction_id: string
          kind: string
          mode: Database["public"]["Enums"]["transport_mode"]
          name: string
          ref: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          geometry: Json
          id?: string
          jurisdiction_id: string
          kind: string
          mode: Database["public"]["Enums"]["transport_mode"]
          name: string
          ref: string
        }
        Update: {
          active?: boolean
          created_at?: string
          geometry?: Json
          id?: string
          jurisdiction_id?: string
          kind?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          name?: string
          ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofences_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofences_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "geofences_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          key: string
          method: string
          path: string
          request_hash: string
          response_body: Json | null
          response_status: number | null
          state: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          key: string
          method: string
          path: string
          request_hash: string
          response_body?: Json | null
          response_status?: number | null
          state?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          key?: string
          method?: string
          path?: string
          request_hash?: string
          response_body?: Json | null
          response_status?: number | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      jurisdiction_billing_cc: {
        Row: {
          bailiff_cc_emails: string[]
          cc_emails: string[]
          jurisdiction_id: string
          updated_at: string
        }
        Insert: {
          bailiff_cc_emails?: string[]
          cc_emails?: string[]
          jurisdiction_id: string
          updated_at?: string
        }
        Update: {
          bailiff_cc_emails?: string[]
          cc_emails?: string[]
          jurisdiction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jurisdiction_billing_cc_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurisdiction_billing_cc_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "jurisdiction_billing_cc_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      jurisdiction_issuer_profile: {
        Row: {
          authority_line: string | null
          bailiff_name: string | null
          bank_accounts: Json
          billing_email: string | null
          created_at: string
          decree_reference: string | null
          director_email: string | null
          director_name: string | null
          director_phone: string | null
          director_title: string | null
          dispute_period_days: number | null
          escalation_line: string | null
          id: string
          issuer_address: string | null
          issuer_legal_name: string | null
          issuer_name: string | null
          jurisdiction_id: string | null
          late_penalty_usd: number | null
          legal_basis_url: string | null
          operations_email: string | null
          payment_terms_days: number | null
          sovereign_line: string | null
          supervising_ministry: string | null
          updated_at: string
        }
        Insert: {
          authority_line?: string | null
          bailiff_name?: string | null
          bank_accounts?: Json
          billing_email?: string | null
          created_at?: string
          decree_reference?: string | null
          director_email?: string | null
          director_name?: string | null
          director_phone?: string | null
          director_title?: string | null
          dispute_period_days?: number | null
          escalation_line?: string | null
          id?: string
          issuer_address?: string | null
          issuer_legal_name?: string | null
          issuer_name?: string | null
          jurisdiction_id?: string | null
          late_penalty_usd?: number | null
          legal_basis_url?: string | null
          operations_email?: string | null
          payment_terms_days?: number | null
          sovereign_line?: string | null
          supervising_ministry?: string | null
          updated_at?: string
        }
        Update: {
          authority_line?: string | null
          bailiff_name?: string | null
          bank_accounts?: Json
          billing_email?: string | null
          created_at?: string
          decree_reference?: string | null
          director_email?: string | null
          director_name?: string | null
          director_phone?: string | null
          director_title?: string | null
          dispute_period_days?: number | null
          escalation_line?: string | null
          id?: string
          issuer_address?: string | null
          issuer_legal_name?: string | null
          issuer_name?: string | null
          jurisdiction_id?: string | null
          late_penalty_usd?: number | null
          legal_basis_url?: string | null
          operations_email?: string | null
          payment_terms_days?: number | null
          sovereign_line?: string | null
          supervising_ministry?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jurisdiction_issuer_profile_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurisdiction_issuer_profile_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "jurisdiction_issuer_profile_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: true
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      jurisdiction_mode_config: {
        Row: {
          activated_at: string | null
          enabled: boolean
          geofence_ref: string | null
          jurisdiction_id: string
          methodology_id: string | null
          mode: Database["public"]["Enums"]["transport_mode"]
        }
        Insert: {
          activated_at?: string | null
          enabled?: boolean
          geofence_ref?: string | null
          jurisdiction_id: string
          methodology_id?: string | null
          mode: Database["public"]["Enums"]["transport_mode"]
        }
        Update: {
          activated_at?: string | null
          enabled?: boolean
          geofence_ref?: string | null
          jurisdiction_id?: string
          methodology_id?: string | null
          mode?: Database["public"]["Enums"]["transport_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "jurisdiction_mode_config_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jurisdiction_mode_config_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "jurisdiction_mode_config_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "jurisdiction_mode_config_methodology_id_fkey"
            columns: ["methodology_id"]
            isOneToOne: false
            referencedRelation: "methodologies"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdictions: {
        Row: {
          code: string
          created_at: string
          data_plane: string
          data_plane_ref: string | null
          default_currency: string
          id: string
          locales: string[]
          name: string
          regulator_name: string | null
          sovereign_region: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          data_plane?: string
          data_plane_ref?: string | null
          default_currency?: string
          id?: string
          locales?: string[]
          name: string
          regulator_name?: string | null
          sovereign_region?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          data_plane?: string
          data_plane_ref?: string | null
          default_currency?: string
          id?: string
          locales?: string[]
          name?: string
          regulator_name?: string | null
          sovereign_region?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      methodologies: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          params: Json
          version: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          mode: Database["public"]["Enums"]["transport_mode"]
          params?: Json
          version: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          params?: Json
          version?: string
        }
        Relationships: []
      }
      owner_agent_mappings: {
        Row: {
          active: boolean
          agent_profile_id: string
          created_at: string
          created_by: string | null
          id: string
          priority: number
          shipowner_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          agent_profile_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          priority?: number
          shipowner_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          agent_profile_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          priority?: number
          shipowner_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_agent_mappings_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_agent_mappings_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_members: {
        Row: {
          active: boolean
          can_dispute: boolean
          can_invite: boolean
          can_manage_vessels: boolean
          can_pay: boolean
          created_at: string
          id: string
          invited_by: string | null
          profile_id: string
          revoked_at: string | null
          shipowner_id: string
        }
        Insert: {
          active?: boolean
          can_dispute?: boolean
          can_invite?: boolean
          can_manage_vessels?: boolean
          can_pay?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id: string
          revoked_at?: string | null
          shipowner_id: string
        }
        Update: {
          active?: boolean
          can_dispute?: boolean
          can_invite?: boolean
          can_manage_vessels?: boolean
          can_pay?: boolean
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id?: string
          revoked_at?: string | null
          shipowner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "owner_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "owner_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_members_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_members_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_members_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_notifications: {
        Row: {
          body_key: string
          body_params: Json
          created_at: string
          deep_link: string | null
          emailed_at: string | null
          id: string
          jurisdiction_id: string
          kind: Database["public"]["Enums"]["owner_notification_kind"]
          read_at: string | null
          shipowner_id: string
          title_key: string
        }
        Insert: {
          body_key: string
          body_params?: Json
          created_at?: string
          deep_link?: string | null
          emailed_at?: string | null
          id?: string
          jurisdiction_id?: string
          kind: Database["public"]["Enums"]["owner_notification_kind"]
          read_at?: string | null
          shipowner_id: string
          title_key: string
        }
        Update: {
          body_key?: string
          body_params?: Json
          created_at?: string
          deep_link?: string | null
          emailed_at?: string | null
          id?: string
          jurisdiction_id?: string
          kind?: Database["public"]["Enums"]["owner_notification_kind"]
          read_at?: string | null
          shipowner_id?: string
          title_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "owner_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "owner_notifications_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_notifications_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_notifications_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_statements: {
        Row: {
          generated_at: string
          id: string
          jurisdiction_id: string
          open_count: number
          payments_in_month_usd: number
          pdf_path: string
          period_month: string
          shipowner_id: string
          total_outstanding_usd: number
        }
        Insert: {
          generated_at?: string
          id?: string
          jurisdiction_id: string
          open_count?: number
          payments_in_month_usd?: number
          pdf_path: string
          period_month: string
          shipowner_id: string
          total_outstanding_usd: number
        }
        Update: {
          generated_at?: string
          id?: string
          jurisdiction_id?: string
          open_count?: number
          payments_in_month_usd?: number
          pdf_path?: string
          period_month?: string
          shipowner_id?: string
          total_outstanding_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "owner_statements_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_statements_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "owner_statements_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "owner_statements_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_statements_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_statements_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_config: {
        Row: {
          config_json: Json | null
          display_name: string
          display_order: number
          id: string
          is_active: boolean
          is_enabled: boolean
          provider: string
          routes_rail: string[]
          test_mode: boolean
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          config_json?: Json | null
          display_name?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_enabled?: boolean
          provider: string
          routes_rail?: string[]
          test_mode?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          config_json?: Json | null
          display_name?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_enabled?: boolean
          provider?: string
          routes_rail?: string[]
          test_mode?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payment_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_proofs: {
        Row: {
          description: string | null
          id: string
          mime_type: string
          payment_id: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          description?: string | null
          id?: string
          mime_type: string
          payment_id: string
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          description?: string | null
          id?: string
          mime_type?: string
          payment_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_initiated_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_stripe_webhook_failures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payment_proofs_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          amount_usd_minor: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          currency: string
          declared_by: string | null
          external_reference: string | null
          fx_rate: number | null
          fx_rate_locked_at: string | null
          fx_rate_source: string | null
          id: string
          jurisdiction_id: string
          rail: Database["public"]["Enums"]["payment_rail"]
          rail_details: Json
          receipt_generated_at: string | null
          receipt_ref: string | null
          receipt_storage_path: string | null
          rejected_reason: string | null
          shipowner_id: string
          status: Database["public"]["Enums"]["payment_status_v7"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          amount_usd_minor: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency: string
          declared_by?: string | null
          external_reference?: string | null
          fx_rate?: number | null
          fx_rate_locked_at?: string | null
          fx_rate_source?: string | null
          id?: string
          jurisdiction_id?: string
          rail: Database["public"]["Enums"]["payment_rail"]
          rail_details?: Json
          receipt_generated_at?: string | null
          receipt_ref?: string | null
          receipt_storage_path?: string | null
          rejected_reason?: string | null
          shipowner_id: string
          status?: Database["public"]["Enums"]["payment_status_v7"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          amount_usd_minor?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          declared_by?: string | null
          external_reference?: string | null
          fx_rate?: number | null
          fx_rate_locked_at?: string | null
          fx_rate_source?: string | null
          id?: string
          jurisdiction_id?: string
          rail?: Database["public"]["Enums"]["payment_rail"]
          rail_details?: Json
          receipt_generated_at?: string | null
          receipt_ref?: string | null
          receipt_storage_path?: string | null
          rejected_reason?: string | null
          shipowner_id?: string
          status?: Database["public"]["Enums"]["payment_status_v7"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_declared_by_fkey"
            columns: ["declared_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "payments_declared_by_fkey"
            columns: ["declared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "payments_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      profiles: {
        Row: {
          can_record_cash: boolean
          can_settle_payments: boolean
          country_code: string
          created_at: string
          credit_limit_usd: number
          eez_suspended: boolean
          eez_suspended_at: string | null
          email: string
          full_name: string
          id: string
          ip_address: unknown
          is_active: boolean
          is_demo: boolean
          operational_site: Database["public"]["Enums"]["operational_site"]
          preferred_language: string
          role: Database["public"]["Enums"]["user_role"]
          timezone: string
          updated_at: string
        }
        Insert: {
          can_record_cash?: boolean
          can_settle_payments?: boolean
          country_code?: string
          created_at?: string
          credit_limit_usd?: number
          eez_suspended?: boolean
          eez_suspended_at?: string | null
          email: string
          full_name: string
          id: string
          ip_address?: unknown
          is_active?: boolean
          is_demo?: boolean
          operational_site?: Database["public"]["Enums"]["operational_site"]
          preferred_language?: string
          role?: Database["public"]["Enums"]["user_role"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          can_record_cash?: boolean
          can_settle_payments?: boolean
          country_code?: string
          created_at?: string
          credit_limit_usd?: number
          eez_suspended?: boolean
          eez_suspended_at?: string | null
          email?: string
          full_name?: string
          id?: string
          ip_address?: unknown
          is_active?: boolean
          is_demo?: boolean
          operational_site?: Database["public"]["Enums"]["operational_site"]
          preferred_language?: string
          role?: Database["public"]["Enums"]["user_role"]
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_usd_minor: number
          approved_by: string | null
          created_at: string
          executed_at: string | null
          executed_by: string | null
          id: string
          jurisdiction_id: string
          rail_details: Json
          refund_rail: Database["public"]["Enums"]["payment_rail"] | null
          rejection_reason: string | null
          requested_by: string | null
          shipowner_id: string
          status: Database["public"]["Enums"]["refund_status"]
          transaction_id: string
          updated_at: string
        }
        Insert: {
          amount_usd_minor: number
          approved_by?: string | null
          created_at?: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          jurisdiction_id?: string
          rail_details?: Json
          refund_rail?: Database["public"]["Enums"]["payment_rail"] | null
          rejection_reason?: string | null
          requested_by?: string | null
          shipowner_id: string
          status?: Database["public"]["Enums"]["refund_status"]
          transaction_id: string
          updated_at?: string
        }
        Update: {
          amount_usd_minor?: number
          approved_by?: string | null
          created_at?: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          jurisdiction_id?: string
          rail_details?: Json
          refund_rail?: Database["public"]["Enums"]["payment_rail"] | null
          rejection_reason?: string | null
          requested_by?: string | null
          shipowner_id?: string
          status?: Database["public"]["Enums"]["refund_status"]
          transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "refunds_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "refunds_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "refunds_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "refunds_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      registration_requests: {
        Row: {
          access_scope: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          default_region: string
          entity_type: Database["public"]["Enums"]["registration_entity_type"]
          flagged: boolean
          id: string
          ip_address: unknown
          jurisdiction: string
          notify_co2: boolean
          notify_proforma: boolean
          notify_revenue: boolean
          notify_weekly: boolean
          org_name: string
          org_registry_id: string
          password_hash: string
          ref: string | null
          requested_role: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["registration_status"]
          updated_at: string
        }
        Insert: {
          access_scope?: string
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          default_region?: string
          entity_type: Database["public"]["Enums"]["registration_entity_type"]
          flagged?: boolean
          id?: string
          ip_address?: unknown
          jurisdiction: string
          notify_co2?: boolean
          notify_proforma?: boolean
          notify_revenue?: boolean
          notify_weekly?: boolean
          org_name: string
          org_registry_id: string
          password_hash: string
          ref?: string | null
          requested_role: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
        }
        Update: {
          access_scope?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          default_region?: string
          entity_type?: Database["public"]["Enums"]["registration_entity_type"]
          flagged?: boolean
          id?: string
          ip_address?: unknown
          jurisdiction?: string
          notify_co2?: boolean
          notify_proforma?: boolean
          notify_revenue?: boolean
          notify_weekly?: boolean
          org_name?: string
          org_registry_id?: string
          password_hash?: string
          ref?: string | null
          requested_role?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registration_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "registration_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_split_rule: {
        Row: {
          concessionaire_pct: number
          contract_ref: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_id: string
          signature_hash: string
          signed_by: string
          sovereign_pct: number
        }
        Insert: {
          concessionaire_pct: number
          contract_ref: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          jurisdiction_id: string
          signature_hash: string
          signed_by: string
          sovereign_pct: number
        }
        Update: {
          concessionaire_pct?: number
          contract_ref?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          jurisdiction_id?: string
          signature_hash?: string
          signed_by?: string
          sovereign_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "revenue_split_rule_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_split_rule_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "revenue_split_rule_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      shipowners: {
        Row: {
          account_state: Database["public"]["Enums"]["shipowner_account_state"]
          address: string | null
          aliases: string[]
          anonymized_at: string | null
          aoc_number: string | null
          applicable_modes: Database["public"]["Enums"]["transport_mode"][]
          bank_name: string | null
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_cc_emails: string[]
          billing_city: string | null
          billing_country_code: string | null
          billing_legal_name: string | null
          billing_postal_code: string | null
          billing_proof_doc_type: string | null
          billing_proof_doc_url: string | null
          cgv_accepted_at: string | null
          cgv_version: string | null
          country_code: string | null
          created_at: string
          email_verified_at: string | null
          equasis_id: string | null
          finance_email: string | null
          hub_code: string | null
          iata_code: string | null
          iban: string | null
          icao_code: string | null
          id: string
          imo_company_no: string | null
          imo_company_no_verified_at: string | null
          invited_at: string | null
          invited_by: string | null
          is_ofac_sdn: boolean
          is_placeholder: boolean
          is_un_prohibited: boolean
          jurisdiction_id: string
          kyc_level_b_completed_at: string | null
          kyc_level_c_completed_at: string | null
          name: string
          notes: string | null
          official_email: string | null
          official_email_source: string | null
          ops_email: string | null
          phone_e164: string | null
          preferred_language: string
          profile_id: string | null
          proof_doc_type: string | null
          proof_doc_url: string | null
          proof_imo_vessel_imo: string | null
          rejection_reason: string | null
          sanction_notes: string | null
          seed_ref: string | null
          swift_bic: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          account_state?: Database["public"]["Enums"]["shipowner_account_state"]
          address?: string | null
          aliases?: string[]
          anonymized_at?: string | null
          aoc_number?: string | null
          applicable_modes?: Database["public"]["Enums"]["transport_mode"][]
          bank_name?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_cc_emails?: string[]
          billing_city?: string | null
          billing_country_code?: string | null
          billing_legal_name?: string | null
          billing_postal_code?: string | null
          billing_proof_doc_type?: string | null
          billing_proof_doc_url?: string | null
          cgv_accepted_at?: string | null
          cgv_version?: string | null
          country_code?: string | null
          created_at?: string
          email_verified_at?: string | null
          equasis_id?: string | null
          finance_email?: string | null
          hub_code?: string | null
          iata_code?: string | null
          iban?: string | null
          icao_code?: string | null
          id?: string
          imo_company_no?: string | null
          imo_company_no_verified_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_ofac_sdn?: boolean
          is_placeholder?: boolean
          is_un_prohibited?: boolean
          jurisdiction_id?: string
          kyc_level_b_completed_at?: string | null
          kyc_level_c_completed_at?: string | null
          name: string
          notes?: string | null
          official_email?: string | null
          official_email_source?: string | null
          ops_email?: string | null
          phone_e164?: string | null
          preferred_language?: string
          profile_id?: string | null
          proof_doc_type?: string | null
          proof_doc_url?: string | null
          proof_imo_vessel_imo?: string | null
          rejection_reason?: string | null
          sanction_notes?: string | null
          seed_ref?: string | null
          swift_bic?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          account_state?: Database["public"]["Enums"]["shipowner_account_state"]
          address?: string | null
          aliases?: string[]
          anonymized_at?: string | null
          aoc_number?: string | null
          applicable_modes?: Database["public"]["Enums"]["transport_mode"][]
          bank_name?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_cc_emails?: string[]
          billing_city?: string | null
          billing_country_code?: string | null
          billing_legal_name?: string | null
          billing_postal_code?: string | null
          billing_proof_doc_type?: string | null
          billing_proof_doc_url?: string | null
          cgv_accepted_at?: string | null
          cgv_version?: string | null
          country_code?: string | null
          created_at?: string
          email_verified_at?: string | null
          equasis_id?: string | null
          finance_email?: string | null
          hub_code?: string | null
          iata_code?: string | null
          iban?: string | null
          icao_code?: string | null
          id?: string
          imo_company_no?: string | null
          imo_company_no_verified_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_ofac_sdn?: boolean
          is_placeholder?: boolean
          is_un_prohibited?: boolean
          jurisdiction_id?: string
          kyc_level_b_completed_at?: string | null
          kyc_level_c_completed_at?: string | null
          name?: string
          notes?: string | null
          official_email?: string | null
          official_email_source?: string | null
          ops_email?: string | null
          phone_e164?: string | null
          preferred_language?: string
          profile_id?: string | null
          proof_doc_type?: string | null
          proof_doc_url?: string | null
          proof_imo_vessel_imo?: string | null
          rejection_reason?: string | null
          sanction_notes?: string | null
          seed_ref?: string | null
          swift_bic?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipowners_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shipowners_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipowners_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipowners_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "shipowners_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "shipowners_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shipowners_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notification_reads: {
        Row: {
          notification_id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          notification_id: string
          profile_id: string
          read_at?: string
        }
        Update: {
          notification_id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "staff_notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "v_staff_notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notification_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "staff_notification_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notifications: {
        Row: {
          audience_roles: Database["public"]["Enums"]["user_role"][]
          body_key: string
          body_params: Json
          created_at: string
          dedup_key: string | null
          deep_link: string | null
          id: string
          jurisdiction_id: string
          kind: Database["public"]["Enums"]["staff_notification_kind"]
          title_key: string
        }
        Insert: {
          audience_roles: Database["public"]["Enums"]["user_role"][]
          body_key: string
          body_params?: Json
          created_at?: string
          dedup_key?: string | null
          deep_link?: string | null
          id?: string
          jurisdiction_id: string
          kind: Database["public"]["Enums"]["staff_notification_kind"]
          title_key: string
        }
        Update: {
          audience_roles?: Database["public"]["Enums"]["user_role"][]
          body_key?: string
          body_params?: Json
          created_at?: string
          dedup_key?: string | null
          deep_link?: string | null
          id?: string
          jurisdiction_id?: string
          kind?: Database["public"]["Enums"]["staff_notification_kind"]
          title_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      tariffs: {
        Row: {
          asset_category: string | null
          created_at: string
          created_by: string | null
          currency: string
          decree_ref: string | null
          effective_from: string
          effective_to: string | null
          id: string
          jurisdiction_id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          rate_per_tco2: number
          signature_hash: string | null
          status: string
          zone: string | null
        }
        Insert: {
          asset_category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decree_ref?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          jurisdiction_id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          rate_per_tco2: number
          signature_hash?: string | null
          status?: string
          zone?: string | null
        }
        Update: {
          asset_category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          decree_ref?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          jurisdiction_id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          rate_per_tco2?: number
          signature_hash?: string | null
          status?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "tariffs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "tariffs_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      tax_configurations: {
        Row: {
          base_rate_usd_per_tco2: number
          created_at: string
          created_by: string
          effective_date: string
          id: string
          jurisdiction_zone: Database["public"]["Enums"]["jurisdiction_zone"]
          multiplier: number
          ref: string | null
          status: Database["public"]["Enums"]["tax_config_status"]
          updated_at: string
          vessel_category: Database["public"]["Enums"]["vessel_category"]
        }
        Insert: {
          base_rate_usd_per_tco2: number
          created_at?: string
          created_by: string
          effective_date: string
          id?: string
          jurisdiction_zone: Database["public"]["Enums"]["jurisdiction_zone"]
          multiplier?: number
          ref?: string | null
          status?: Database["public"]["Enums"]["tax_config_status"]
          updated_at?: string
          vessel_category: Database["public"]["Enums"]["vessel_category"]
        }
        Update: {
          base_rate_usd_per_tco2?: number
          created_at?: string
          created_by?: string
          effective_date?: string
          id?: string
          jurisdiction_zone?: Database["public"]["Enums"]["jurisdiction_zone"]
          multiplier?: number
          ref?: string | null
          status?: Database["public"]["Enums"]["tax_config_status"]
          updated_at?: string
          vessel_category?: Database["public"]["Enums"]["vessel_category"]
        }
        Relationships: [
          {
            foreignKeyName: "tax_configurations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "tax_configurations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          agent_profile_id: string | null
          aircraft_id: string | null
          arrival_alert_id: string | null
          breakdown_json: Json | null
          collections_status: string
          content_hash: string | null
          created_at: string
          debtor_profile_id: string | null
          distance_eez_nm: number | null
          document_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          emission_factor_used_id: string | null
          emissions_tco2: number
          escalated_by: string | null
          escalated_to_owner_at: string | null
          escalated_to_owner_email: string | null
          id: string
          invoice_pdf_url: string | null
          invoice_ref: string | null
          jurisdiction_id: string
          mode: Database["public"]["Enums"]["transport_mode"]
          owner_escalation_due_at: string | null
          paid_at: string | null
          partial_paid_usd: number
          payment_proof_files: Json
          port_call: string | null
          proforma_sent_at: string | null
          rate_usd_per_tco2: number
          ref: string | null
          related_transaction_id: string | null
          settlement_effective_at: string | null
          shipowner_id: string | null
          split_rule_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          tariff_id: string | null
          tax_amount_usd: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          verify_signature: string | null
          vessel_id: string | null
          vessel_imo: string
          vessel_name: string
        }
        Insert: {
          agent_profile_id?: string | null
          aircraft_id?: string | null
          arrival_alert_id?: string | null
          breakdown_json?: Json | null
          collections_status?: string
          content_hash?: string | null
          created_at?: string
          debtor_profile_id?: string | null
          distance_eez_nm?: number | null
          document_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          emission_factor_used_id?: string | null
          emissions_tco2: number
          escalated_by?: string | null
          escalated_to_owner_at?: string | null
          escalated_to_owner_email?: string | null
          id?: string
          invoice_pdf_url?: string | null
          invoice_ref?: string | null
          jurisdiction_id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          owner_escalation_due_at?: string | null
          paid_at?: string | null
          partial_paid_usd?: number
          payment_proof_files?: Json
          port_call?: string | null
          proforma_sent_at?: string | null
          rate_usd_per_tco2?: number
          ref?: string | null
          related_transaction_id?: string | null
          settlement_effective_at?: string | null
          shipowner_id?: string | null
          split_rule_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tariff_id?: string | null
          tax_amount_usd: number
          transaction_type: Database["public"]["Enums"]["transaction_type"]
          verify_signature?: string | null
          vessel_id?: string | null
          vessel_imo: string
          vessel_name: string
        }
        Update: {
          agent_profile_id?: string | null
          aircraft_id?: string | null
          arrival_alert_id?: string | null
          breakdown_json?: Json | null
          collections_status?: string
          content_hash?: string | null
          created_at?: string
          debtor_profile_id?: string | null
          distance_eez_nm?: number | null
          document_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          emission_factor_used_id?: string | null
          emissions_tco2?: number
          escalated_by?: string | null
          escalated_to_owner_at?: string | null
          escalated_to_owner_email?: string | null
          id?: string
          invoice_pdf_url?: string | null
          invoice_ref?: string | null
          jurisdiction_id?: string
          mode?: Database["public"]["Enums"]["transport_mode"]
          owner_escalation_due_at?: string | null
          paid_at?: string | null
          partial_paid_usd?: number
          payment_proof_files?: Json
          port_call?: string | null
          proforma_sent_at?: string | null
          rate_usd_per_tco2?: number
          ref?: string | null
          related_transaction_id?: string | null
          settlement_effective_at?: string | null
          shipowner_id?: string | null
          split_rule_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          tariff_id?: string | null
          tax_amount_usd?: number
          transaction_type?: Database["public"]["Enums"]["transaction_type"]
          verify_signature?: string | null
          vessel_id?: string | null
          vessel_imo?: string
          vessel_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "transactions_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_aircraft_id_fkey"
            columns: ["aircraft_id"]
            isOneToOne: false
            referencedRelation: "aircraft"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_arrival_alert_id_fkey"
            columns: ["arrival_alert_id"]
            isOneToOne: false
            referencedRelation: "arrival_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_debtor_profile_id_fkey"
            columns: ["debtor_profile_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "transactions_debtor_profile_id_fkey"
            columns: ["debtor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_emission_factor_used_id_fkey"
            columns: ["emission_factor_used_id"]
            isOneToOne: false
            referencedRelation: "emission_factors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_escalated_by_fkey"
            columns: ["escalated_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "transactions_escalated_by_fkey"
            columns: ["escalated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_split_rule_id_fkey"
            columns: ["split_rule_id"]
            isOneToOne: false
            referencedRelation: "revenue_split_rule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      user_jurisdictions: {
        Row: {
          created_at: string
          jurisdiction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          jurisdiction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          jurisdiction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_jurisdictions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_jurisdictions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "user_jurisdictions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "user_jurisdictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "user_jurisdictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_identity_candidates: {
        Row: {
          batch_label: string
          build_year: number | null
          call_sign: string | null
          category: Database["public"]["Enums"]["vessel_category"] | null
          contact_blocked: boolean
          contact_blocked_reason: string | null
          deadweight: number | null
          flag_code: string | null
          gross_tonnage: number | null
          id: string
          imo_number: string
          imported_at: string
          imported_by: string | null
          ism_manager_email: string | null
          ism_manager_name: string | null
          last_seen_at: string | null
          manager_country: string | null
          manager_email: string | null
          manager_name: string | null
          matched_at: string | null
          matched_by: string | null
          matched_vessel_id: string | null
          mmsi: string | null
          owner_country: string | null
          owner_email: string | null
          owner_name: string | null
          source: string
          status: string
          type_raw: string | null
          vessel_name: string
        }
        Insert: {
          batch_label: string
          build_year?: number | null
          call_sign?: string | null
          category?: Database["public"]["Enums"]["vessel_category"] | null
          contact_blocked?: boolean
          contact_blocked_reason?: string | null
          deadweight?: number | null
          flag_code?: string | null
          gross_tonnage?: number | null
          id?: string
          imo_number: string
          imported_at?: string
          imported_by?: string | null
          ism_manager_email?: string | null
          ism_manager_name?: string | null
          last_seen_at?: string | null
          manager_country?: string | null
          manager_email?: string | null
          manager_name?: string | null
          matched_at?: string | null
          matched_by?: string | null
          matched_vessel_id?: string | null
          mmsi?: string | null
          owner_country?: string | null
          owner_email?: string | null
          owner_name?: string | null
          source: string
          status?: string
          type_raw?: string | null
          vessel_name: string
        }
        Update: {
          batch_label?: string
          build_year?: number | null
          call_sign?: string | null
          category?: Database["public"]["Enums"]["vessel_category"] | null
          contact_blocked?: boolean
          contact_blocked_reason?: string | null
          deadweight?: number | null
          flag_code?: string | null
          gross_tonnage?: number | null
          id?: string
          imo_number?: string
          imported_at?: string
          imported_by?: string | null
          ism_manager_email?: string | null
          ism_manager_name?: string | null
          last_seen_at?: string | null
          manager_country?: string | null
          manager_email?: string | null
          manager_name?: string | null
          matched_at?: string | null
          matched_by?: string | null
          matched_vessel_id?: string | null
          mmsi?: string | null
          owner_country?: string | null
          owner_email?: string | null
          owner_name?: string | null
          source?: string
          status?: string
          type_raw?: string | null
          vessel_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessel_identity_candidates_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vessel_identity_candidates_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_identity_candidates_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vessel_identity_candidates_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessel_identity_candidates_matched_vessel_id_fkey"
            columns: ["matched_vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_positions: {
        Row: {
          heading: number
          id: string
          lat: number
          lng: number
          recorded_at: string
          speed_knots: number
          vessel_id: string
          zone: Database["public"]["Enums"]["jurisdiction_zone"] | null
        }
        Insert: {
          heading?: number
          id?: string
          lat: number
          lng: number
          recorded_at?: string
          speed_knots?: number
          vessel_id: string
          zone?: Database["public"]["Enums"]["jurisdiction_zone"] | null
        }
        Update: {
          heading?: number
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          speed_knots?: number
          vessel_id?: string
          zone?: Database["public"]["Enums"]["jurisdiction_zone"] | null
        }
        Relationships: [
          {
            foreignKeyName: "vessel_positions_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      vessels: {
        Row: {
          build_year: number | null
          call_sign: string | null
          category: Database["public"]["Enums"]["vessel_category"]
          compliance_status: Database["public"]["Enums"]["compliance_status"]
          created_at: string
          design_speed_knots: number | null
          detain_on_next_call: boolean
          detain_reason: string | null
          detain_set_at: string | null
          detain_set_by: string | null
          dwt: number | null
          engine_power_kw: number | null
          estimated_emissions_tco2: number
          flag_code: string
          gross_tonnage_dwt: number
          id: string
          imo_number: string
          jurisdiction_id: string
          last_transaction_id: string | null
          last_zone: string | null
          last_zone_jurisdiction_id: string | null
          mmsi: string | null
          name: string
          owner_id: string | null
          port_call: string | null
          previous_names: string[]
          pro_forma_generated: boolean
          seed_ref: string | null
          shipowner_id: string | null
          tax_liability_usd: number
          updated_at: string
          vessel_subtype: string | null
          wave_tag: string | null
        }
        Insert: {
          build_year?: number | null
          call_sign?: string | null
          category: Database["public"]["Enums"]["vessel_category"]
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          design_speed_knots?: number | null
          detain_on_next_call?: boolean
          detain_reason?: string | null
          detain_set_at?: string | null
          detain_set_by?: string | null
          dwt?: number | null
          engine_power_kw?: number | null
          estimated_emissions_tco2?: number
          flag_code: string
          gross_tonnage_dwt: number
          id?: string
          imo_number: string
          jurisdiction_id?: string
          last_transaction_id?: string | null
          last_zone?: string | null
          last_zone_jurisdiction_id?: string | null
          mmsi?: string | null
          name: string
          owner_id?: string | null
          port_call?: string | null
          previous_names?: string[]
          pro_forma_generated?: boolean
          seed_ref?: string | null
          shipowner_id?: string | null
          tax_liability_usd?: number
          updated_at?: string
          vessel_subtype?: string | null
          wave_tag?: string | null
        }
        Update: {
          build_year?: number | null
          call_sign?: string | null
          category?: Database["public"]["Enums"]["vessel_category"]
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          design_speed_knots?: number | null
          detain_on_next_call?: boolean
          detain_reason?: string | null
          detain_set_at?: string | null
          detain_set_by?: string | null
          dwt?: number | null
          engine_power_kw?: number | null
          estimated_emissions_tco2?: number
          flag_code?: string
          gross_tonnage_dwt?: number
          id?: string
          imo_number?: string
          jurisdiction_id?: string
          last_transaction_id?: string | null
          last_zone?: string | null
          last_zone_jurisdiction_id?: string | null
          mmsi?: string | null
          name?: string
          owner_id?: string | null
          port_call?: string | null
          previous_names?: string[]
          pro_forma_generated?: boolean
          seed_ref?: string | null
          shipowner_id?: string | null
          tax_liability_usd?: number
          updated_at?: string
          vessel_subtype?: string | null
          wave_tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "fk_vessels_last_txn"
            columns: ["last_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "vessels_detain_set_by_fkey"
            columns: ["detain_set_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vessels_detain_set_by_fkey"
            columns: ["detain_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "vessels_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "vessels_last_zone_jurisdiction_id_fkey"
            columns: ["last_zone_jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_last_zone_jurisdiction_id_fkey"
            columns: ["last_zone_jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "vessels_last_zone_jurisdiction_id_fkey"
            columns: ["last_zone_jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "vessels_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "vessels_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vessels_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_ledger: {
        Row: {
          amount_signed_usd_minor: number
          created_at: string
          created_by: string
          id: string
          jurisdiction_id: string
          justification: string | null
          kind: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id: string | null
          refund_id: string | null
          transaction_id: string | null
          wallet_id: string
        }
        Insert: {
          amount_signed_usd_minor: number
          created_at?: string
          created_by: string
          id?: string
          jurisdiction_id?: string
          justification?: string | null
          kind: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id?: string | null
          refund_id?: string | null
          transaction_id?: string | null
          wallet_id: string
        }
        Update: {
          amount_signed_usd_minor?: number
          created_at?: string
          created_by?: string
          id?: string
          jurisdiction_id?: string
          justification?: string | null
          kind?: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id?: string | null
          refund_id?: string | null
          transaction_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ledger_refund"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_credit_usage"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "wallet_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payments_initiated_overdue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_stripe_webhook_failures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "v_wallet_balance_drift"
            referencedColumns: ["wallet_id"]
          },
          {
            foreignKeyName: "wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          auto_apply_to_proforma: boolean
          balance_usd_minor: number
          created_at: string
          id: string
          jurisdiction_id: string
          shipowner_id: string
          updated_at: string
        }
        Insert: {
          auto_apply_to_proforma?: boolean
          balance_usd_minor?: number
          created_at?: string
          id?: string
          jurisdiction_id?: string
          shipowner_id: string
          updated_at?: string
        }
        Update: {
          auto_apply_to_proforma?: boolean
          balance_usd_minor?: number
          created_at?: string
          id?: string
          jurisdiction_id?: string
          shipowner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "wallets_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      orphan_transactions: {
        Row: {
          collections_status: string | null
          created_at: string | null
          due_date: string | null
          id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd: number | null
          vessel_id: string | null
          vessel_imo: string | null
          vessel_name: string | null
        }
        Insert: {
          collections_status?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd?: number | null
          vessel_id?: string | null
          vessel_imo?: string | null
          vessel_name?: string | null
        }
        Update: {
          collections_status?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd?: number | null
          vessel_id?: string | null
          vessel_imo?: string | null
          vessel_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_credit_usage: {
        Row: {
          credit_available_usd: number | null
          credit_disputed_usd: number | null
          credit_limit_usd: number | null
          credit_used_usd: number | null
          eez_suspended: boolean | null
          profile_id: string | null
        }
        Relationships: []
      }
      transaction_paid_summary: {
        Row: {
          due_usd_minor: number | null
          paid_usd_minor: number | null
          remaining_usd_minor: number | null
          transaction_id: string | null
        }
        Relationships: []
      }
      v_armateur_recouvrement: {
        Row: {
          account_state:
            | Database["public"]["Enums"]["shipowner_account_state"]
            | null
          country_code: string | null
          id: string | null
          imo_company_no: string | null
          is_ofac_sdn: boolean | null
          is_un_prohibited: boolean | null
          last_auto_tier: Database["public"]["Enums"]["reminder_tier"] | null
          last_reminder_at: string | null
          latest_response_type:
            | Database["public"]["Enums"]["debtor_response_type"]
            | null
          name: string | null
          next_due_date: string | null
          official_email: string | null
          open_count: number | null
          overdue_count: number | null
          proforma_count: number | null
          sanctioned: boolean | null
          total_invoiced_usd: number | null
          total_outstanding_usd: number | null
          total_paid_usd: number | null
        }
        Relationships: []
      }
      v_collection_admin: {
        Row: {
          created_at: string | null
          debtor_name: string | null
          flag_country: string | null
          invoice_ref: string | null
          jurisdiction_code: string | null
          jurisdiction_id: string | null
          jurisdiction_name: string | null
          last_manual_at: string | null
          latest_response_at: string | null
          latest_response_type:
            | Database["public"]["Enums"]["debtor_response_type"]
            | null
          latest_sent_at: string | null
          latest_tier: Database["public"]["Enums"]["reminder_tier"] | null
          manual_count: number | null
          outstanding_usd: number | null
          reminder_count: number | null
          shipowner_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd: number | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_compagnie_recouvrement: {
        Row: {
          account_state:
            | Database["public"]["Enums"]["shipowner_account_state"]
            | null
          aoc_number: string | null
          country_code: string | null
          hub_code: string | null
          iata_code: string | null
          icao_code: string | null
          id: string | null
          is_ofac_sdn: boolean | null
          is_un_prohibited: boolean | null
          name: string | null
          official_email: string | null
          proforma_count: number | null
          sanctioned: boolean | null
          total_invoiced_usd: number | null
          total_outstanding_usd: number | null
          total_paid_usd: number | null
        }
        Relationships: []
      }
      v_invoice_admin: {
        Row: {
          content_hash: string | null
          created_at: string | null
          debtor_name: string | null
          document_type: Database["public"]["Enums"]["document_type"] | null
          due_date: string | null
          flag_country: string | null
          id: string | null
          invoice_ref: string | null
          is_aviation: boolean | null
          jurisdiction_code: string | null
          jurisdiction_id: string | null
          jurisdiction_name: string | null
          mode: Database["public"]["Enums"]["transport_mode"] | null
          outstanding_usd: number | null
          paid_at: string | null
          partial_paid_usd: number | null
          shipowner_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd: number | null
          verify_signature: string | null
          vessel_imo: string | null
          vessel_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_payments_initiated_overdue: {
        Row: {
          age_hours: number | null
          amount_usd_minor: number | null
          created_at: string | null
          id: string | null
          rail: Database["public"]["Enums"]["payment_rail"] | null
          shipowner_id: string | null
          shipowner_name: string | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      v_reglements_dashboard: {
        Row: {
          collected_month_count: number | null
          collected_month_usd: number | null
          collected_today_count: number | null
          collected_today_usd: number | null
          collected_week_count: number | null
          collected_week_usd: number | null
          invoiced_month_count: number | null
          invoiced_month_usd: number | null
          invoiced_today_count: number | null
          invoiced_today_usd: number | null
          invoiced_week_count: number | null
          invoiced_week_usd: number | null
          jurisdiction_id: string | null
          overdue_count: number | null
          overdue_usd: number | null
          total_outstanding_usd: number | null
        }
        Insert: {
          collected_month_count?: never
          collected_month_usd?: never
          collected_today_count?: never
          collected_today_usd?: never
          collected_week_count?: never
          collected_week_usd?: never
          invoiced_month_count?: never
          invoiced_month_usd?: never
          invoiced_today_count?: never
          invoiced_today_usd?: never
          invoiced_week_count?: never
          invoiced_week_usd?: never
          jurisdiction_id?: string | null
          overdue_count?: never
          overdue_usd?: never
          total_outstanding_usd?: never
        }
        Update: {
          collected_month_count?: never
          collected_month_usd?: never
          collected_today_count?: never
          collected_today_usd?: never
          collected_week_count?: never
          collected_week_usd?: never
          invoiced_month_count?: never
          invoiced_month_usd?: never
          invoiced_today_count?: never
          invoiced_today_usd?: never
          invoiced_week_count?: never
          invoiced_week_usd?: never
          jurisdiction_id?: string | null
          overdue_count?: never
          overdue_usd?: never
          total_outstanding_usd?: never
        }
        Relationships: []
      }
      v_revenue_split_settlement: {
        Row: {
          concessionaire_usd: number | null
          jurisdiction_code: string | null
          jurisdiction_id: string | null
          mismatched_count: number | null
          mismatched_usd: number | null
          mode: Database["public"]["Enums"]["transport_mode"] | null
          month: string | null
          sovereign_usd: number | null
          total_usd: number | null
          tx_count: number | null
          unattributed_count: number | null
          unattributed_usd: number | null
        }
        Relationships: []
      }
      v_staff_notifications: {
        Row: {
          body_key: string | null
          body_params: Json | null
          created_at: string | null
          deep_link: string | null
          id: string | null
          jurisdiction_id: string | null
          kind: Database["public"]["Enums"]["staff_notification_kind"] | null
          read_at: string | null
          title_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "staff_notifications_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
        ]
      }
      v_stripe_webhook_failures: {
        Row: {
          amount_usd_minor: number | null
          created_at: string | null
          id: string | null
          rejected_at: string | null
          rejected_reason: string | null
          shipowner_id: string | null
          shipowner_name: string | null
          stripe_payment_intent_id: string | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "orphan_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transaction_paid_summary"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_collection_admin"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_invoice_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_outstanding"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transaction_payment_drift"
            referencedColumns: ["transaction_id"]
          },
        ]
      }
      v_transaction_outstanding: {
        Row: {
          document_type: Database["public"]["Enums"]["document_type"] | null
          due_date: string | null
          is_claimable: boolean | null
          jurisdiction_id: string | null
          mode: Database["public"]["Enums"]["transport_mode"] | null
          outstanding_usd: number | null
          paid_usd: number | null
          shipowner_id: string | null
          status: Database["public"]["Enums"]["transaction_status"] | null
          tax_amount_usd: number | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_reglements_dashboard"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_jurisdiction_id_fkey"
            columns: ["jurisdiction_id"]
            isOneToOne: false
            referencedRelation: "v_revenue_split_settlement"
            referencedColumns: ["jurisdiction_id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_transaction_payment_drift: {
        Row: {
          computed_paid_usd: number | null
          drift_usd: number | null
          invoice_ref: string | null
          reported_paid_usd: number | null
          shipowner_id: string | null
          shipowner_name: string | null
          tax_amount_usd: number | null
          transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: false
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
      v_wallet_balance_drift: {
        Row: {
          computed_balance: number | null
          drift_minor: number | null
          reported_balance: number | null
          shipowner_id: string | null
          shipowner_name: string | null
          wallet_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "shipowners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "v_armateur_recouvrement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallets_shipowner_id_fkey"
            columns: ["shipowner_id"]
            isOneToOne: true
            referencedRelation: "v_compagnie_recouvrement"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      alert_distance_final_nm: { Args: { p_alert_id: string }; Returns: number }
      can_confirm_payment: {
        Args: { p_payment_id: string; p_profile_id: string }
        Returns: boolean
      }
      can_settle_payments: { Args: { p_profile_id?: string }; Returns: boolean }
      create_tariff_version: {
        Args: {
          p_actor: string
          p_asset_category: string
          p_decree_ref: string
          p_effective_from: string
          p_jurisdiction_id: string
          p_mode: Database["public"]["Enums"]["transport_mode"]
          p_rate: number
        }
        Returns: {
          closed_id: string
          new_id: string
        }[]
      }
      current_jurisdiction_ids: { Args: never; Returns: string[] }
      current_shipowner_id: { Args: never; Returns: string }
      enqueue_proforma_reminders: { Args: never; Returns: number }
      equasis_enqueue_pending: { Args: never; Returns: number }
      fn_dispute_pause_days: { Args: { p_txn_id: string }; Returns: number }
      fn_escalate_unclaimed: { Args: never; Returns: number }
      fn_stage_unpaid_owner_escalation: { Args: never; Returns: number }
      fx_rate_latest: {
        Args: { p_base: string; p_quote: string }
        Returns: {
          fetched_at: string
          rate: number
          source: string
        }[]
      }
      generate_ref: {
        Args: { prefix: string; seq_name: string; with_year?: boolean }
        Returns: string
      }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin_or_officer: { Args: never; Returns: boolean }
      kyc_pgsodium_decrypt: { Args: { p_ct: string }; Returns: string }
      kyc_pgsodium_encrypt: { Args: { p_value: string }; Returns: string }
      kyc_vault_delete: { Args: { p_id: string }; Returns: undefined }
      kyc_vault_retrieve: { Args: { p_id: string }; Returns: string }
      kyc_vault_store: { Args: { p_value: string }; Returns: string }
      match_pending_alerts: { Args: never; Returns: number }
      minimize_ip: { Args: { ip: unknown }; Returns: unknown }
      owner_privileges: {
        Args: never
        Returns: {
          can_dispute: boolean
          can_invite: boolean
          can_manage_vessels: boolean
          can_pay: boolean
        }[]
      }
      pg_extension_lookup_kyc: { Args: never; Returns: string[] }
      pgmq_ack_message: {
        Args: { msg_id: number; queue_name: string }
        Returns: boolean
      }
      pgmq_archive_message: {
        Args: { msg_id: number; queue_name: string }
        Returns: boolean
      }
      pgmq_enqueue_proforma: { Args: { alert_id: string }; Returns: number }
      pgmq_pop_message: {
        Args: { queue_name: string; visibility_sec: number }
        Returns: Json
      }
      profile_visible_in_jurisdictions: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      recompute_transaction_status: {
        Args: { p_txn_id: string }
        Returns: undefined
      }
      rgpd_purge_arrival_alerts: {
        Args: { p_days?: number; p_dry_run?: boolean }
        Returns: number
      }
      rgpd_purge_owner_notifications: {
        Args: { p_days?: number; p_dry_run?: boolean }
        Returns: number
      }
      sync_vessel_compliance: {
        Args: { p_vessel_id: string }
        Returns: undefined
      }
      verify_invoice_lookup: {
        Args: { p_hash: string; p_ref: string }
        Returns: {
          content_hash: string
          created_at: string
          document_type: string
          invoice_ref: string
          paid_at: string
          port_call: string
          status: string
          tax_amount_usd: number
          transaction_type: string
          vessel_imo: string
          vessel_name: string
        }[]
      }
      vessel_payment_teaser: {
        Args: { p_identifier: string }
        Returns: {
          claimable: boolean
          earliest_due_date: string
          has_overdue: boolean
          imo_number: string
          outstanding_count: number
          port_call: string
          vessel_name: string
        }[]
      }
    }
    Enums: {
      arrival_alert_status:
        | "DETECTED"
        | "MATCHED_AUTO"
        | "UNCLAIMED"
        | "CLAIMED"
        | "ESCALATED"
        | "PROFORMA_SENT"
        | "ARRIVED"
        | "DEPARTED_EEZ"
        | "RECONCILED"
        | "CANCELLED"
      audit_action:
        | "LOGIN"
        | "LOGOUT"
        | "VESSEL_VIEWED"
        | "INVOICE_GENERATED"
        | "TAX_RATE_UPDATED"
        | "EXEMPTION_GRANTED"
        | "REPORT_EXPORTED"
        | "USER_CREATED"
        | "TRANSACTION_UPDATED"
        | "INVOICE_SENT"
        | "SANCTIONS_CONTACT_BLOCKED"
        | "SHIPOWNER_ANONYMIZED"
        | "SHIPOWNER_SELF_CLAIM"
        | "SHIPOWNER_UPDATED"
        | "SETTLEMENT_RIGHTS_UPDATED"
      audit_severity: "INFO" | "WARNING" | "CRITICAL"
      compliance_status:
        | "COMPLIANT"
        | "PAYMENT_DUE"
        | "PROCESSING"
        | "NON_COMPLIANT"
        | "APPROACHING"
        | "EXEMPT"
      debtor_response_type:
        | "SILENT"
        | "ACKNOWLEDGE"
        | "DISPUTE"
        | "PAYMENT_PROMISE"
        | "PARTIAL_PAYMENT"
        | "PAID"
        | "REFUSED"
      destination_proposal_status: "PENDING" | "APPROVED" | "REJECTED"
      detection_source: "CORRIDOR_500NM" | "ORIGINPORT" | "NOA"
      dispute_reason:
        | "EMISSION_CALCULATION"
        | "TAX_RATE"
        | "ZONE_CLASSIFICATION"
        | "VESSEL_DATA"
        | "OTHER"
      dispute_status:
        | "OPEN"
        | "UNDER_REVIEW"
        | "ACCEPTED"
        | "REJECTED"
        | "ESCALATED"
      document_type: "PROFORMA" | "FINAL" | "COMPLEMENT" | "REFUND"
      emission_factor_source: "EU_MRV" | "IMO_CATEGORY" | "FALLBACK"
      exemption_reason:
        | "MILITARY"
        | "HUMANITARIAN"
        | "SCIENTIFIC"
        | "UN_AGENCY"
        | "OTHER"
      jurisdiction_zone: "EEZ" | "PORT_VICINITY" | "TRANSIT_LANE"
      ledger_entry_kind:
        | "TOPUP"
        | "OVERPAYMENT_CREDIT"
        | "REFUND_CREDIT"
        | "PROFORMA_APPLY"
        | "ADMIN_ADJUSTMENT"
        | "FX_DIFFERENCE"
      operational_site: "BERBERA_PORT" | "NATIONAL_HQ" | "ZEILA_PORT"
      owner_notification_kind:
        | "KYC_APPROVED"
        | "KYC_REJECTED"
        | "KYC_C_REQUIRED"
        | "ALERT_DETECTED"
        | "PROFORMA_ISSUED"
        | "PROFORMA_REMINDER"
        | "PAYMENT_RECEIVED"
        | "PAYMENT_REJECTED"
        | "FINAL_ISSUED"
        | "COMPLEMENT_ISSUED"
        | "REFUND_ISSUED"
        | "WALLET_TOPPED_UP"
        | "WALLET_APPLIED"
        | "WALLET_LOW_BALANCE"
        | "DISPUTE_UPDATED"
        | "OWNER_ESCALATION"
        | "STATEMENT_READY"
      payment_rail:
        | "STRIPE"
        | "WIRE_TRANSFER"
        | "CASH"
        | "CHEQUE"
        | "LETTER_OF_CREDIT"
        | "NETTING"
        | "THIRD_PARTY"
        | "MOBILE_MONEY"
        | "BANK_GUARANTEE"
        | "WALLET"
        | "PAYPAL"
      payment_status_v7:
        | "INITIATED"
        | "PROCESSING"
        | "CONFIRMED"
        | "REJECTED"
        | "CANCELLED"
        | "REFUNDED"
      project_status:
        | "ACTIVE"
        | "PENDING"
        | "COMPLETED"
        | "SUSPENDED"
        | "UNDER_REVIEW"
      project_type:
        | "BLUE_CARBON"
        | "REFORESTATION"
        | "SOLAR"
        | "WIND"
        | "METHANE_CAPTURE"
        | "ENERGY_EFFICIENCY"
      refund_status: "REQUESTED" | "APPROVED" | "EXECUTED" | "REJECTED"
      registration_entity_type:
        | "PORT_AUTHORITY"
        | "SHIPPING_AGENT"
        | "FINANCE_ADMIN"
        | "INSTITUTION"
      registration_status: "PENDING" | "APPROVED" | "REJECTED" | "MORE_INFO"
      reminder_tier:
        | "J3"
        | "J7"
        | "J15"
        | "J30"
        | "J45"
        | "BAILIFF"
        | "JUDICIAL"
        | "MANUAL"
      shipowner_account_state:
        | "GHOST"
        | "PENDING_REVIEW"
        | "INVITED"
        | "ACTIVE"
        | "REJECTED"
        | "SUSPENDED"
      shipowner_payment_intent_status: "DECLARED" | "CONFIRMED" | "REJECTED"
      staff_notification_kind:
        | "VALIDATION_PENDING"
        | "REGISTRATION_SUBMITTED"
        | "COLLECTION_ESCALATED"
        | "DEBTOR_RESPONDED"
        | "CASH_PAYMENT_RECORDED"
        | "DISPUTE_OPENED"
      tax_config_status: "ACTIVE" | "DRAFT" | "ARCHIVED"
      transaction_status:
        | "PAID"
        | "PENDING"
        | "PARTIALLY_PAID"
        | "OVERDUE"
        | "EXEMPT"
        | "DISPUTED"
        | "CREDIT_NOTE_ISSUED"
        | "VOID"
      transaction_type: "ENTRY_TAX" | "TRANSIT_FEE" | "PORT_STAY"
      transport_mode: "MARITIME" | "AIR"
      user_role:
        | "PORT_OFFICER"
        | "FINANCE_ADMIN"
        | "SHIPPING_AGENT"
        | "SUPERADMIN"
        | "MANAGER"
        | "SHIPOWNER"
      verification_standard:
        | "VERRA_VCS"
        | "GOLD_STANDARD"
        | "IMO_DCS"
        | "PENDING_VERIFICATION"
      vessel_category:
        | "CONTAINER"
        | "CARGO"
        | "TANKER"
        | "BULK_CARRIER"
        | "FERRY"
        | "NAVAL"
        | "SCIENTIFIC"
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
    Enums: {
      arrival_alert_status: [
        "DETECTED",
        "MATCHED_AUTO",
        "UNCLAIMED",
        "CLAIMED",
        "ESCALATED",
        "PROFORMA_SENT",
        "ARRIVED",
        "DEPARTED_EEZ",
        "RECONCILED",
        "CANCELLED",
      ],
      audit_action: [
        "LOGIN",
        "LOGOUT",
        "VESSEL_VIEWED",
        "INVOICE_GENERATED",
        "TAX_RATE_UPDATED",
        "EXEMPTION_GRANTED",
        "REPORT_EXPORTED",
        "USER_CREATED",
        "TRANSACTION_UPDATED",
        "INVOICE_SENT",
        "SANCTIONS_CONTACT_BLOCKED",
        "SHIPOWNER_ANONYMIZED",
        "SHIPOWNER_SELF_CLAIM",
        "SHIPOWNER_UPDATED",
        "SETTLEMENT_RIGHTS_UPDATED",
      ],
      audit_severity: ["INFO", "WARNING", "CRITICAL"],
      compliance_status: [
        "COMPLIANT",
        "PAYMENT_DUE",
        "PROCESSING",
        "NON_COMPLIANT",
        "APPROACHING",
        "EXEMPT",
      ],
      debtor_response_type: [
        "SILENT",
        "ACKNOWLEDGE",
        "DISPUTE",
        "PAYMENT_PROMISE",
        "PARTIAL_PAYMENT",
        "PAID",
        "REFUSED",
      ],
      destination_proposal_status: ["PENDING", "APPROVED", "REJECTED"],
      detection_source: ["CORRIDOR_500NM", "ORIGINPORT", "NOA"],
      dispute_reason: [
        "EMISSION_CALCULATION",
        "TAX_RATE",
        "ZONE_CLASSIFICATION",
        "VESSEL_DATA",
        "OTHER",
      ],
      dispute_status: [
        "OPEN",
        "UNDER_REVIEW",
        "ACCEPTED",
        "REJECTED",
        "ESCALATED",
      ],
      document_type: ["PROFORMA", "FINAL", "COMPLEMENT", "REFUND"],
      emission_factor_source: ["EU_MRV", "IMO_CATEGORY", "FALLBACK"],
      exemption_reason: [
        "MILITARY",
        "HUMANITARIAN",
        "SCIENTIFIC",
        "UN_AGENCY",
        "OTHER",
      ],
      jurisdiction_zone: ["EEZ", "PORT_VICINITY", "TRANSIT_LANE"],
      ledger_entry_kind: [
        "TOPUP",
        "OVERPAYMENT_CREDIT",
        "REFUND_CREDIT",
        "PROFORMA_APPLY",
        "ADMIN_ADJUSTMENT",
        "FX_DIFFERENCE",
      ],
      operational_site: ["BERBERA_PORT", "NATIONAL_HQ", "ZEILA_PORT"],
      owner_notification_kind: [
        "KYC_APPROVED",
        "KYC_REJECTED",
        "KYC_C_REQUIRED",
        "ALERT_DETECTED",
        "PROFORMA_ISSUED",
        "PROFORMA_REMINDER",
        "PAYMENT_RECEIVED",
        "PAYMENT_REJECTED",
        "FINAL_ISSUED",
        "COMPLEMENT_ISSUED",
        "REFUND_ISSUED",
        "WALLET_TOPPED_UP",
        "WALLET_APPLIED",
        "WALLET_LOW_BALANCE",
        "DISPUTE_UPDATED",
        "OWNER_ESCALATION",
        "STATEMENT_READY",
      ],
      payment_rail: [
        "STRIPE",
        "WIRE_TRANSFER",
        "CASH",
        "CHEQUE",
        "LETTER_OF_CREDIT",
        "NETTING",
        "THIRD_PARTY",
        "MOBILE_MONEY",
        "BANK_GUARANTEE",
        "WALLET",
        "PAYPAL",
      ],
      payment_status_v7: [
        "INITIATED",
        "PROCESSING",
        "CONFIRMED",
        "REJECTED",
        "CANCELLED",
        "REFUNDED",
      ],
      project_status: [
        "ACTIVE",
        "PENDING",
        "COMPLETED",
        "SUSPENDED",
        "UNDER_REVIEW",
      ],
      project_type: [
        "BLUE_CARBON",
        "REFORESTATION",
        "SOLAR",
        "WIND",
        "METHANE_CAPTURE",
        "ENERGY_EFFICIENCY",
      ],
      refund_status: ["REQUESTED", "APPROVED", "EXECUTED", "REJECTED"],
      registration_entity_type: [
        "PORT_AUTHORITY",
        "SHIPPING_AGENT",
        "FINANCE_ADMIN",
        "INSTITUTION",
      ],
      registration_status: ["PENDING", "APPROVED", "REJECTED", "MORE_INFO"],
      reminder_tier: [
        "J3",
        "J7",
        "J15",
        "J30",
        "J45",
        "BAILIFF",
        "JUDICIAL",
        "MANUAL",
      ],
      shipowner_account_state: [
        "GHOST",
        "PENDING_REVIEW",
        "INVITED",
        "ACTIVE",
        "REJECTED",
        "SUSPENDED",
      ],
      shipowner_payment_intent_status: ["DECLARED", "CONFIRMED", "REJECTED"],
      staff_notification_kind: [
        "VALIDATION_PENDING",
        "REGISTRATION_SUBMITTED",
        "COLLECTION_ESCALATED",
        "DEBTOR_RESPONDED",
        "CASH_PAYMENT_RECORDED",
        "DISPUTE_OPENED",
      ],
      tax_config_status: ["ACTIVE", "DRAFT", "ARCHIVED"],
      transaction_status: [
        "PAID",
        "PENDING",
        "PARTIALLY_PAID",
        "OVERDUE",
        "EXEMPT",
        "DISPUTED",
        "CREDIT_NOTE_ISSUED",
        "VOID",
      ],
      transaction_type: ["ENTRY_TAX", "TRANSIT_FEE", "PORT_STAY"],
      transport_mode: ["MARITIME", "AIR"],
      user_role: [
        "PORT_OFFICER",
        "FINANCE_ADMIN",
        "SHIPPING_AGENT",
        "SUPERADMIN",
        "MANAGER",
        "SHIPOWNER",
      ],
      verification_standard: [
        "VERRA_VCS",
        "GOLD_STANDARD",
        "IMO_DCS",
        "PENDING_VERIFICATION",
      ],
      vessel_category: [
        "CONTAINER",
        "CARGO",
        "TANKER",
        "BULK_CARRIER",
        "FERRY",
        "NAVAL",
        "SCIENTIFIC",
      ],
    },
  },
} as const
