-- История падений бота — снимки состояния по крону (раз в 15 минут), чтобы
-- панель оператора могла показать не только «сейчас отвечает/не отвечает»,
-- но и что было между визитами оператора.

CREATE TABLE IF NOT EXISTS public.bot_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  error TEXT,
  pending_updates INTEGER
);

CREATE INDEX IF NOT EXISTS bot_health_snapshots_bot_id_at_idx
  ON public.bot_health_snapshots (bot_id, at DESC);

COMMENT ON TABLE public.bot_health_snapshots IS
  'Снимки состояния бота по крону раз в 15 минут — источник истории падений в панели оператора. Хранится 30 дней, старее удаляет тот же крон.';
