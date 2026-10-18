begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.catalog_admins (user_id uuid primary key references auth.users(id) on delete cascade);
revoke all on private.catalog_admins from public, anon, authenticated;
create or replace function public.is_catalog_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.catalog_admins where user_id = auth.uid());
$$;
revoke all on function public.is_catalog_admin() from public;
grant execute on function public.is_catalog_admin() to anon, authenticated, service_role;

create table public.catalog_images (
 id uuid primary key default gen_random_uuid(), url text not null check (url ~ '^https://'),
 storage_path text unique, caption text not null default '' check(length(caption)<=200),
 in_gallery boolean not null default true, active boolean not null default true,
 sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table public.products (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100),
 description text not null default '' check(length(description)<=1000), price numeric(10,2) not null check(price>=0 and price<=999999),
 quantity integer not null check(quantity between 1 and 10000),
 image_id uuid references public.catalog_images(id) on delete set null,
 active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
create table public.combos (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100),
 description text not null default '' check(length(description)<=1000), price numeric(10,2) not null check(price>=0 and price<=999999),
 image_id uuid references public.catalog_images(id) on delete set null,
 active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
create table public.combo_items (
 combo_id uuid not null references public.combos(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 quantity integer not null check(quantity between 1 and 1000), primary key(combo_id,product_id)
);
create table public.site_settings (
 key text primary key check(key in ('hero','menu')),
 image_id uuid not null references public.catalog_images(id) on delete restrict
);
create index products_image_idx on public.products(image_id);
create index combos_image_idx on public.combos(image_id);
create index combo_items_product_idx on public.combo_items(product_id);
create index settings_image_idx on public.site_settings(image_id);

alter table public.catalog_images enable row level security;
alter table public.products enable row level security;
alter table public.combos enable row level security;
alter table public.combo_items enable row level security;
alter table public.site_settings enable row level security;
revoke all on public.catalog_images, public.products, public.combos, public.combo_items, public.site_settings from anon, authenticated;
grant select on public.catalog_images, public.products, public.combos, public.combo_items, public.site_settings to anon, authenticated;
grant insert, update, delete on public.catalog_images, public.products, public.combos, public.combo_items to authenticated;
grant update on public.site_settings to authenticated;

create policy images_read on public.catalog_images for select to anon, authenticated using(active or public.is_catalog_admin());
create policy images_admin on public.catalog_images for all to authenticated using(public.is_catalog_admin()) with check(public.is_catalog_admin());
create policy products_read on public.products for select to anon, authenticated using(active or public.is_catalog_admin());
create policy products_admin on public.products for all to authenticated using(public.is_catalog_admin()) with check(public.is_catalog_admin());
create policy combos_read on public.combos for select to anon, authenticated using(active or public.is_catalog_admin());
create policy combos_admin on public.combos for all to authenticated using(public.is_catalog_admin()) with check(public.is_catalog_admin());
create policy combo_items_read on public.combo_items for select to anon, authenticated using(exists(select 1 from public.combos c where c.id=combo_id and c.active) or public.is_catalog_admin());
create policy combo_items_admin on public.combo_items for all to authenticated using(public.is_catalog_admin()) with check(public.is_catalog_admin());
create policy settings_read on public.site_settings for select to anon, authenticated using(true);
create policy settings_admin on public.site_settings for update to authenticated using(public.is_catalog_admin()) with check(public.is_catalog_admin());

create function public.validate_combo() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.combos where id=coalesce(new.combo_id,old.combo_id)) then return null; end if;
 if not exists(select 1 from public.combo_items where combo_id=coalesce(new.combo_id,old.combo_id)) then
   raise exception 'Un combo debe contener al menos un producto.';
 end if;
 if exists(select 1 from public.combos c join public.combo_items ci on ci.combo_id=c.id join public.products p on p.id=ci.product_id where c.id=coalesce(new.combo_id,old.combo_id) and c.active and not p.active) then
   raise exception 'Un combo activo solo puede contener productos activos.';
 end if;
 return null;
end $$;
revoke all on function public.validate_combo() from public, anon, authenticated;
create constraint trigger combo_items_valid after insert or update or delete on public.combo_items deferrable initially deferred for each row execute function public.validate_combo();
create function public.check_combo_row() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.combos where id=new.id) then return null; end if;
 if not exists(select 1 from public.combo_items where combo_id=new.id) then raise exception 'Un combo debe contener al menos un producto.'; end if;
 if exists(select 1 from public.combos c join public.combo_items ci on ci.combo_id=c.id join public.products p on p.id=ci.product_id where c.id=new.id and c.active and not p.active) then raise exception 'Un combo activo solo puede contener productos activos.'; end if;
 return null;
