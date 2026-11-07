# Torneos

Aplicación web para organizar torneos por **eliminación directa**: inscribes equipos con sus integrantes, haces el sorteo y vas registrando los resultados de cada partido (siempre 2 equipos frente a frente) etapa por etapa hasta la final y el campeón.

No necesita servidor, base de datos ni instalación: **todo se guarda en el navegador**.

## Funciones

- **Equipos con integrantes**: crea, edita y elimina equipos. Puedes pegar varios integrantes separados por comas. La app avisa si un nombre de equipo se repite o si una persona ya está en otro equipo.
- **Sorteo**: arma los cruces al azar con una pequeña animación. Si la cantidad de equipos no es potencia de 2 (por ejemplo, 6 o 10), algunos equipos reciben **pase directo** a la segunda etapa, repartidos por todo el cuadro para que nunca se crucen dos huecos.
- **Llaves por etapas**: Octavos, Cuartos de final, Semifinales y Final, según la cantidad de equipos. Cada partido se registra con su marcador. Si hay empate, eliges quién avanza (penales, muerte súbita, etc.).
- **Correcciones**: puedes corregir o borrar un resultado mientras el partido siguiente no se haya jugado.
- **Campeón**: pantalla final con el campeón, sus integrantes, el resultado de la final, el subcampeón y el camino al título.
- **Palmarés**: los campeones de torneos anteriores quedan guardados.
- **Datos**: exporta una copia (`.json` o texto para copiar), impórtala en otro navegador o borra todo.
- Funciona en el teléfono, con tema claro u oscuro según el sistema, y **sin conexión** una vez abierta.

## Cómo usarla

**Opción rápida:** abre `index.html` con doble clic en el navegador.

**Con el servidor incluido** (activa también el modo sin conexión). Solo necesita Node.js 18 o superior, sin dependencias:

```bash
npm start
```

Y abre <http://localhost:8080>. Para usar otro puerto: `PORT=3000 npm start`.

**Publicarla en Railway:** conecta el repositorio y listo. `railway.json` le indica a Railway que arranque `node server.js` directamente (sin pasar por npm), para que al redesplegar el servidor reciba la señal de parada y cierre ordenadamente. El servidor escucha en el puerto de la variable `PORT` (o en el 8080 si no existe), así que el dominio público debe apuntar a ese mismo puerto (8080 por defecto). Railway usa la versión LTS vigente de Node; no se fija ninguna versión en `package.json` a propósito, porque Railpack reduce un rango como `>=18` a exactamente Node 18.

**Publicarla en GitHub Pages:** en el repositorio, ve a *Settings → Pages*, elige la rama `main` y la carpeta raíz (`/`). La app quedará disponible en `https://<usuario>.github.io/torneos-/`.

## Dónde se guardan los datos

| Qué | Dónde | Para qué |
| --- | --- | --- |
| Equipos, llaves, resultados y palmarés | `localStorage` del navegador, clave `torneos:v1` | Se guardan solos tras cada cambio y siguen ahí al recargar o cerrar el navegador. |
| Archivos de la app (HTML, CSS, JS) | Caché del navegador mediante un *service worker* (`sw.js`) | Abrir la app sin conexión. Solo funciona servida por `http(s)://`, no al abrirla como archivo. |

Los datos son **de ese navegador en ese dispositivo**: si borras los datos del sitio o cambias de navegador, se pierden. Usa **Datos → Exportar copia** para respaldarlos o pasarlos a otro equipo. Si la app está abierta en dos pestañas, ambas se mantienen sincronizadas.

## Estructura

```
index.html            Estructura de la página
css/styles.css        Estilos (tema claro y oscuro, diseño adaptable)
js/tournament.js      Lógica del torneo sin interfaz: sorteo, llaves, resultados, validaciones
js/app.js             Interfaz, almacenamiento en localStorage y diálogos
server.js             Servidor estático en Node para `npm start` (Railway u otro hosting)
railway.json          Comando de arranque para Railway
sw.js                 Service worker para el modo sin conexión
manifest.webmanifest  Permite instalarla como app en el teléfono
tests/                Pruebas de la lógica del torneo
```

## Pruebas

Cubren la lógica del torneo y el servidor (tipos de archivo, archivos privados, rutas maliciosas, caché). Requieren Node.js 18 o superior; no hay dependencias que instalar.

```bash
npm test
```
