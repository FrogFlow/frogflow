-- ═══════════════════════════════════════════════════════════════════════════
-- Первое касание лида из WhatsApp Business / Instagram Business FrogFlow
-- через Zernio, а не через личный wa.me оператора.
--
-- conversation_id / zernio_account_id — чтобы дожим и входящий ответ
-- попали в тот же диалог. outreach_error — текст отказа Meta/Zernio
-- (шаблон, 24ч окно, холодный Direct), чтобы карточка не молчала.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_account_id TEXT,
  ADD COLUMN IF NOT EXISTS outreach_error TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_leads_conversation_id
  ON public.sales_leads(conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Проверка
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'sales_leads'
--      AND column_name IN ('conversation_id','zernio_account_id','outreach_error');
-- ═══════════════════════════════════════════════════════════════════════════
