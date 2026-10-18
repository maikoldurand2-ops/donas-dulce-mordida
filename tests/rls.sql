-- Ejecutar completo en Supabase SQL Editor / execute_sql (como rol con BYPASSRLS).
-- Usa únicamente fixtures transaccionales; el ROLLBACK final revierte los datos de prueba.
BEGIN;

-- La identidad real y su allowlist deben estar ya configuradas; no se otorgan privilegios de prueba.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = 'effb3ff3-9051-435d-8ff2-cc44942e7ac3'::uuid
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Falta el usuario administrador real effb3ff3-9051-435d-8ff2-cc44942e7ac3 en auth.users.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.catalog_admins
    WHERE user_id = 'effb3ff3-9051-435d-8ff2-cc44942e7ac3'::uuid
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'El usuario real aún no está en private.catalog_admins; configura la allowlist antes de ejecutar estas pruebas.';
  END IF;
END
$$;

-- Fixtures públicos (activos/inactivos) para probar visibilidad y denegaciones.
DO $$
BEGIN
  INSERT INTO public.catalog_images(id,url,storage_path,caption,active,in_gallery,sort_order) VALUES
    ('10000000-0000-4000-8000-000000000001','https://example.invalid/rls-active.jpg',NULL,'rls-active-image',true,true,9001),
    ('10000000-0000-4000-8000-000000000002','https://example.invalid/rls-inactive.jpg',NULL,'rls-inactive-image',false,false,9002),
    ('10000000-0000-4000-8000-000000000003','https://example.invalid/rls-second.jpg',NULL,'rls-second-image',true,true,9003);
  INSERT INTO public.products(id,name,description,price,quantity,image_id,active,sort_order) VALUES
    ('10000000-0000-4000-8000-000000000011','rls-active-product','fixture',1.00,1,'10000000-0000-4000-8000-000000000001',true,9001),
    ('10000000-0000-4000-8000-000000000012','rls-inactive-product','fixture',1.00,1,NULL,false,9002),
    ('10000000-0000-4000-8000-000000000013','rls-second-product','fixture',1.00,1,NULL,true,9003);
  INSERT INTO public.combos(id,name,description,price,image_id,active,sort_order) VALUES
    ('10000000-0000-4000-8000-000000000021','rls-active-combo','fixture',2.00,NULL,true,9001),
    ('10000000-0000-4000-8000-000000000022','rls-inactive-combo','fixture',2.00,NULL,false,9002);
  INSERT INTO public.combo_items(combo_id,product_id,quantity) VALUES
    ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000011',1),
    ('10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000011',1);
  INSERT INTO public.site_settings(key,image_id) VALUES ('hero','10000000-0000-4000-8000-000000000001')
  ON CONFLICT (key) DO UPDATE SET image_id=EXCLUDED.image_id;
END
$$;

-- Flujos que usa el panel autenticado: crear/editar/borrar imagen y producto,
-- crear/editar combo con save_combo (incluye componentes) y borrarlo.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"effb3ff3-9051-435d-8ff2-cc44942e7ac3","role":"authenticated"}';
DO $$
DECLARE
  v_id uuid;
  v_rows integer;
  v_admin boolean;
  v_exists boolean;
BEGIN
  SELECT public.is_catalog_admin() INTO v_admin LIMIT 1;
  IF NOT v_admin THEN RAISE EXCEPTION 'El UUID administrador no supera public.is_catalog_admin().'; END IF;

  INSERT INTO public.catalog_images(id,url,caption,active,in_gallery,sort_order)
  VALUES ('20000000-0000-4000-8000-000000000001','https://example.invalid/admin.jpg','admin-created',true,true,9101);
  UPDATE public.catalog_images SET caption='admin-edited' WHERE id='20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo actualizar catalog_images.'; END IF;

  INSERT INTO public.products(id,name,description,price,quantity,image_id,active,sort_order)
  VALUES ('20000000-0000-4000-8000-000000000002','admin-created-product','fixture',10.00,2,'20000000-0000-4000-8000-000000000001',true,9101);
  UPDATE public.products SET name='admin-edited-product',price=11.00
  WHERE id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo actualizar products.'; END IF;

  SELECT public.save_combo(
    NULL,'admin-created-combo','fixture',15.00,'20000000-0000-4000-8000-000000000001',true,9101,
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":2}]'::jsonb
  ) INTO v_id LIMIT 1;
  IF v_id IS DISTINCT FROM '20000000-0000-4000-8000-000000000003'::uuid THEN
    -- La función genera UUID propios; el retorno solo debe ser no nulo.
    IF v_id IS NULL THEN RAISE EXCEPTION 'save_combo no devolvió id al crear.'; END IF;
  END IF;
  SELECT public.save_combo(
    v_id,'admin-edited-combo','edited',16.00,'20000000-0000-4000-8000-000000000001',true,9102,
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]'::jsonb
  ) INTO v_id LIMIT 1;
  SELECT EXISTS (
    SELECT 1 FROM public.combo_items
    WHERE combo_id=v_id AND product_id='20000000-0000-4000-8000-000000000002' AND quantity=3
    LIMIT 1
  ) INTO v_exists LIMIT 1;
  IF NOT v_exists THEN RAISE EXCEPTION 'save_combo no reemplazó atómicamente los componentes.'; END IF;
