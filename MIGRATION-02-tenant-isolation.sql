-- ═══════════════════════════════════════════════════════════════════════════
-- ФАЗА 2 — изоляция арендаторов средствами Postgres (RLS + JWT).
--
-- ПРИМЕНЯТЬ ТОЛЬКО ПОСЛЕ:
--   1. успешной ФАЗЫ 1;
--   2. деплоя кода, где currency.server.ts использует onConflict "bot_id,key"
--      (старое значение "key" перестанет работать сразу после этой миграции).
--
-- Пока приложение ходит под service_role, эта миграция НИЧЕГО не меняет в его
-- поведении: service_role обходит RLS. Политики начинают действовать в момент,
-- когда деплой переключают на персональный JWT арендатора.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Кто мы — читаем bot_id из JWT-претензии ───────────────────────────
CREATE OR REPLACE FUNCTION public.current_bot_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json ->> 'bot_id', '')::uuid
$$;

-- ─── 2. Роль арендатора ───────────────────────────────────────────────────
-- NOLOGIN: подключение всегда идёт через authenticator, который переключается
-- в эту роль по claim "role" из JWT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_bot') THEN
    CREATE ROLE tenant_bot NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT tenant_bot TO authenticator;
GRANT USAGE ON SCHEMA public TO tenant_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tenant_bot;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO tenant_bot;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO tenant_bot;

-- Чтобы будущие таблицы не остались без прав
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO tenant_bot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT                  ON SEQUENCES TO tenant_bot;

-- ─── 3. Составные ключи вместо глобальных ────────────────────────────────
-- Два разных клиента обязаны иметь право на одинаковый ключ настройки и на
-- одного и того же покупателя в Telegram.

-- app_settings: PK (key) → (bot_id, key)
ALTER TABLE public.app_settings ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey CASCADE;
ALTER TABLE public.app_settings ADD  CONSTRAINT app_settings_pkey PRIMARY KEY (bot_id, key);

-- bot_users: PK (user_key) → (bot_id, user_key), плюс уникальность telegram_id
-- в пределах одного бота.
ALTER TABLE public.bot_users ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE public.bot_users DROP CONSTRAINT IF EXISTS bot_users_pkey CASCADE;
ALTER TABLE public.bot_users ADD  CONSTRAINT bot_users_pkey PRIMARY KEY (bot_id, user_key);
DROP INDEX IF EXISTS bot_users_user_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS bot_users_bot_telegram_idx ON public.bot_users(bot_id, telegram_id);

-- ─── 4. Автопростановка bot_id при вставке ───────────────────────────────
-- Под JWT арендатора значение всегда принудительно берётся из претензии —
-- подделать его из приложения невозможно. Под service_role (нет претензии)
-- поведение прежнее: что передали / что в DEFAULT.
CREATE OR REPLACE FUNCTION public.force_bot_id() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE claim uuid := public.current_bot_id();
BEGIN
  IF claim IS NOT NULL THEN
    NEW.bot_id := claim;
  END IF;
  RETURN NEW;
END $$;

-- ─── 5. Политики изоляции на каждой таблице с bot_id ─────────────────────
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'products','categories','orders','order_items','app_settings',
    'payment_methods','broadcasts','ig_poll_runs','bot_users','cart_items',
    'product_images','broadcast_recipients','zernio_logs','zernio_automations',
    'ig_watched_posts','ig_keywords','ig_exclusions','ig_comment_actions',
    'ig_post_leads','blocked_users','vip_tariffs','vip_subscriptions',
    'vip_member_profiles','product_material_files'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO tenant_bot
        USING      (bot_id = public.current_bot_id())
        WITH CHECK (bot_id = public.current_bot_id())
    $f$, t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_force_bot_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_force_bot_id BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.force_bot_id()', t);
  END LOOP;
END $$;

-- Сам список ботов: арендатор видит только свою запись и не может её менять.
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_sees_own_bot ON public.bots;
CREATE POLICY tenant_sees_own_bot ON public.bots
  FOR SELECT TO tenant_bot
  USING (id = public.current_bot_id());

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА ИЗОЛЯЦИИ (выполнить после применения, до переключения деплоев)
--
-- Подставить реальный bot_id и убедиться, что видно только его данные:
--
--   SET LOCAL ROLE tenant_bot;
--   SET LOCAL request.jwt.claims = '{"role":"tenant_bot","bot_id":"<UUID>"}';
--   SELECT count(*) FROM products;   -- только товары этого бота
--   RESET ROLE;
--
-- И что чужое недоступно — с ЧУЖИМ bot_id в претензии count должен быть 0.
-- ═══════════════════════════════════════════════════════════════════════════
