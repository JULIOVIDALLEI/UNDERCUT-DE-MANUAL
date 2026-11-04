# UND · Undercut de manual

App para el móvil (Samsung S26 Ultra / cualquier Android) con calendario, horarios en tu hora local, resultados y clasificaciones de **F1, MotoGP, WorldSBK, IndyCar, NASCAR Cup, WEC, IMSA y WRC**.

- Se instala como app desde Chrome (icono propio, pantalla completa, sin barra del navegador).
- Los datos se actualizan solos **cada 30 minutos** con GitHub Actions (gratis), y la app se refresca sola cada 5 min mientras está abierta.
- Funciona sin conexión con los últimos datos descargados.
- Botón 📅 en cada sesión para añadirla al calendario del móvil, con aviso 30 min antes.
- **Calendarios nuevos automáticos:** en cuanto un campeonato publica el calendario del año siguiente, aparece en la app (aviso "Calendario 2027 publicado" y selector de temporada).
- **Horarios automáticos:** cuando se confirma o cambia la hora de una sesión, la app la actualiza y la marca con "Cambio de hora" / "Hora confirmada" durante 7 días.

- **Noticias:** titulares recientes (últimos 5 días) de Motorsport.com, Marca, AS, Autosport y Formula1.com, ordenados por relevancia: lo más reciente, lo que cuentan varios medios a la vez y temas clave (victorias, fichajes, sanciones, lesiones, calendario). Al tocar una noticia se abre en su medio. En Ajustes puedes quitar los medios en inglés.

- **Fotos de los pilotos** en resultados, podio, clasificación y últimos ganadores. F1: fotos oficiales (OpenF1). MotoGP: web oficial. Resto: TheSportsDB o Wikipedia. Se buscan una vez y se guardan en `data/faces.json`; las primeras actualizaciones van rellenándolas (unas 90 por pasada). Si un piloto no tiene foto se muestran sus iniciales.

## Calendario del móvil que se actualiza solo

En la app: ⚙ Ajustes → *Calendario del móvil* → botón **Google** de la serie que quieras (o *Todas las series*).
Se abre Google Calendar y pulsas *Añadir*. A partir de ahí las carreras salen en el calendario del Samsung (si tienes tu cuenta de Google sincronizada) y Google lo actualiza solo con los nuevos calendarios y cambios de hora (Google refresca las suscripciones cada pocas horas).
Si la app de Google Calendar del móvil no ofrece añadir por URL, hazlo desde el PC en calendar.google.com → *Otros calendarios* → *+* → *Desde URL* y pega el enlace (botón copiar de la app).

## Puesta en marcha (unos 10 minutos, una sola vez)

1. En GitHub crea un repositorio **público** nuevo, por ejemplo `pitwall`.
2. Pulsa **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta (incluida la carpeta `.github`). Pulsa *Commit changes*.
   - La carpeta `.github` empieza por punto y algunos ordenadores la ocultan. Si no se sube, créala a mano: *Add file → Create new file*, nombre `.github/workflows/update-data.yml` y pega su contenido.
3. **Settings → Actions → General → Workflow permissions** → marca *Read and write permissions* → Save.
4. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, carpeta `/ (root)` → Save.
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

## Convertirla en APK (opcional)

Si quieres un archivo .apk o publicarla en Google Play: entra en https://www.pwabuilder.com, pega la URL de tu app y elige *Android*. Genera el paquete a partir de esta misma web.

## Archivos

- `index.html` — la app (HTML/CSS/JS sin dependencias)
- `sw.js`, `manifest.webmanifest`, `icons/` — instalación y modo sin conexión
- `scripts/update.mjs` — descarga y unifica los datos (Node 20, sin dependencias)
- `.github/workflows/update-data.yml` — lo ejecuta cada 30 min
- `data/data.json`, `data/news.json`, `data/faces.json`, `data/cal/*.ics` — datos, noticias y calendarios (los rellena el workflow)
