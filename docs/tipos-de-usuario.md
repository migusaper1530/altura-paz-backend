# Tipos de usuario · actualización del 10 de noviembre de 2026

Se implementan cuatro tablas de perfil, con una cuenta común en `identity.users` para correo único, nombre, contraseña scrypt, rol y estado de habilitación. Cada nuevo registro guarda cuenta y perfil en la misma transacción: si falla uno, se revierten ambos.

| Tipo | Rol en API/JWT | Tabla | Datos propios |
|---|---|---|---|
| Cliente o turista | `tourist` | `identity.tourist_profiles` | Referencia a su cuenta |
| Guía | `guide` | `identity.guide_profiles` | Biografía, referencia privada de credencial, estado y revisión |
| Empresa o grupo | `organization` | `identity.organization_profiles` | Nombre, `organization_type` (`company` o `group`), descripción y fecha de actualización |
| Administrador | `admin` | `identity.admin_profiles` | Referencia a su cuenta |

## Registro

`POST /api/auth/register` acepta `email`, `password` (12 a 128 caracteres), `name` y el tipo `role`. Si se omite el tipo se registra un turista, conservando compatibilidad con los clientes anteriores.

```json
{"email":"turista@example.test","password":"Ejemplo-largo-12345","name":"Turista","role":"tourist"}
```

```json
{"email":"guia@example.test","password":"Ejemplo-largo-12345","name":"Guía","role":"guide","bio":"Guía de montaña","credential_reference":"REFERENCIA-DE-PRUEBA"}
```

```json
{"email":"empresa@example.test","password":"Ejemplo-largo-12345","name":"Responsable","role":"organization","organization_name":"Empresa de turismo","organization_type":"company","description":"Senderismo"}
```

Para un grupo se utiliza la misma estructura de organización con `organization_type: "group"`. Cada empresa o grupo utiliza una cuenta propia; la gestión de miembros no forma parte de este cambio.

## Inicio de sesión y perfiles

Todos los tipos inician sesión en `POST /api/auth/login` con correo y contraseña. La respuesta contiene un JWT de quince minutos con su rol. `GET /api/users/me` devuelve los datos de la cuenta y un objeto `profile` con los datos específicos. `PATCH /api/users/me` actualiza el nombre común y no acepta cambios de rol.

El perfil público `GET /api/users/{userId}` muestra nombre, rol, biografía/estado de guía o información de organización. Omite correo, contraseña y referencia privada de credencial.

| Operación | Acceso |
|---|---|
| `PATCH /api/organizations/me` | Empresa/grupo actualiza su nombre, tipo y descripción; no modifica otras cuentas |
| `PATCH /api/guides/me` | Cuenta con perfil de guía actualiza su biografía |
| `POST /api/guides/applications` | Turista se convierte en guía pendiente; guía pendiente/rechazado vuelve a solicitar |
| `GET /api/admin/guides` | Solo administración consulta solicitudes pendientes |
| `POST /api/admin/guides/{userId}/review` | Solo otra persona administradora verifica o rechaza |
| `POST /api/admin/users` | Solo administración crea una nueva cuenta administradora |

El alta administrativa exige `email`, `password`, `name` y `role: "admin"`. Devuelve la cuenta sin emitir una sesión para la nueva persona. El registro público rechaza `role: "admin"`. La primera cuenta administradora sigue creándose desde las variables privadas `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

Un guía recién registrado tiene estado `pending`; solo el estado `verified` indica verificación profesional. Una solicitud rechazada conserva su cuenta de guía y puede corregirse y reenviarse. Turistas, guías y organizaciones mantienen la posibilidad de publicar rutas propias. Se conservan la aprobación de cambios populares, moderación y demás reglas existentes.

## Migración y verificación

El servicio Compose `migrate` ejecuta la migración transaccional `db/migrations/003-user-types.sql` antes del inicio de identidad. Un bloqueo transaccional y el registro de versión permiten repetir el arranque con seguridad. No requiere eliminar volúmenes.

- Los antiguos `hiker` pasan a `tourist` y reciben su perfil.
- Quienes ya tenían una solicitud de guía pasan a `guide`, conservando credenciales, verificación y revisión anteriores.
- Los administradores existentes reciben su perfil administrativo.
- Permanecen los UUID, correos, contraseñas, cuentas deshabilitadas y referencias a rutas y actividades.
- Los JWT antiguos de turistas se admiten como `tourist` hasta su vencimiento. Tras cambiar de turista a guía, un nuevo login emite el rol actualizado; `/api/users/me` refleja inmediatamente el tipo actual.

`test/user-types.spec.ts` comprueba la migración sobre una base anterior, su repetición, los cuatro tipos, empresas y grupos, privacidad, permisos administrativos y rollback de registros incompletos. Las pruebas existentes también ejercitan las rutas con los nuevos turistas y el perfil de organización a través del gateway.
