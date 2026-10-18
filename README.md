# Donas Dulce Mordida

Sitio público: https://maikoldurand2-ops.github.io/donas-dulce-mordida/

Administración: https://maikoldurand2-ops.github.io/donas-dulce-mordida/admin/

## Usar el panel

El primer acceso requiere abrir la invitación privada enviada al correo autorizado y elegir una contraseña de al menos 12 caracteres. Después, entra por **Administrar**. Las sesiones viven solo en memoria: al recargar el panel tendrás que iniciar sesión otra vez. No cierres la primera activación antes de guardar la contraseña.

**Productos** permite agregar, editar, desactivar, ordenar y eliminar productos con nombre, descripción, precio en dólares, cantidad de mini donas e imagen. **Combos** permite reunir uno o varios productos con cantidades y un precio de oferta propio. **Imágenes** permite subir JPEG, PNG o WebP de hasta 5 MB, cambiar descripciones, ordenar la galería y elegir las fotos de portada y menú.

Los cambios se guardan en Supabase, no en el navegador ni en `localStorage`. Al volver o recargar el sitio público se consulta el catálogo vigente. No necesitas hacer un commit por cada cambio comercial. El guardado de un combo y de sus componentes sucede en una sola transacción.

Un producto usado en un combo no se puede eliminar. Primero retíralo de los combos o elimina esos combos. Tampoco se puede desactivar un producto que pertenezca a un combo activo. Para eliminar una imagen usada como portada o menú, selecciona otra antes. Borrar una imagen del catálogo retira su asociación a los productos y combos; borrar una foto originalmente incluida en GitHub no elimina su archivo histórico del repositorio.

Las fotos son públicas. Desactivar una foto la oculta del catálogo, pero no vuelve privado su enlace. Los archivos nuevos se guardan en el bucket público `catalog-images`; al eliminarlos se intenta borrar también su archivo. El panel informa si la limpieza falla. No subas documentos privados.

Los pedidos abren WhatsApp al **+58 414-2227837** con producto o combo y precio base. La disponibilidad, los extras, la entrega y el total se confirman allí. No se cobra desde la web. El menú original fotografiado se conserva como referencia; los precios vigentes son los de las tarjetas del catálogo, por lo que conviene reemplazar también esa imagen cuando cambie la lista de precios.

## Seguridad y mantenimiento

La web usa únicamente la URL y clave **publicable** del proyecto, en `assets/js/backend.js`. Esos valores no son secretos: las políticas de PostgreSQL y de Storage protegen las escrituras por el UUID de la cuenta administradora. Nunca incluyas claves `service_role`, contraseñas, tokens, invitaciones o credenciales de servidor en este repositorio.

La lista de administradores está en una tabla privada sin permisos para los visitantes. El control del correo en el formulario solo mejora la experiencia; la autorización efectiva se aplica en el servidor. La activación usa un token de un solo uso en el fragmento de URL, que se retira inmediatamente del historial. No hay formularios de registro público ni almacenamiento persistente de tokens en este frontend. La cuenta se creó por invitación; la recuperación administrativa del acceso requiere generar un enlace nuevo seguro, no modificar el JavaScript para saltarse la autorización.

Las migraciones de `supabase/migrations/` documentan el esquema y sus políticas. El proyecto ya está configurado; no vuelvas a ejecutarlas sobre las tablas existentes. La asignación de la cuenta administradora y los datos iniciales se aprovisionaron por separado, sin credenciales en el repositorio. La función temporal de configuración quedó cerrada (HTTP 410) y se retiraron sus permisos y tabla auxiliar.

Supabase informa que la comprobación de contraseñas filtradas no está habilitada en el proyecto. Usa una contraseña larga, única y no reutilizada. No se activaron servicios de pago ni cambios de plan para esa función. Información: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Desarrollo y comprobaciones

Sirve el directorio mediante HTTP, por ejemplo `python3 -m http.server 8765`. No abras los módulos JavaScript con `file://`.

- `python3 tests/http_public.py` comprueba lectura real y rechazo de escrituras anónimas. Sus aserciones de precios reflejan el menú inicial y deberán actualizarse si cambia.
- `tests/rls.sql` prueba permisos de administrador, visitante y usuario no autorizado, además de CRUD y combos. Debe ejecutarse como rol privilegiado, completo y con su `ROLLBACK` final; no conserva los datos de prueba.
- `node --check assets/js/catalog.js`, `node --check assets/js/backend.js` y `node --check admin/admin.js` validan sintaxis.

Si Supabase no responde, el sitio avisa y no presenta precios antiguos como actuales. El contacto por WhatsApp sigue disponible. El frontend se publica por GitHub Pages; los cambios de código se guardan en commits normales, sin reescribir el historial.
