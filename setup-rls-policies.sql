-- === RLS POLICIES FOR STORAGE BUCKETS ===

-- Политики для product-images (публичный доступ на чтение)
DROP POLICY IF EXISTS "Public Read product-images" ON storage.objects;
CREATE POLICY "Public Read product-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'product-images');

-- product-files НЕ публичный: это платный контент, а не превью, и продавец
-- не должен раздавать его всем желающим по одной угаданной ссылке. Доступ
-- идёт только через подписанные ссылки под service_role (см.
-- orders.server.ts), которым эта политика не нужна — service_role видит
-- objects независимо от RLS. Публичной политики здесь нарочно нет: тот же
-- скрипт, прогнанный повторно на проде, раньше молча отменял MIGRATION-20
-- и открывал бакет заново. См. MIGRATION-33.
DROP POLICY IF EXISTS "Public Read product-files" ON storage.objects;

-- Политики для payment-proofs (только сервисный роль)
DROP POLICY IF EXISTS "Service Role All payment-proofs" ON storage.objects;
CREATE POLICY "Service Role All payment-proofs"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'payment-proofs')
WITH CHECK (bucket_id = 'payment-proofs');

-- === RLS POLICIES FOR TABLES ===

-- Categories
DROP POLICY IF EXISTS "Service Role All categories" ON public.categories;
CREATE POLICY "Service Role All categories"
ON public.categories FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Products
DROP POLICY IF EXISTS "Service Role All products" ON public.products;
CREATE POLICY "Service Role All products"
ON public.products FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Product images
DROP POLICY IF EXISTS "Service Role All product_images" ON public.product_images;
CREATE POLICY "Service Role All product_images"
ON public.product_images FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Payment methods
DROP POLICY IF EXISTS "Service Role All payment_methods" ON public.payment_methods;
CREATE POLICY "Service Role All payment_methods"
ON public.payment_methods FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Bot users
DROP POLICY IF EXISTS "Service Role All bot_users" ON public.bot_users;
CREATE POLICY "Service Role All bot_users"
ON public.bot_users FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Cart items
DROP POLICY IF EXISTS "Service Role All cart_items" ON public.cart_items;
CREATE POLICY "Service Role All cart_items"
ON public.cart_items FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Orders
DROP POLICY IF EXISTS "Service Role All orders" ON public.orders;
CREATE POLICY "Service Role All orders"
ON public.orders FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Order items
DROP POLICY IF EXISTS "Service Role All order_items" ON public.order_items;
CREATE POLICY "Service Role All order_items"
ON public.order_items FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- App settings
DROP POLICY IF EXISTS "Service Role All app_settings" ON public.app_settings;
CREATE POLICY "Service Role All app_settings"
ON public.app_settings FOR ALL
TO service_role
USING (true)
WITH CHECK (true);