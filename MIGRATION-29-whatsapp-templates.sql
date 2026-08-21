-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 29 — шаблоны сообщений WhatsApp.
--
-- Зачем таблица, если шаблоны и так живут у Meta.
--
-- WhatsApp не разрешает писать покупателю свободным текстом позже 24 часов с
-- его последнего сообщения — только заранее одобренным шаблоном. Одобрение
-- идёт до суток, и вердикт приходит вебхуком `whatsapp.template.status_updated`,
-- а не по запросу. То есть между «продавец отправил шаблон на ревью» и
-- «шаблоном можно пользоваться» проходит время, в течение которого состояние
-- надо где-то держать: у себя, чтобы показать продавцу статус и причину
-- отказа, и чтобы не дёргать Meta на каждый рендер вкладки.
--
-- Список у Meta остаётся источником истины; эта таблица — наш кеш плюс место,
-- куда ложится вердикт из вебхука.
--
-- Колонку `platform` в bot_users/orders заводить не нужно: она уже есть
-- (TEXT без CHECK, добавлена миграцией под Instagram Direct), значение
-- 'whatsapp' пишется в неё без изменений схемы.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  -- Идентификатор аккаунта в Zernio. TEXT, а не ссылка: аккаунты живут у
  -- Zernio, своей таблицы аккаунтов в этой базе нет.
  account_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  language    TEXT NOT NULL,
  category    TEXT NOT NULL,
  -- Вердикт Meta дословно: PENDING / APPROVED / REJECTED / IN_APPEAL /
  -- PAUSED / DISABLED / PENDING_DELETION. CHECK не ставим намеренно —
  -- список значений принадлежит Meta, и новое значение с её стороны не
  -- должно ронять запись вебхука.
  status      TEXT NOT NULL DEFAULT 'PENDING',
  -- Причина отказа от Meta. При одобрении приходит строка "NONE".
  reason      TEXT,
  components  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Meta различает шаблоны по паре «имя + язык»: один и тот же шаблон
  -- существует отдельной записью на каждом языке.
  UNIQUE (bot_id, account_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_bot_id
  ON public.whatsapp_templates(bot_id);

-- Вкладка «Шаблоны» и подбор шаблона для рассылки читают только одобренные —
-- частичный индекс под этот запрос.
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_approved
  ON public.whatsapp_templates(bot_id, account_id)
  WHERE status = 'APPROVED';

-- ─── Изоляция арендаторов: ровно как в MIGRATION-02 ───────────────────────
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.whatsapp_templates;
CREATE POLICY tenant_isolation ON public.whatsapp_templates
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

-- bot_id проставляется из JWT-претензии, а не из тела запроса.
DROP TRIGGER IF EXISTS trg_force_bot_id ON public.whatsapp_templates;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

-- MIGRATION-02 выдала права роли арендатора через ALTER DEFAULT PRIVILEGES,
-- но только для таблиц, созданных той же ролью. Повторяем явно, чтобы
-- таблица не осталась без прав независимо от того, кто её создал.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO tenant_bot;

COMMIT;