end $$;
revoke all on function public.check_combo_row() from public, anon, authenticated;
create constraint trigger combos_valid after insert or update on public.combos deferrable initially deferred for each row execute function public.check_combo_row();
create function public.protect_combo_products() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.active and not new.active and exists(select 1 from public.combo_items ci join public.combos c on c.id=ci.combo_id where ci.product_id=new.id and c.active) then
  raise exception 'Desactiva o modifica primero los combos activos que utilizan este producto.';
 end if;
 return new;
end $$;
revoke all on function public.protect_combo_products() from public, anon, authenticated;
create trigger protect_combo_products before update on public.products for each row execute function public.protect_combo_products();

create function public.save_combo(p_id uuid,p_name text,p_description text,p_price numeric,p_image_id uuid,p_active boolean,p_sort_order integer,p_items jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_count integer;
begin
 if not public.is_catalog_admin() then raise exception 'Acceso denegado.' using errcode='42501'; end if;
 if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Selecciona entre 1 y 50 productos.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as i(product_id uuid,quantity integer) where quantity is null or quantity not between 1 and 1000 or product_id is null) then raise exception 'Componente no válido.'; end if;
 perform p.id from public.products p join jsonb_to_recordset(p_items) as i(product_id uuid,quantity integer) on p.id=i.product_id order by p.id for share of p;
 select count(*) into v_count from public.products p join jsonb_to_recordset(p_items) as i(product_id uuid,quantity integer) on p.id=i.product_id where not p_active or p.active;
 if v_count<>jsonb_array_length(p_items) then raise exception 'Uno de los productos no existe o está inactivo.'; end if;
 if p_id is null then
  insert into public.combos(name,description,price,image_id,active,sort_order) values(p_name,p_description,p_price,p_image_id,p_active,p_sort_order) returning id into v_id;
 else
  update public.combos set name=p_name,description=p_description,price=p_price,image_id=p_image_id,active=p_active,sort_order=p_sort_order where id=p_id returning id into v_id;
  if v_id is null then raise exception 'El combo ya no existe.'; end if;
  delete from public.combo_items where combo_id=v_id;
 end if;
 insert into public.combo_items(combo_id,product_id,quantity) select v_id,i.product_id,i.quantity from jsonb_to_recordset(p_items) as i(product_id uuid,quantity integer);
 return v_id;
end $$;
revoke all on function public.save_combo(uuid,text,text,numeric,uuid,boolean,integer,jsonb) from public,anon;
grant execute on function public.save_combo(uuid,text,text,numeric,uuid,boolean,integer,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('catalog-images','catalog-images',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy catalog_storage_read on storage.objects for select to anon,authenticated using(bucket_id='catalog-images');
create policy catalog_storage_insert on storage.objects for insert to authenticated with check(bucket_id='catalog-images' and public.is_catalog_admin());
create policy catalog_storage_update on storage.objects for update to authenticated using(bucket_id='catalog-images' and public.is_catalog_admin()) with check(bucket_id='catalog-images' and public.is_catalog_admin());
create policy catalog_storage_delete on storage.objects for delete to authenticated using(bucket_id='catalog-images' and public.is_catalog_admin());
commit;