END
$$;

-- Fuerza la ejecución de los constraint triggers diferidos de combos creados/editados,
-- antes de borrarlos. Se ejecuta después de save_combo (que depende de constraints deferred).
SET CONSTRAINTS ALL IMMEDIATE;
DO $$
DECLARE
  v_id uuid;
  v_rows integer;
  v_exists boolean;
  v_restricted boolean;
  v_deactivation_rejected boolean;
BEGIN
  SELECT id INTO v_id FROM public.combos
  WHERE name='admin-edited-combo' AND sort_order=9102
  LIMIT 1;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No se encontró el combo válido creado por save_combo.'; END IF;

  -- La FK combo_items.product_id debe usar ON DELETE RESTRICT para un producto referenciado.
  v_restricted := false;
  BEGIN
    DELETE FROM public.products WHERE id='20000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN foreign_key_violation THEN
    v_restricted := true;
  END;
  IF NOT v_restricted THEN
    RAISE EXCEPTION 'Borrar un producto referenciado por un combo no produjo FK RESTRICT (filas=%).', v_rows;
  END IF;

  -- Un producto usado en un combo activo no puede desactivarse.
  v_deactivation_rejected := false;
  BEGIN
    UPDATE public.products SET active=false WHERE id='20000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN raise_exception THEN
    v_deactivation_rejected := true;
  END;
  IF NOT v_deactivation_rejected THEN
    RAISE EXCEPTION 'Se permitió desactivar un producto usado por un combo activo (filas=%).', v_rows;
  END IF;

  DELETE FROM public.combos WHERE id=v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo borrar el combo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combo_items WHERE combo_id=v_id LIMIT 1) INTO v_exists LIMIT 1;
  IF v_exists THEN RAISE EXCEPTION 'Borrar combo no eliminó sus componentes.'; END IF;

  DELETE FROM public.products WHERE id='20000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo borrar products.'; END IF;
  DELETE FROM public.catalog_images WHERE id='20000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo borrar catalog_images.'; END IF;

  UPDATE public.site_settings SET image_id='10000000-0000-4000-8000-000000000003' WHERE key='hero';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Admin no pudo actualizar site_settings.'; END IF;
END
$$;
RESET ROLE;

