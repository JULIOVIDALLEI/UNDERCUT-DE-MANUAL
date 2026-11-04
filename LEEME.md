# UND · Undercut de manual

App para el móvil (Samsung S26 Ultra / cualquier Android) con calendario, horarios en tu hora local, resultados y clasificaciones de **F1, MotoGP, WorldSBK, IndyCar, NASCAR Cup, WEC, IMSA y WRC**.

- Se instala como app desde Chrome (icono propio, pantalla completa, sin barra del navegador).
- Los datos se actualizan solos **cada 5 minutos** con GitHub Actions (gratis; es el mínimo que permite GitHub) y la app comprueba si hay novedades **cada minuto** mientras está abierta.
- **Tiempo:** cada día (se refresca cada 3 h) se busca automáticamente la previsión (Open-Meteo) de todas las sesiones de los próximos 6 días, en el circuito y a la hora de cada sesión. Para sesiones más lejanas se indica desde qué día habrá previsión.
- **Modo fin de semana:** pantalla con todas las sesiones del finde (MotoGP con Moto2 y Moto3), tiempo, canal, cuenta atrás y podios.
- **MotoGP, Moto2 y Moto3:** calendario, resultados y mundial de cada categoría.
- **Avisos 15 min antes** (app gratuita ntfy): se activan en ⚙ Ajustes, eligiendo series y tipo de sesión.
- **Dónde verlo:** debajo de cada sesión sale el canal oficial en España (DAZN, Movistar Plus+, Telecinco gratis…). Se edita en `data/tv.json`.
- Funciona sin conexión con los últimos datos descargados.
- Botón 📅 en cada sesión para añadirla al calendario del móvil, con aviso 30 min antes.
- **Calendarios nuevos automáticos:** en cuanto un campeonato publica el calendario del año siguiente, aparece en la app (aviso "Calendario 2027 publicado" y selector de temporada).
- **Horarios automáticos:** cuando se confirma o cambia la hora de una sesión, la app la actualiza y la marca con "Cambio de hora" / "Hora confirmada" durante 7 días.

- **Noticias:** titulares recientes (últimos 5 días) de Motorsport.com, Marca, AS, Autosport y Formula1.com, ordenados por relevancia: lo más reciente, lo que cuentan varios medios a la vez y temas clave (victorias, fichajes, sanciones, lesiones, calendario). Al tocar una noticia se abre en su medio. En Ajustes puedes quitar los medios en inglés.

- **Pilotos:** se muestran solo con su nombre (sin fotos).

## Cuenta de propietario (usuario y contraseña)

La app es libre para todos. En ⚙ Ajustes → **Propietario** el dueño puede identificarse con su usuario y contraseña (aparece 👑 Propietario en la cabecera). Las cuentas las gestiona **Supabase** (gratis): la contraseña nunca está en el código y la recuperación se hace por correo.
1. supabase.com → **New project** (nombre `und`, región Europa).
2. **Project Settings → API**: copia *Project URL* y la clave *anon / publishable* y pégalas en `config.js`.
3. **Authentication → URL Configuration**: *Site URL* = la dirección de tu app (y añádela también en *Redirect URLs*).
4. Abre la app → *Primera vez: registrar propietario* → confirma desde el correo.
5. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up* para que nadie más pueda registrarse.

## Calendario del móvil que se actualiza solo

En la app: ⚙ Ajustes → *Calendario del móvil* → botón **Google** de la serie que quieras (o *Todas las series*).
Se abre Google Calendar y pulsas *Añadir*. A partir de ahí las carreras salen en el calendario del Samsung (si tienes tu cuenta de Google sincronizada) y Google lo actualiza solo con los nuevos calendarios y cambios de hora (Google refresca las suscripciones cada pocas horas).
Si la app de Google Calendar del móvil no ofrece añadir por URL, hazlo desde el PC en calendar.google.com → *Otros calendarios* → *+* → *Desde URL* y pega el enlace (botón copiar de la app).

## Puesta en marcha (unos 10 minutos, una sola vez)

1. En GitHub crea un repositorio **público** nuevo, por ejemplo `pitwall`.
2. Pulsa **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta (incluida la carpeta `.github`). Pulsa *Commit changes*.
   - La carpeta `.github` empieza por punto y algunos ordenadores la ocultan. Si no se sube, créala a mano: *Add file → Create new file*, nombre `.github/workflows/update-data.yml` y pega su contenido.
3. **Settings → Actions → General → Workflow permissions** → marca *Read and write permissions* → Save.
4. **Settings → Pages** → Source: **GitHub Actions**.
5. **Actions → Actualizar datos → Run workflow** para descargar los datos por primera vez (tarda 2-4 minutos la primera vez).
6. En el móvil abre `https://TU-USUARIO.github.io/pitwall/` en Chrome → menú ⋮ → **Añadir a pantalla de inicio → Instalar**.

## Fuentes de datos

| Serie | Fuente principal | Clasificación |
|---|---|---|
| F1 | Jolpica F1 API | Oficial (pilotos y constructores) |
| MotoGP | API de MotoGP.com | Oficial (pilotos); equipos = suma de pilotos |
| NASCAR Cup | Feed de NASCAR.com | Feed oficial de puntos o suma por carrera |
| IndyCar, WRC, WorldSBK | TheSportsDB | Estimada con la tabla de puntos oficial (sin bonus) |
| WEC, IMSA | TheSportsDB | Solo resultados por carrera (son multiclase) |

Si la fuente principal falla, la serie usa TheSportsDB como respaldo, y si todo falla se mantienen los últimos datos buenos.

**Mejorar IndyCar / WRC / WEC / IMSA / SBK:** la clave gratuita de TheSportsDB (`123`) es compartida y limitada. Con la clave Premium (unos 9 $/mes) los datos son más completos: en el repositorio, *Settings → Secrets and variables → Actions → New repository secret*, nombre `TSDB_KEY`, valor tu clave.

## Instalador directo para Android (APK)

1. Crea el archivo `.github/workflows/build-apk.yml` (copia el de esta carpeta).
2. **Actions → Crear instalador APK → Run workflow** (tarda unos 5 minutos).
3. El instalador queda en `https://github.com/USUARIO/REPO/releases/latest/download/UND.apk` y la app tiene un botón para descargarlo (⚙ Ajustes → App para Android).

La app de Android abre la web de UND por dentro, así que se actualiza sola: solo hay que volver a generar el APK si cambias el icono o el nombre.

## Convertirla en APK (opcional, otra vía)

Si quieres un archivo .apk o publicarla en Google Play: entra en https://www.pwabuilder.com, pega la URL de tu app y elige *Android*. Genera el paquete a partir de esta misma web.

## Archivos

- `index.html` — la app (HTML/CSS/JS sin dependencias)
- `sw.js`, `manifest.webmanifest`, `icons/` — instalación y modo sin conexión
- `scripts/update.mjs` — descarga y unifica los datos (Node 20, sin dependencias)
- `.github/workflows/update-data.yml` — lo ejecuta cada 30 min
- `data/data.json`, `data/news.json`, `data/cal/*.ics` — datos, noticias y calendarios (los rellena el workflow)
