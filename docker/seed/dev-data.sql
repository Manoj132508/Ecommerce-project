-- Disposable local test catalogue for docker/compose.yaml (profile "seed").
-- Invented products with the repository's own images; no real customer data.
-- Idempotent: running it again changes nothing that is already there.
BEGIN;

INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES
  ('1', 7, 0),
  ('2', 3, 499),
  ('3', 1, 999)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                      stock, inventory_tracked, rating_stars, rating_count, price_cents, keywords)
VALUES
  ('e43638ce-6aa0-4b85-b27f-e1d07eb678c6', 'images/products/athletic-skateboard-shoes-gray.jpg', 'Athletic Skateboard Shoes',
   'Grippy canvas shoes for everyday skating.', 'Lace up and go.', '{Durable,Breathable}', 'Wipe clean.', 'Footwear',
   50, false, 4.5, 87, 3390, '{shoes,sports}'),
  ('15b6fc6f-327a-4ec4-896f-486349e85a3d', 'images/products/luxury-towel-set.jpg', 'Luxury Towel Set',
   'Six soft cotton towels.', 'Use and wash.', '{Absorbent}', 'Machine wash at 40 °C.', 'Home',
   50, false, 4.5, 144, 3599, '{bathroom,towels}'),
  ('83d4ca15-0f35-48f5-b7a3-1ea210004f2e', 'images/products/black-and-silver-espresso-maker.jpg', 'Espresso Maker',
   'Stovetop espresso for two.', 'Fill, heat and pour.', '{"Stainless steel"}', 'Rinse after use.', 'Kitchen',
   50, false, 4.5, 1211, 8990, '{coffee,appliances}'),
  ('54e0eccd-8f36-462b-b68a-8182611d9add', 'images/products/round-sunglasses-gold.jpg', 'Round Sunglasses',
   'Gold-framed UV400 sunglasses.', 'Wear outdoors.', '{"UV400 lenses"}', 'Clean with the cloth.', 'Accessories',
   50, false, 4.5, 30, 1560, '{sunglasses}'),
  ('3ebe75dc-64d2-4137-8860-1f5a963e534b', 'images/products/straw-sunhat.jpg', 'Straw Sunhat',
   'Wide-brimmed woven sunhat.', 'Wear in the sun.', '{Lightweight}', 'Spot clean.', 'Accessories',
   50, false, 4.0, 215, 2200, '{hats,summer}'),
  -- Stock-protection checks: tracked, only two in stock.
  ('5968897c-4d33-4aa0-9c5b-f7e1d8b7fc43', 'images/products/bathroom-mat.jpg', 'Bathroom Mat',
   'Quick-drying bathroom mat.', 'Place on the floor.', '{Non-slip}', 'Machine wash.', 'Home',
   2, true, 4.5, 99, 1850, '{bathroom}')
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM delivery_options) AS delivery_options;