-- Anónimo: solo catálogo activo; sin escrituras en ninguna tabla ni RPC save_combo.
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';
DO $$
DECLARE
  v boolean;
  v_sql text;
  v_denied boolean;
  v_rows integer;
  v_id uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.catalog_images WHERE id='10000000-0000-4000-8000-000000000001' LIMIT 1) INTO v LIMIT 1;
  IF NOT v THEN RAISE EXCEPTION 'Anon no ve imagen activa.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.catalog_images WHERE id='10000000-0000-4000-8000-000000000002' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'Anon ve imagen inactiva.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.products WHERE id='10000000-0000-4000-8000-000000000011' LIMIT 1) INTO v LIMIT 1;
  IF NOT v THEN RAISE EXCEPTION 'Anon no ve producto activo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.products WHERE id='10000000-0000-4000-8000-000000000012' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'Anon ve producto inactivo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combos WHERE id='10000000-0000-4000-8000-000000000021' LIMIT 1) INTO v LIMIT 1;
  IF NOT v THEN RAISE EXCEPTION 'Anon no ve combo activo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combos WHERE id='10000000-0000-4000-8000-000000000022' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'Anon ve combo inactivo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combo_items WHERE combo_id='10000000-0000-4000-8000-000000000021' LIMIT 1) INTO v LIMIT 1;
  IF NOT v THEN RAISE EXCEPTION 'Anon no ve componentes de combo activo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combo_items WHERE combo_id='10000000-0000-4000-8000-000000000022' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'Anon ve componentes de combo inactivo.'; END IF;

  FOR v_sql IN SELECT q FROM (VALUES
    ('INSERT INTO public.catalog_images(id,url,caption) VALUES (''30000000-0000-4000-8000-000000000001'',''https://example.invalid/anon.jpg'',''x'')'),
    ('INSERT INTO public.products(id,name,price,quantity) VALUES (''30000000-0000-4000-8000-000000000002'',''anon'',''1'',1)'),
    ('INSERT INTO public.combos(id,name,price) VALUES (''30000000-0000-4000-8000-000000000003'',''anon'',''1'')'),
    ('INSERT INTO public.combo_items(combo_id,product_id,quantity) VALUES (''10000000-0000-4000-8000-000000000021'',''10000000-0000-4000-8000-000000000013'',1)'),
    ('INSERT INTO public.site_settings(key,image_id) VALUES (''menu'',''10000000-0000-4000-8000-000000000001'')'),
    ('UPDATE public.catalog_images SET caption=''anon'' WHERE id=''10000000-0000-4000-8000-000000000001'''),
    ('UPDATE public.products SET name=''anon'' WHERE id=''10000000-0000-4000-8000-000000000011'''),
    ('UPDATE public.combos SET name=''anon'' WHERE id=''10000000-0000-4000-8000-000000000021'''),
    ('UPDATE public.combo_items SET quantity=9 WHERE combo_id=''10000000-0000-4000-8000-000000000021'' AND product_id=''10000000-0000-4000-8000-000000000011'''),
    ('UPDATE public.site_settings SET image_id=''10000000-0000-4000-8000-000000000003'' WHERE key=''hero'''),
    ('DELETE FROM public.catalog_images WHERE id=''10000000-0000-4000-8000-000000000001'''),
    ('DELETE FROM public.products WHERE id=''10000000-0000-4000-8000-000000000013'''),
    ('DELETE FROM public.combos WHERE id=''10000000-0000-4000-8000-000000000021'''),
    ('DELETE FROM public.combo_items WHERE combo_id=''10000000-0000-4000-8000-000000000021'' AND product_id=''10000000-0000-4000-8000-000000000011'''),
    ('DELETE FROM public.site_settings WHERE key=''hero''')
  ) AS tests(q) LIMIT 15 LOOP
    v_denied := false;
    BEGIN
      EXECUTE v_sql;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN RAISE EXCEPTION 'Anon logró DML: %', v_sql; END IF;
      -- Sin ACL para anon, cada DML debe fallar por permiso (no solo afectar cero filas).
      IF v_sql LIKE 'INSERT%' OR v_sql LIKE 'UPDATE%' OR v_sql LIKE 'DELETE%' THEN
        RAISE EXCEPTION 'Anon ejecutó una sentencia DML sin error: %', v_sql;
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'No se denegó DML anónimo: %', v_sql; END IF;
  END LOOP;

  v_denied := false;
  BEGIN
    SELECT public.save_combo(NULL,'anon','',1,NULL,true,0,'[{"product_id":"10000000-0000-4000-8000-000000000011","quantity":1}]'::jsonb) INTO v_id LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Anon pudo ejecutar save_combo.'; END IF;

  -- Sondeo Storage sin archivos: INSERT debe rechazarse por ACL/RLS; update/delete apuntan
  -- a un nombre inexistente, evitando crear o modificar objetos físicos.
  v_denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('catalog-images','rls-probe-anon-no-file');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Storage permitió INSERT a anon.'; END IF;
  v_denied := false;
  BEGIN
    UPDATE storage.objects SET name='rls-probe-anon-no-file-renamed' WHERE bucket_id='catalog-images' AND name='rls-probe-nonexistent';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; v_rows := 0;
  END;
  IF NOT v_denied AND v_rows <> 0 THEN RAISE EXCEPTION 'Storage update de anon afectó objeto.'; END IF;
  v_denied := false;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id='catalog-images' AND name='rls-probe-nonexistent';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; v_rows := 0;
  END;
  IF NOT v_denied AND v_rows <> 0 THEN RAISE EXCEPTION 'Storage delete de anon afectó objeto.'; END IF;
END
$$;
RESET ROLE;

-- Usuario autenticado no administrador: conserva lectura pública de activos, pero no DML/RPC.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}';
DO $$
DECLARE
  v boolean;
  v_sql text;
  v_denied boolean;
  v_rows integer;
  v_id uuid;
