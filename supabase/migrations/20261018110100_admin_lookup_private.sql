-- La única función con privilegios elevados vive fuera de la API pública.
grant usage on schema private to anon, authenticated, service_role;
create function private.is_catalog_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.catalog_admins where user_id=auth.uid());
$$;
revoke all on function private.is_catalog_admin() from public;
grant execute on function private.is_catalog_admin() to anon, authenticated, service_role;
create or replace function public.is_catalog_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_catalog_admin();
$$;
revoke all on function public.is_catalog_admin() from public;
grant execute on function public.is_catalog_admin() to anon, authenticated, service_role;
