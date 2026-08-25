-- Кейс 3, Задача 5 — отзывы и рейтинг товаров.
--
-- Один отзыв на пару (товар, покупатель) — повторное «Оценить» этим же
-- покупателем переписывает старую оценку, а не плодит вторую строку.
-- Право оставить отзыв проверяется в коде (реально доставленная покупка
-- этого товара), а не здесь: это то же самое разделение ответственности,
-- что и у остальных таблиц этого файла — RLS/UNIQUE держат целостность,
-- бизнес-правило живёт в приложении.
--
-- rating_avg/rating_count на products — кэш агрегата, чтобы не считать
-- AVG/COUNT по product_reviews на каждый показ карточки товара в каталоге;
-- пересчитывается триггером на самой таблице отзывов, не приложением.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, product_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews(bot_id, product_id);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.product_reviews;
CREATE POLICY tenant_isolation ON public.product_reviews
  FOR ALL TO tenant_bot
  USING      (bot_id = public.current_bot_id())
  WITH CHECK (bot_id = public.current_bot_id());

DROP TRIGGER IF EXISTS trg_force_bot_id ON public.product_reviews;
CREATE TRIGGER trg_force_bot_id
  BEFORE INSERT ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.force_bot_id();

-- touch_updated_at() уже объявлена в MIGRATION-31.
DROP TRIGGER IF EXISTS trg_product_reviews_touch ON public.product_reviews;
CREATE TRIGGER trg_product_reviews_touch BEFORE UPDATE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_reviews TO tenant_bot;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS rating_avg   NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_product_rating() RETURNS TRIGGER AS $$
DECLARE
  target_product UUID := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  UPDATE public.products p
  SET rating_avg = sub.avg_rating, rating_count = sub.cnt
  FROM (
    SELECT AVG(rating)::NUMERIC(3,2) AS avg_rating, COUNT(*)::INT AS cnt
    FROM public.product_reviews
    WHERE product_id = target_product
  ) sub
  WHERE p.id = target_product;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_recompute_product_rating ON public.product_reviews;
CREATE TRIGGER trg_recompute_product_rating
  AFTER INSERT OR UPDATE OF rating OR DELETE ON public.product_reviews
  FOR EACH ROW EXECUTE FUNCTION public.recompute_product_rating();

COMMIT;

NOTIFY pgrst, 'reload schema';