BEGIN
  SELECT public.is_catalog_admin() INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'La identidad de prueba no-admin aparece autorizada.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.products WHERE id='10000000-0000-4000-8000-000000000011' LIMIT 1) INTO v LIMIT 1;
  IF NOT v THEN RAISE EXCEPTION 'No-admin no ve producto activo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.products WHERE id='10000000-0000-4000-8000-000000000012' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'No-admin ve producto inactivo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.catalog_images WHERE id='10000000-0000-4000-8000-000000000002' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'No-admin ve imagen inactiva.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combos WHERE id='10000000-0000-4000-8000-000000000022' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'No-admin ve combo inactivo.'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.combo_items WHERE combo_id='10000000-0000-4000-8000-000000000022' LIMIT 1) INTO v LIMIT 1;
  IF v THEN RAISE EXCEPTION 'No-admin ve componentes de combo inactivo.'; END IF;

  FOR v_sql IN SELECT q FROM (VALUES
    ('INSERT INTO public.catalog_images(id,url,caption) VALUES (''40000000-0000-4000-8000-000000000001'',''https://example.invalid/nonadmin.jpg'',''x'')'),
    ('INSERT INTO public.products(id,name,price,quantity) VALUES (''40000000-0000-4000-8000-000000000002'',''nonadmin'',''1'',1)'),
    ('INSERT INTO public.combos(id,name,price) VALUES (''40000000-0000-4000-8000-000000000003'',''nonadmin'',''1'')'),
    ('INSERT INTO public.combo_items(combo_id,product_id,quantity) VALUES (''10000000-0000-4000-8000-000000000021'',''10000000-0000-4000-8000-000000000013'',1)'),
    ('INSERT INTO public.site_settings(key,image_id) VALUES (''menu'',''10000000-0000-4000-8000-000000000001'')'),
    ('UPDATE public.catalog_images SET caption=''nonadmin'' WHERE id=''10000000-0000-4000-8000-000000000001'''),
    ('UPDATE public.products SET name=''nonadmin'' WHERE id=''10000000-0000-4000-8000-000000000011'''),
    ('UPDATE public.combos SET name=''nonadmin'' WHERE id=''10000000-0000-4000-8000-000000000021'''),
    ('UPDATE public.combo_items SET quantity=9 WHERE combo_id=''10000000-0000-4000-8000-000000000021'' AND product_id=''10000000-0000-4000-8000-000000000011'''),
    ('UPDATE public.site_settings SET image_id=''10000000-0000-4000-8000-000000000003'' WHERE key=''hero'''),
    ('DELETE FROM public.catalog_images WHERE id=''10000000-0000-4000-8000-000000000001'''),
    ('DELETE FROM public.products WHERE id=''10000000-0000-4000-8000-000000000013'''),
    ('DELETE FROM public.combos WHERE id=''10000000-0000-4000-8000-000000000021'''),
    ('DELETE FROM public.combo_items WHERE combo_id=''10000000-0000-4000-8000-000000000021'' AND product_id=''10000000-0000-4000-8000-000000000011'''),
    ('DELETE FROM public.site_settings WHERE key=''hero''')
  ) AS tests(q) LIMIT 15 LOOP
    v_denied := false;
    BEGIN
      EXECUTE v_sql;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN RAISE EXCEPTION 'No-admin logró DML: %', v_sql; END IF;
      IF v_sql LIKE 'INSERT%' THEN RAISE EXCEPTION 'No-admin ejecutó INSERT sin error: %', v_sql; END IF;
      -- UPDATE/DELETE bajo RLS se esperan sin error y con cero filas.
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    IF v_sql LIKE 'UPDATE%' OR v_sql LIKE 'DELETE%' THEN
      IF NOT v_denied AND v_rows <> 0 THEN RAISE EXCEPTION 'No-admin UPDATE/DELETE no quedó bloqueado: %', v_sql; END IF;
    ELSIF NOT v_denied THEN
      RAISE EXCEPTION 'No-admin INSERT no fue denegado: %', v_sql;
    END IF;
  END LOOP;

  v_denied := false;
  BEGIN
    SELECT public.save_combo('10000000-0000-4000-8000-000000000021'::uuid,'nope','',3,NULL,true,0,'[{"product_id":"10000000-0000-4000-8000-000000000011","quantity":1}]'::jsonb) INTO v_id LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'No-admin pudo ejecutar save_combo.'; END IF;

  v_denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('catalog-images','rls-probe-nonadmin-no-file');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Storage permitió INSERT a no-admin.'; END IF;
  v_denied := false;
  BEGIN
    UPDATE storage.objects SET name='rls-probe-nonadmin-no-file-renamed' WHERE bucket_id='catalog-images' AND name='rls-probe-nonexistent';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; v_rows := 0;
  END;
  IF NOT v_denied AND v_rows <> 0 THEN RAISE EXCEPTION 'Storage update de no-admin afectó objeto.'; END IF;
  v_denied := false;
  BEGIN
    DELETE FROM storage.objects WHERE bucket_id='catalog-images' AND name='rls-probe-nonexistent';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; v_rows := 0;
  END;
  IF NOT v_denied AND v_rows <> 0 THEN RAISE EXCEPTION 'Storage delete de no-admin afectó objeto.'; END IF;
END
$$;
RESET ROLE;

SELECT 'OK: pruebas RLS, CRUD admin, save_combo, lectura pública y denegaciones anon/no-admin completadas; fixtures revertidos.' AS resultado
LIMIT 1;
ROLLBACK;
