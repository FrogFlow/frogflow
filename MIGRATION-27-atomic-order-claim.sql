-- ═══════════════════════════════════════════════════════════════════════════
-- claim_order_placement(bot_id, telegram_id) — атомарный захват «этот
-- покупатель уже оформляет заказ», одним оператором вместо
-- «прочитал → проверил → записал с условием updated_at».
--
-- ── Что сломалось ──
-- claimOrderPlacement (bot.server.ts → claimBotUserState в
-- bot-user-claim.server.ts) делал CAS по updated_at:
--
--   SELECT state, updated_at FROM bot_users WHERE telegram_id = X;
--   UPDATE bot_users SET state = ... WHERE telegram_id = X
--     AND updated_at = <прочитанное>;
--
-- Токеном служил updated_at, а он обновляется триггером
-- trg_bot_users_touch на ЛЮБОЙ апдейт строки — в том числе на upsertUser(),
-- который handleUpdate вызывает на каждое нажатие кнопки, ещё до
-- оформления. То есть токен инвалидируется посторонней записью, а не
-- конкурирующим оформлением.
--
-- Пока обработка укладывалась в один быстрый проход, это не всплывало:
-- нажатие обрабатывается синхронно (webhook.ts, checkout не в списке
-- isSlow), и параллельных исполнений просто не было. Модуль «Чат с
-- менеджером» добавил на этот же путь несколько лишних обращений к базе
-- (лог входящего нажатия + лог каждого исходящего сообщения внутри tg()),
-- обработка стала заметно дольше, Telegram начал повторять то же
-- обновление, не дождавшись ответа, — и появились параллельные исполнения
-- одного и того же «Оформить заказ». Дальше по кругу: upsertUser каждого
-- исполнения сдвигает updated_at и рушит захват соседнего, оба захвата
-- возвращают false, placeOrder молча выходит — ни заказа, ни ответа
-- покупателю. Ровно то, что наблюдалось: нажатия видны в логе чата,
-- заказов в orders нет, бот молчит.
--
-- ── Почему функция, а не запрос из кода ──
-- Условие должно проверяться и применяться в одном операторе, иначе между
-- проверкой и записью снова остаётся щель. jsonb_set внутри UPDATE меняет
-- state существующей строки на месте — заодно не затирая параллельную
-- запись соседних ключей state (country_code, locale), чего не умеет
-- «прочитал целиком и записал целиком» из приложения.
--
-- Возвращает true, если захват получен именно этим вызовом.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_order_placement(
  p_bot_id uuid,
  p_telegram_id bigint
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_claimed bigint;
BEGIN
  UPDATE public.bot_users
  SET state = jsonb_set(
        COALESCE(state, '{}'::jsonb),
        '{placing_order}',
        'true'::jsonb,
        true
      )
  WHERE telegram_id = p_telegram_id
    AND bot_id = p_bot_id
    -- COALESCE обязателен: у строк без этого ключа state->>'placing_order'
    -- равен NULL, а NULL <> 'true' даёт NULL, то есть строка не прошла бы
    -- условие вовсе — классическая ловушка трёхзначной логики.
    AND COALESCE((state->>'placing_order')::boolean, false) = false
  RETURNING telegram_id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.claim_order_placement(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_order_placement(uuid, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_placement(uuid, bigint) TO tenant_bot, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'claim_order_placement';
--   -- ожидается: tenant_bot, service_role, postgres — без anon/authenticated
--
--   -- Захват берётся один раз и не берётся повторно, пока не снят:
--   SELECT public.claim_order_placement('<bot_id>', <telegram_id>);  -- true
--   SELECT public.claim_order_placement('<bot_id>', <telegram_id>);  -- false
--   UPDATE public.bot_users SET state = state - 'placing_order'
--    WHERE telegram_id = <telegram_id>;
--   SELECT public.claim_order_placement('<bot_id>', <telegram_id>);  -- true
-- ═══════════════════════════════════════════════════════════════════════════
