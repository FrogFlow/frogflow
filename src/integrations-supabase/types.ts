export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      // Заведена MIGRATION-22-admin-login-attempts.sql. Добавлена вручную
      // здесь по тому же поводу, что описан в комментарии к Functions ниже:
      // scripts/sync-db-types.mjs подтягивает только то, что уже применено к
      // живой базе, а эта миграция готова, но применяется отдельным шагом.
      admin_login_attempts: {
        Row: {
          id: string;
          at: string;
          bot_id: string;
          ip: string | null;
          ok: boolean;
        };
        Insert: {
          id?: string;
          at?: string;
          bot_id: string;
          ip?: string | null;
          ok: boolean;
        };
        Update: {
          id?: string;
          at?: string;
          bot_id?: string;
          ip?: string | null;
          ok?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "admin_login_attempts_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-26-manager-chat.sql — тем же поводом, что и
      // admin_login_attempts выше.
      manager_chat_state: {
        Row: {
          bot_id: string;
          telegram_id: number;
          active: boolean;
          connected_at: string | null;
          last_message_at: string;
          last_message_preview: string | null;
          last_message_direction: string | null;
          unread_count: number;
        };
        Insert: {
          bot_id: string;
          telegram_id: number;
          active?: boolean;
          connected_at?: string | null;
          last_message_at?: string;
          last_message_preview?: string | null;
          last_message_direction?: string | null;
          unread_count?: number;
        };
        Update: {
          bot_id?: string;
          telegram_id?: number;
          active?: boolean;
          connected_at?: string | null;
          last_message_at?: string;
          last_message_preview?: string | null;
          last_message_direction?: string | null;
          unread_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "manager_chat_state_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-26-manager-chat.sql — тем же поводом, что и
      // admin_login_attempts выше.
      manager_chat_messages: {
        Row: {
          id: string;
          bot_id: string;
          telegram_id: number;
          direction: string;
          sender: string;
          text: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          bot_id: string;
          telegram_id: number;
          direction: string;
          sender: string;
          text: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          telegram_id?: number;
          direction?: string;
          sender?: string;
          text?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "manager_chat_messages_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-25-module-requests.sql — тем же поводом, что и
      // admin_login_attempts выше: миграция уже применена к живой базе, но
      // scripts/sync-db-types.mjs не заводит новые таблицы, только колонки.
      module_requests: {
        Row: {
          id: string;
          bot_id: string;
          module_key: string;
          requested_at: string;
          status: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          bot_id: string;
          module_key: string;
          requested_at?: string;
          status?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          bot_id?: string;
          module_key?: string;
          requested_at?: string;
          status?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "module_requests_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      subscription_payments: {
        Row: {
          id: string;
          bot_id: string;
          period_start: string;
          period_end: string;
          amount: number;
          currency: string;
          paid_at: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          period_start: string;
          period_end: string;
          amount: number;
          currency?: string;
          paid_at?: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          period_start?: string;
          period_end?: string;
          amount?: number;
          currency?: string;
          paid_at?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscription_payments_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_login_attempts: {
        Row: {
          id: string;
          at: string;
          username: string;
          ip: string | null;
          ok: boolean;
        };
        Insert: {
          id?: string;
          at?: string;
          username: string;
          ip?: string | null;
          ok: boolean;
        };
        Update: {
          id?: string;
          at?: string;
          username?: string;
          ip?: string | null;
          ok?: boolean;
        };
        Relationships: [];
      };
      bot_events: {
        Row: {
          id: string;
          bot_id: string;
          at: string;
          actor: string;
          kind: string;
          payload: Json;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          at?: string;
          actor: string;
          kind: string;
          payload?: Json;
        };
        Update: {
          id?: string;
          bot_id?: string;
          at?: string;
          actor?: string;
          kind?: string;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "bot_events_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_broadcasts: {
        Row: {
          id: string;
          created_at: string;
          actor: string;
          message_text: string;
          target: string;
          results: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          actor: string;
          message_text: string;
          target: string;
          results?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          actor?: string;
          message_text?: string;
          target?: string;
          results?: Json;
        };
        Relationships: [];
      };
      order_counters: {
        Row: {
          bot_id: string;
          last_no: number;
        };
        Insert: {
          bot_id?: string;
          last_no?: number;
        };
        Update: {
          bot_id?: string;
          last_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_counters_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          id: string;
          broadcast_id: string;
          telegram_id: number;
          status: string;
          error_message: string | null;
          sent_at: string | null;
          phone: string | null;
          bot_id: string | null;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          telegram_id: number;
          status?: string;
          error_message?: string | null;
          sent_at?: string | null;
          phone?: string | null;
          bot_id?: string | null;
        };
        Update: {
          id?: string;
          broadcast_id?: string;
          telegram_id?: number;
          status?: string;
          error_message?: string | null;
          sent_at?: string | null;
          phone?: string | null;
          bot_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      bots: {
        Row: {
          notes: string | null;
          paused_message: string | null;
          archived_at: string | null;
          owner_contact: string | null;
          owner_name: string | null;
          owner_telegram_id: number | null;
          internal_secret: string | null;
          app_url: string | null;
          id: string;
          bot_token: string | null;
          bot_name: string;
          owner_id: string;
          status: string | null;
          modules: Json | null;
          settings: Json | null;
          subscription_plan: string | null;
          subscription_expires_at: string | null;
          created_at: string | null;
          updated_at: string | null;
          // MIGRATION-47. Теги оператора для фильтрации в панели.
          tags: string[];
          // MIGRATION-49. Ниша деплоя для панели оператора — см.
          // lib/verticals/registry.ts. Рантайм клиента её не читает.
          vertical: string;
        };
        Insert: {
          notes?: string | null;
          paused_message?: string | null;
          archived_at?: string | null;
          owner_contact?: string | null;
          owner_name?: string | null;
          owner_telegram_id?: number | null;
          internal_secret?: string | null;
          app_url?: string | null;
          id?: string;
          bot_token?: string | null;
          bot_name: string;
          owner_id: string;
          status?: string | null;
          modules?: Json | null;
          settings?: Json | null;
          subscription_plan?: string | null;
          subscription_expires_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          tags?: string[];
          vertical?: string;
        };
        Update: {
          notes?: string | null;
          paused_message?: string | null;
          archived_at?: string | null;
          owner_contact?: string | null;
          owner_name?: string | null;
          owner_telegram_id?: number | null;
          internal_secret?: string | null;
          app_url?: string | null;
          id?: string;
          bot_token?: string | null;
          bot_name?: string;
          owner_id?: string;
          status?: string | null;
          modules?: Json | null;
          settings?: Json | null;
          subscription_plan?: string | null;
          subscription_expires_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          tags?: string[];
          vertical?: string;
        };
        Relationships: [];
      };
      // Заведена MIGRATION-48. Как и другие ручные добавления в этом файле:
      // scripts/sync-db-types.mjs новые объекты сюда не приносит.
      bot_health_snapshots: {
        Row: {
          id: string;
          bot_id: string;
          at: string;
          ok: boolean;
          error: string | null;
          pending_updates: number | null;
        };
        Insert: {
          id?: string;
          bot_id: string;
          at?: string;
          ok: boolean;
          error?: string | null;
          pending_updates?: number | null;
        };
        Update: {
          id?: string;
          bot_id?: string;
          at?: string;
          ok?: boolean;
          error?: string | null;
          pending_updates?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "bot_health_snapshots_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      zernio_logs: {
        Row: {
          id: string;
          event_id: string | null;
          event_type: string;
          status: string;
          payload: Json;
          error_message: string | null;
          created_at: string;
          bot_id: string | null;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          event_type: string;
          status?: string;
          payload?: Json;
          error_message?: string | null;
          created_at?: string;
          bot_id?: string | null;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          event_type?: string;
          status?: string;
          payload?: Json;
          error_message?: string | null;
          created_at?: string;
          bot_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "zernio_logs_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-29. Как и другие колонки/таблицы, добавленные
      // вручную: scripts/sync-db-types.mjs новые объекты сюда не приносит.
      whatsapp_templates: {
        Row: {
          id: string;
          bot_id: string;
          account_id: string;
          name: string;
          language: string;
          category: string;
          status: string;
          reason: string | null;
          components: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          account_id: string;
          name: string;
          language: string;
          category: string;
          status?: string;
          reason?: string | null;
          components?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          account_id?: string;
          name?: string;
          language?: string;
          category?: string;
          status?: string;
          reason?: string | null;
          components?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      vip_member_profiles: {
        Row: {
          legacy_locked: boolean;
          admin_label: string | null;
          bot_id: string;
          telegram_id: number;
          username: string | null;
          first_name: string | null;
          last_name: string | null;
          assigned_tariff_id: string | null;
          assigned_at: string;
          assigned_source: string;
          locale: string | null;
        };
        Insert: {
          legacy_locked?: boolean;
          admin_label?: string | null;
          bot_id?: string;
          telegram_id: number;
          username?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          assigned_tariff_id?: string | null;
          assigned_at?: string;
          assigned_source?: string;
          locale?: string | null;
        };
        Update: {
          legacy_locked?: boolean;
          admin_label?: string | null;
          bot_id?: string;
          telegram_id?: number;
          username?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          assigned_tariff_id?: string | null;
          assigned_at?: string;
          assigned_source?: string;
          locale?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vip_member_profiles_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vip_member_profiles_assigned_tariff_id_fkey";
            columns: ["assigned_tariff_id"];
            isOneToOne: false;
            referencedRelation: "vip_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      vip_tariffs: {
        Row: {
          is_public: boolean;
          is_entry: boolean;
          duration_minutes: number | null;
          id: string;
          bot_id: string;
          name: string;
          description: string;
          price: number;
          currency: string;
          duration_days: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          is_public?: boolean;
          is_entry?: boolean;
          duration_minutes?: number | null;
          id?: string;
          bot_id?: string;
          name: string;
          description?: string;
          price?: number;
          currency?: string;
          duration_days?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          is_public?: boolean;
          is_entry?: boolean;
          duration_minutes?: number | null;
          id?: string;
          bot_id?: string;
          name?: string;
          description?: string;
          price?: number;
          currency?: string;
          duration_days?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vip_tariffs_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      blocked_users: {
        Row: {
          bot_id: string;
          telegram_id: number;
          username: string | null;
          first_name: string | null;
          reason: string | null;
          blocked_at: string;
        };
        Insert: {
          bot_id?: string;
          telegram_id: number;
          username?: string | null;
          first_name?: string | null;
          reason?: string | null;
          blocked_at?: string;
        };
        Update: {
          bot_id?: string;
          telegram_id?: number;
          username?: string | null;
          first_name?: string | null;
          reason?: string | null;
          blocked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocked_users_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          id: string;
          status: string;
          message_text: string;
          photo_paths: Json;
          product_ids: Json;
          show_catalog: boolean;
          audience_type: string;
          audience_filter: Json;
          total_count: number;
          sent_count: number;
          failed_count: number;
          blocked_count: number;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
          bot_id: string | null;
          channel: string;
          account_id: string | null;
          template_name: string | null;
          template_language: string | null;
          template_params: Json;
        };
        Insert: {
          id?: string;
          status?: string;
          message_text: string;
          photo_paths?: Json;
          product_ids?: Json;
          show_catalog?: boolean;
          audience_type?: string;
          audience_filter?: Json;
          total_count?: number;
          sent_count?: number;
          failed_count?: number;
          blocked_count?: number;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          bot_id?: string | null;
          channel?: string;
          account_id?: string | null;
          template_name?: string | null;
          template_language?: string | null;
          template_params?: Json;
        };
        Update: {
          id?: string;
          status?: string;
          message_text?: string;
          photo_paths?: Json;
          product_ids?: Json;
          show_catalog?: boolean;
          audience_type?: string;
          audience_filter?: Json;
          total_count?: number;
          sent_count?: number;
          failed_count?: number;
          blocked_count?: number;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          bot_id?: string | null;
          channel?: string;
          account_id?: string | null;
          template_name?: string | null;
          template_language?: string | null;
          template_params?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      vip_subscriptions: {
        Row: {
          id: string;
          bot_id: string;
          telegram_id: number;
          username: string | null;
          first_name: string | null;
          last_name: string | null;
          tariff_id: string | null;
          status: string;
          payment_proof_path: string | null;
          group_invite_link: string | null;
          started_at: string | null;
          expires_at: string;
          imported: boolean;
          admin_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          telegram_id: number;
          username?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          tariff_id?: string | null;
          status?: string;
          payment_proof_path?: string | null;
          group_invite_link?: string | null;
          started_at?: string | null;
          expires_at: string;
          imported?: boolean;
          admin_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          telegram_id?: number;
          username?: string | null;
          first_name?: string | null;
          last_name?: string | null;
          tariff_id?: string | null;
          status?: string;
          payment_proof_path?: string | null;
          group_invite_link?: string | null;
          started_at?: string | null;
          expires_at?: string;
          imported?: boolean;
          admin_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vip_subscriptions_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vip_subscriptions_tariff_id_fkey";
            columns: ["tariff_id"];
            isOneToOne: false;
            referencedRelation: "vip_tariffs";
            referencedColumns: ["id"];
          },
        ];
      };
      product_material_files: {
        Row: {
          id: string;
          bot_id: string;
          product_id: string;
          language: string;
          file_path: string;
          file_name: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          product_id: string;
          language?: string;
          file_path: string;
          file_name?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          bot_id?: string;
          product_id?: string;
          language?: string;
          file_path?: string;
          file_name?: string | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_material_files_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_material_files_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      zernio_automations: {
        Row: {
          id: string;
          title: string;
          keywords: string[];
          reply_text: string;
          dm_text: string | null;
          post_id: string | null;
          is_active: boolean;
          trigger_count: number;
          created_at: string;
          updated_at: string;
          bot_id: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          keywords: string[];
          reply_text: string;
          dm_text?: string | null;
          post_id?: string | null;
          is_active?: boolean;
          trigger_count?: number;
          created_at?: string;
          updated_at?: string;
          bot_id?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          keywords?: string[];
          reply_text?: string;
          dm_text?: string | null;
          post_id?: string | null;
          is_active?: boolean;
          trigger_count?: number;
          created_at?: string;
          updated_at?: string;
          bot_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "zernio_automations_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          bot_id: string | null;
          key: string;
          updated_at: string;
          value: string | null;
        };
        Insert: {
          bot_id?: string | null;
          key: string;
          updated_at?: string;
          value?: string | null;
        };
        Update: {
          bot_id?: string | null;
          key?: string;
          updated_at?: string;
          value?: string | null;
        };
        Relationships: [];
      };
      bot_users: {
        Row: {
          email: string | null;
          metadata: Json;
          bot_id: string | null;
          last_auto_dm_at: string | null;
          opt_out: boolean;
          zernio_account_id: string | null;
          zernio_conversation_id: string | null;
          user_key: string;
          platform: string;
          contact_phone: string | null;
          created_at: string;
          first_name: string | null;
          language_code: string | null;
          last_name: string | null;
          loyalty_points: number;
          // MIGRATION-44. Когда последний раз слали напоминание о брошенной
          // корзине — тот же ручной патч, что и у остальных полей этого файла.
          cart_reminder_sent_at: string | null;
          state: Json;
          telegram_id: number;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          email?: string | null;
          metadata?: Json;
          bot_id?: string | null;
          last_auto_dm_at?: string | null;
          opt_out?: boolean;
          zernio_account_id?: string | null;
          zernio_conversation_id?: string | null;
          user_key: string;
          platform?: string;
          contact_phone?: string | null;
          created_at?: string;
          first_name?: string | null;
          language_code?: string | null;
          last_name?: string | null;
          loyalty_points?: number;
          cart_reminder_sent_at?: string | null;
          state?: Json;
          telegram_id: number;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          email?: string | null;
          metadata?: Json;
          bot_id?: string | null;
          last_auto_dm_at?: string | null;
          opt_out?: boolean;
          zernio_account_id?: string | null;
          zernio_conversation_id?: string | null;
          user_key?: string;
          platform?: string;
          contact_phone?: string | null;
          created_at?: string;
          first_name?: string | null;
          language_code?: string | null;
          last_name?: string | null;
          loyalty_points?: number;
          cart_reminder_sent_at?: string | null;
          state?: Json;
          telegram_id?: number;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          bot_id: string | null;
          user_key: string | null;
          created_at: string;
          id: string;
          product_id: string;
          quantity: number;
          telegram_id: number;
        };
        Insert: {
          bot_id?: string | null;
          user_key?: string | null;
          created_at?: string;
          id?: string;
          product_id: string;
          quantity?: number;
          telegram_id: number;
        };
        Update: {
          bot_id?: string | null;
          user_key?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string;
          quantity?: number;
          telegram_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_items_telegram_id_fkey";
            columns: ["telegram_id"];
            isOneToOne: false;
            referencedRelation: "bot_users";
            referencedColumns: ["telegram_id"];
          },
        ];
      };
      categories: {
        Row: {
          bot_id: string | null;
          created_at: string;
          id: string;
          is_visible: boolean;
          name: string;
          parent_id: string | null;
          sort_order: number;
        };
        Insert: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          is_visible?: boolean;
          name: string;
          parent_id?: string | null;
          sort_order?: number;
        };
        Update: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          is_visible?: boolean;
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-40-promo-codes.sql — добавлена вручную по тому же
      // поводу, что и остальные ручные таблицы этого файла: миграция готова,
      // но применяется отдельным шагом, а scripts/sync-db-types.mjs не
      // заводит новые таблицы сам.
      promo_codes: {
        Row: {
          id: string;
          bot_id: string;
          code: string;
          discount_type: string;
          discount_value: number;
          max_uses: number | null;
          used_count: number;
          valid_until: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          code: string;
          discount_type: string;
          discount_value: number;
          max_uses?: number | null;
          used_count?: number;
          valid_until?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          code?: string;
          discount_type?: string;
          discount_value?: number;
          max_uses?: number | null;
          used_count?: number;
          valid_until?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promo_codes_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      // Заведена MIGRATION-41-referrals.sql — добавлена вручную по тому же
      // поводу, что и promo_codes/остальные ручные таблицы этого файла.
      referrals: {
        Row: {
          id: string;
          bot_id: string;
          referrer_telegram_id: number;
          referred_telegram_id: number;
          status: string;
          reward_promo_code: string | null;
          created_at: string;
          rewarded_at: string | null;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          referrer_telegram_id: number;
          referred_telegram_id: number;
          status?: string;
          reward_promo_code?: string | null;
          created_at?: string;
          rewarded_at?: string | null;
        };
        Update: {
          id?: string;
          bot_id?: string;
          referrer_telegram_id?: number;
          referred_telegram_id?: number;
          status?: string;
          reward_promo_code?: string | null;
          created_at?: string;
          rewarded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "referrals_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      product_reviews: {
        Row: {
          id: string;
          bot_id: string;
          product_id: string;
          telegram_id: number;
          rating: number;
          comment: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          product_id: string;
          telegram_id: number;
          rating: number;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          product_id?: string;
          telegram_id?: number;
          rating?: number;
          comment?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_reviews_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      gift_certificates: {
        Row: {
          id: string;
          bot_id: string;
          code: string;
          amount: number;
          currency: string;
          note: string | null;
          status: string;
          redeemed_by_telegram_id: number | null;
          redeemed_order_id: number | null;
          created_at: string;
          redeemed_at: string | null;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          code: string;
          amount: number;
          currency?: string;
          note?: string | null;
          status?: string;
          redeemed_by_telegram_id?: number | null;
          redeemed_order_id?: number | null;
          created_at?: string;
          redeemed_at?: string | null;
        };
        Update: {
          id?: string;
          bot_id?: string;
          code?: string;
          amount?: number;
          currency?: string;
          note?: string | null;
          status?: string;
          redeemed_by_telegram_id?: number | null;
          redeemed_order_id?: number | null;
          created_at?: string;
          redeemed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "gift_certificates_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gift_certificates_redeemed_order_id_fkey";
            columns: ["redeemed_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          // MIGRATION-37. Снимок материалов по всем языкам разом (ru/kk/en/uz),
          // заменяет собой пару material_files_snapshot/material_files_kz_snapshot
          // для новых заказов — те остаются для старых строк и инструментов,
          // которые их ещё читают. Тот же ручной патч, что и у остальных
          // полей этого файла.
          material_files_by_lang: Json;
          material_files_kz_snapshot: Json;
          material_files_snapshot: Json;
          file_url_kz_snapshot: string | null;
          file_url_snapshot: string | null;
          bot_id: string | null;
          file_name_kz_snapshot: string | null;
          file_path_kz_snapshot: string | null;
          delivered_language: string | null;
          file_name_snapshot: string | null;
          file_path_snapshot: string | null;
          id: string;
          name_snapshot: string;
          order_id: number;
          price_snapshot: number;
          product_id: string | null;
          quantity: number;
        };
        Insert: {
          material_files_by_lang?: Json;
          material_files_kz_snapshot?: Json;
          material_files_snapshot?: Json;
          file_url_kz_snapshot?: string | null;
          file_url_snapshot?: string | null;
          bot_id?: string | null;
          file_name_kz_snapshot?: string | null;
          file_path_kz_snapshot?: string | null;
          delivered_language?: string | null;
          file_name_snapshot?: string | null;
          file_path_snapshot?: string | null;
          id?: string;
          name_snapshot: string;
          order_id: number;
          price_snapshot: number;
          product_id?: string | null;
          quantity?: number;
        };
        Update: {
          material_files_by_lang?: Json;
          material_files_kz_snapshot?: Json;
          material_files_snapshot?: Json;
          file_url_kz_snapshot?: string | null;
          file_url_snapshot?: string | null;
          bot_id?: string | null;
          file_name_kz_snapshot?: string | null;
          file_path_kz_snapshot?: string | null;
          delivered_language?: string | null;
          file_name_snapshot?: string | null;
          file_path_snapshot?: string | null;
          id?: string;
          name_snapshot?: string;
          order_id?: number;
          price_snapshot?: number;
          product_id?: string | null;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          customer_email: string | null;
          order_no: number;
          // MIGRATION-28. Номер, единожды показанный покупателю — в отличие
          // от order_no, никогда не меняется renumber_orders(). Добавлено
          // вручную по той же причине, что и остальные ручные правки этого
          // файла: миграция уже применена к живой базе, но
          // scripts/sync-db-types.mjs подтягивает только уже известные
          // таблицы/колонки при следующем запуске.
          display_no: number | null;
          bot_id: string | null;
          zernio_conversation_id: string | null;
          user_key: string | null;
          platform: string;
          delivery_index: number;
          // MIGRATION-32. Сколько раз подряд откатывалась выдача текущей
          // позиции заказа — потолок автоматических повторов (Блок 1.7).
          // Тот же ручной патч, что и у display_no выше.
          delivery_retry_count: number;
          admin_note: string | null;
          contact: string | null;
          country_code: string | null;
          country_name: string | null;
          created_at: string;
          currency: string;
          display_name: string | null;
          id: number;
          payment_proof_path: string | null;
          // MIGRATION-36. Хеш картинки чека — сверка на повтор (Блок A.4).
          // Тот же ручной патч, что и у остальных полей этого файла.
          payment_proof_hash: string | null;
          // MIGRATION-38. Язык доставки, выбранный ДО оформления
          // (delivery_lang_timing = "before"): код языка или "all". Тот же
          // ручной патч, что и у остальных полей этого файла.
          delivery_lang_choice: string | null;
          // MIGRATION-40. Применённый промокод и итоговая скидка — total уже
          // посчитан с её учётом, эти два поля только для истории/чека.
          promo_code: string | null;
          discount_amount: number;
          // MIGRATION-42. Баллы, списанные и начисленные по заказу — тот же
          // ручной патч, что и у остальных полей этого файла.
          points_used: number;
          points_earned: number;
          // MIGRATION-45. Применённый подарочный сертификат и скидка по нему —
          // тот же ручной патч, что и у остальных полей этого файла.
          gift_certificate_code: string | null;
          gift_certificate_discount: number;
          status: string;
          telegram_id: number;
          total: number;
          updated_at: string;
          username: string | null;
          // MIGRATION-49. Снимок products.fulfillment_kind на момент
          // оформления — решает, какая машина выдачи ведёт заказ.
          fulfillment_kind: string;
          fulfillment_type: string | null;
          fulfillment_at: string | null;
          fulfillment_address: string | null;
          fulfillment_note: string | null;
          paid_amount: number;
          // MIGRATION-51. Идемпотентность крона напоминания о fulfillment_at.
          fulfillment_reminder_sent_at: string | null;
          // MIGRATION-52. Выбранная зона доставки и её цена (снимок).
          delivery_zone_id: string | null;
          delivery_zone_name: string | null;
          delivery_fee: number;
        };
        Insert: {
          customer_email?: string | null;
          order_no?: number;
          display_no?: number | null;
          bot_id?: string | null;
          zernio_conversation_id?: string | null;
          user_key?: string | null;
          platform?: string;
          delivery_index?: number;
          delivery_retry_count?: number;
          admin_note?: string | null;
          contact?: string | null;
          country_code?: string | null;
          country_name?: string | null;
          created_at?: string;
          currency?: string;
          display_name?: string | null;
          id?: number;
          payment_proof_path?: string | null;
          payment_proof_hash?: string | null;
          delivery_lang_choice?: string | null;
          promo_code?: string | null;
          discount_amount?: number;
          points_used?: number;
          points_earned?: number;
          gift_certificate_code?: string | null;
          gift_certificate_discount?: number;
          status?: string;
          telegram_id: number;
          total?: number;
          updated_at?: string;
          username?: string | null;
          fulfillment_kind?: string;
          fulfillment_type?: string | null;
          fulfillment_at?: string | null;
          fulfillment_address?: string | null;
          fulfillment_note?: string | null;
          paid_amount?: number;
          fulfillment_reminder_sent_at?: string | null;
          delivery_zone_id?: string | null;
          delivery_zone_name?: string | null;
          delivery_fee?: number;
        };
        Update: {
          customer_email?: string | null;
          order_no?: number;
          display_no?: number | null;
          bot_id?: string | null;
          zernio_conversation_id?: string | null;
          user_key?: string | null;
          platform?: string;
          delivery_index?: number;
          delivery_retry_count?: number;
          admin_note?: string | null;
          contact?: string | null;
          country_code?: string | null;
          country_name?: string | null;
          created_at?: string;
          currency?: string;
          display_name?: string | null;
          id?: number;
          payment_proof_path?: string | null;
          payment_proof_hash?: string | null;
          delivery_lang_choice?: string | null;
          promo_code?: string | null;
          discount_amount?: number;
          points_used?: number;
          points_earned?: number;
          gift_certificate_code?: string | null;
          gift_certificate_discount?: number;
          status?: string;
          telegram_id?: number;
          total?: number;
          updated_at?: string;
          username?: string | null;
          fulfillment_kind?: string;
          fulfillment_type?: string | null;
          fulfillment_at?: string | null;
          fulfillment_address?: string | null;
          fulfillment_note?: string | null;
          paid_amount?: number;
          fulfillment_reminder_sent_at?: string | null;
          delivery_zone_id?: string | null;
          delivery_zone_name?: string | null;
          delivery_fee?: number;
        };
        Relationships: [
          {
            foreignKeyName: "orders_telegram_id_fkey";
            columns: ["telegram_id"];
            isOneToOne: false;
            referencedRelation: "bot_users";
            referencedColumns: ["telegram_id"];
          },
        ];
      };
      payment_methods: {
        Row: {
          qr_code_path: string | null;
          bot_id: string | null;
          country_code: string;
          country_name: string;
          created_at: string;
          currency: string;
          id: string;
          instructions: string;
          is_active: boolean;
          sort_order: number;
        };
        Insert: {
          qr_code_path?: string | null;
          bot_id?: string | null;
          country_code: string;
          country_name: string;
          created_at?: string;
          currency?: string;
          id?: string;
          instructions: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Update: {
          qr_code_path?: string | null;
          bot_id?: string | null;
          country_code?: string;
          country_name?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          instructions?: string;
          is_active?: boolean;
          sort_order?: number;
        };
        Relationships: [];
      };
      // MIGRATION-52.
      delivery_zones: {
        Row: {
          id: string;
          bot_id: string;
          name: string;
          price: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          bot_id?: string;
          name: string;
          price?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          bot_id?: string;
          name?: string;
          price?: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "delivery_zones_bot_id_fkey";
            columns: ["bot_id"];
            isOneToOne: false;
            referencedRelation: "bots";
            referencedColumns: ["id"];
          },
        ];
      };
      ig_keywords: {
        Row: {
          bot_id: string | null;
          comment_reply_text: string | null;
          comments_post_id: string | null;
          created_at: string;
          dm_file_kind: string | null;
          dm_file_name: string | null;
          dm_file_path: string | null;
          id: string;
          is_active: boolean;
          keyword: string;
          post_id: string | null;
          post_note: string | null;
          post_shortcode: string | null;
          reply_text: string;
          updated_at: string;
        };
        Insert: {
          bot_id?: string | null;
          comment_reply_text?: string | null;
          comments_post_id?: string | null;
          created_at?: string;
          dm_file_kind?: string | null;
          dm_file_name?: string | null;
          dm_file_path?: string | null;
          id?: string;
          is_active?: boolean;
          keyword: string;
          post_id?: string | null;
          post_note?: string | null;
          post_shortcode?: string | null;
          reply_text: string;
          updated_at?: string;
        };
        Update: {
          bot_id?: string | null;
          comment_reply_text?: string | null;
          comments_post_id?: string | null;
          created_at?: string;
          dm_file_kind?: string | null;
          dm_file_name?: string | null;
          dm_file_path?: string | null;
          id?: string;
          is_active?: boolean;
          keyword?: string;
          post_id?: string | null;
          post_note?: string | null;
          post_shortcode?: string | null;
          reply_text?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ig_poll_runs: {
        Row: {
          bot_id: string | null;
          comments_scanned: number;
          errors: string | null;
          finished_at: string | null;
          id: string;
          matched: number;
          note: string | null;
          posts_polled: number;
          rules_count: number;
          sent: number;
          skipped: number;
          started_at: string;
          status: string;
        };
        Insert: {
          bot_id?: string | null;
          comments_scanned?: number;
          errors?: string | null;
          finished_at?: string | null;
          id?: string;
          matched?: number;
          note?: string | null;
          posts_polled?: number;
          rules_count?: number;
          sent?: number;
          skipped?: number;
          started_at?: string;
          status?: string;
        };
        Update: {
          bot_id?: string | null;
          comments_scanned?: number;
          errors?: string | null;
          finished_at?: string | null;
          id?: string;
          matched?: number;
          note?: string | null;
          posts_polled?: number;
          rules_count?: number;
          sent?: number;
          skipped?: number;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      ig_watched_posts: {
        Row: {
          bot_id: string | null;
          caption_snapshot: string | null;
          comments_post_id: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          post_display_id: string | null;
          post_id: string;
          post_shortcode: string | null;
          updated_at: string;
        };
        Insert: {
          bot_id?: string | null;
          caption_snapshot?: string | null;
          comments_post_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          post_display_id?: string | null;
          post_id: string;
          post_shortcode?: string | null;
          updated_at?: string;
        };
        Update: {
          bot_id?: string | null;
          caption_snapshot?: string | null;
          comments_post_id?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          post_display_id?: string | null;
          post_id?: string;
          post_shortcode?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      ig_exclusions: {
        Row: {
          bot_id: string | null;
          created_at: string;
          id: string;
          provider_user_id: string | null;
          reason: string | null;
          username: string | null;
        };
        Insert: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          provider_user_id?: string | null;
          reason?: string | null;
          username?: string | null;
        };
        Update: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          provider_user_id?: string | null;
          reason?: string | null;
          username?: string | null;
        };
        Relationships: [];
      };
      ig_comment_actions: {
        Row: {
          bot_id: string | null;
          attempt_no: number;
          comment_id: string;
          comment_text: string | null;
          created_at: string;
          debug_info: Json | null;
          error_message: string | null;
          id: string;
          keyword_id: string | null;
          lead_id: string | null;
          post_id: string;
          provider_user_id: string | null;
          status: string;
          username: string | null;
        };
        Insert: {
          bot_id?: string | null;
          attempt_no?: number;
          comment_id: string;
          comment_text?: string | null;
          created_at?: string;
          debug_info?: Json | null;
          error_message?: string | null;
          id?: string;
          keyword_id?: string | null;
          lead_id?: string | null;
          post_id: string;
          provider_user_id?: string | null;
          status?: string;
          username?: string | null;
        };
        Update: {
          bot_id?: string | null;
          attempt_no?: number;
          comment_id?: string;
          comment_text?: string | null;
          created_at?: string;
          debug_info?: Json | null;
          error_message?: string | null;
          id?: string;
          keyword_id?: string | null;
          lead_id?: string | null;
          post_id?: string;
          provider_user_id?: string | null;
          status?: string;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ig_comment_actions_keyword_id_fkey";
            columns: ["keyword_id"];
            isOneToOne: false;
            referencedRelation: "ig_keywords";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ig_comment_actions_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "ig_post_leads";
            referencedColumns: ["id"];
          },
        ];
      };
      ig_post_leads: {
        Row: {
          bot_id: string | null;
          author_profile_id: string | null;
          closed_reason: string | null;
          comment_replied_at: string | null;
          created_at: string;
          dm_attempts: number;
          dm_recipient_id: string | null;
          dm_sent_at: string | null;
          dm_status: string;
          first_comment_id: string | null;
          first_dm_attempt_at: string | null;
          id: string;
          is_active: boolean;
          keyword_id: string | null;
          last_comment_id: string | null;
          last_comment_text: string | null;
          last_error: string | null;
          next_retry_at: string | null;
          post_id: string;
          provider_user_id: string;
          retry_until_at: string | null;
          unipile_comment_id: string | null;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          bot_id?: string | null;
          author_profile_id?: string | null;
          closed_reason?: string | null;
          comment_replied_at?: string | null;
          created_at?: string;
          dm_attempts?: number;
          dm_recipient_id?: string | null;
          dm_sent_at?: string | null;
          dm_status?: string;
          first_comment_id?: string | null;
          first_dm_attempt_at?: string | null;
          id?: string;
          is_active?: boolean;
          keyword_id?: string | null;
          last_comment_id?: string | null;
          last_comment_text?: string | null;
          last_error?: string | null;
          next_retry_at?: string | null;
          post_id: string;
          provider_user_id: string;
          retry_until_at?: string | null;
          unipile_comment_id?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          bot_id?: string | null;
          author_profile_id?: string | null;
          closed_reason?: string | null;
          comment_replied_at?: string | null;
          created_at?: string;
          dm_attempts?: number;
          dm_recipient_id?: string | null;
          dm_sent_at?: string | null;
          dm_status?: string;
          first_comment_id?: string | null;
          first_dm_attempt_at?: string | null;
          id?: string;
          is_active?: boolean;
          keyword_id?: string | null;
          last_comment_id?: string | null;
          last_comment_text?: string | null;
          last_error?: string | null;
          next_retry_at?: string | null;
          post_id?: string;
          provider_user_id?: string;
          retry_until_at?: string | null;
          unipile_comment_id?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ig_post_leads_keyword_id_fkey";
            columns: ["keyword_id"];
            isOneToOne: false;
            referencedRelation: "ig_keywords";
            referencedColumns: ["id"];
          },
        ];
      };
      product_images: {
        Row: {
          bot_id: string | null;
          created_at: string;
          id: string;
          image_path: string;
          product_id: string;
          sort_order: number;
        };
        Insert: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          image_path: string;
          product_id: string;
          sort_order?: number;
        };
        Update: {
          bot_id?: string | null;
          created_at?: string;
          id?: string;
          image_path?: string;
          product_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          file_url_kz: string | null;
          file_url: string | null;
          bot_id: string | null;
          file_name_kz: string | null;
          file_path_kz: string | null;
          category_ids: Json;
          country_prices: Json;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string;
          file_name: string | null;
          file_path: string | null;
          id: string;
          is_active: boolean;
          keywords: string;
          name: string;
          price: number;
          // MIGRATION-43. Кэш агрегата product_reviews, пересчитывается
          // триггером на самой таблице отзывов — не источник истины. Тот же
          // ручной патч, что и у остальных полей этого файла.
          rating_avg: number | null;
          rating_count: number;
          sort_order: number;
          // MIGRATION-46. NULL — остаток не отслеживается (безлимитно).
          stock_quantity: number | null;
          // MIGRATION-49. digital (умолчание) — выдача файлом. physical —
          // изготавливается/выдаётся руками, продажа не требует файлов.
          fulfillment_kind: string;
          lead_time_days: number | null;
        };
        Insert: {
          file_url_kz?: string | null;
          file_url?: string | null;
          bot_id?: string | null;
          file_name_kz?: string | null;
          file_path_kz?: string | null;
          category_ids: Json;
          country_prices: Json;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string;
          file_name?: string | null;
          file_path?: string | null;
          id?: string;
          is_active?: boolean;
          keywords?: string;
          name: string;
          price?: number;
          rating_avg?: number | null;
          rating_count?: number;
          sort_order?: number;
          stock_quantity?: number | null;
          fulfillment_kind?: string;
          lead_time_days?: number | null;
        };
        Update: {
          file_url_kz?: string | null;
          file_url?: string | null;
          bot_id?: string | null;
          file_name_kz?: string | null;
          file_path_kz?: string | null;
          category_ids?: Json;
          country_prices?: Json;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string;
          file_name?: string | null;
          file_path?: string | null;
          id?: string;
          is_active?: boolean;
          keywords?: string;
          name?: string;
          price?: number;
          rating_avg?: number | null;
          rating_count?: number;
          sort_order?: number;
          stock_quantity?: number | null;
          fulfillment_kind?: string;
          lead_time_days?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      // Добавлено вручную: scripts/sync-db-types.mjs переносит только таблицы.
      // MIGRATION-10. Вызывать может лишь service_role (панель) — у anon,
      // authenticated и tenant_bot права отозваны.
      operator_bot_stats: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bot_id: string;
          orders_total: number;
          orders_30d: number;
          last_order_at: string | null;
          products_total: number;
          customers_total: number;
          storage_bytes: number;
        }[];
      };
      // Добавлено вручную по той же причине, что и operator_bot_stats.
      // MIGRATION-39. Разбивка storage_bytes по видам файлов (для
      // донат-чартов панели оператора) — та же методика подсчёта, что и у
      // operator_bot_stats, просто без схлопывания в один total.
      operator_storage_by_kind: {
        Args: Record<PropertyKey, never>;
        Returns: {
          bot_id: string;
          storage_kind: string;
          storage_bytes: number;
        }[];
      };
      // Добавлено вручную по той же причине, что и operator_bot_stats.
      // PATCH-BROADCASTS. Атомарный инкремент счётчиков рассылки: без него
      // параллельные воркеры затирают счёт друг друга (read-then-write).
      // Все три p_* в базе имеют DEFAULT 0, но broadcast.server.ts всегда
      // передаёт их явно, поэтому здесь они не опциональны.
      increment_broadcast_counts: {
        Args: {
          p_broadcast_id: string;
          p_sent: number;
          p_failed: number;
          p_blocked: number;
        };
        Returns: undefined;
      };
      // Добавлено вручную по той же причине. MIGRATION-26. Атомарный
      // upsert+инкремент unread_count в manager_chat_state — вызывается под
      // tenant_bot на каждое сообщение чата с менеджером.
      manager_chat_touch: {
        Args: {
          p_bot_id: string;
          p_telegram_id: number;
          p_direction: string;
          p_sender: string;
          p_preview: string;
        };
        Returns: undefined;
      };
      // MIGRATION-27. Атомарный захват «этот покупатель уже оформляет заказ»
      // одним оператором — пришёл на смену CAS по updated_at, который рушился
      // от посторонних записей в ту же строку bot_users.
      claim_order_placement: {
        Args: {
          p_bot_id: string;
          p_telegram_id: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
