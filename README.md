# Asistente Financiero

Aplicación financiera web local-first en JavaScript, HTML y CSS, preparada para uso instalable en Android. Los datos se almacenan en IndexedDB en el navegador; no hay cuentas, backend ni sincronización en nube.

**Aplicación en línea:** [Abrir Asistente Financiero](https://darksound186.github.io/Asistente-Financiero/)

## Funcionalidad

- Registro de gastos, ingresos, presupuestos, metas y préstamos.
- Respaldo JSON descargable y restauración local desde Ajustes.
- Migración automática y verificable desde `localStorage`; el estado legacy se conserva como respaldo.
- Modo offline para el shell de la aplicación y los datos ya guardados.
- Asistente Gemini opcional: requiere una clave propia ingresada en Ajustes para la sesión actual. La clave no se guarda. Al usarlo, la pregunta y totales agregados se envían a Google; no se incluyen nombres, notas ni detalle de movimientos.
- Cliente Android nativo experimental en `android/`: puede leer, con permiso especial del sistema, notificaciones de Nequi, Bancolombia, Nu y Google Wallet para pedir una descripción y registrar el gasto.

La aplicación no proporciona autenticación, sincronización entre dispositivos ni recuperación de una clave perdida. Una clave introducida en el navegador sigue siendo accesible para el código cliente y no equivale a un secreto protegido por servidor.

## Archivos

```text
index.html                 Estructura, manifest y navegación
app.js                     Interfaz, finanzas, validaciones y asistente opcional
migration.js               Conversión pura de datos legacy y fechas
storage.js                 IndexedDB, migración, persistencia y respaldos
styles.css                 Diseño responsive y accesibilidad visual
manifest.webmanifest       Identidad y recursos de instalación PWA
sw.js                      Caché local limitada al ámbito de esta app
icons/                     Iconos PWA PNG
tests/migration.test.js    Pruebas sin dependencias de la conversión legacy
tests/storage.test.html    Prueba de navegador para IndexedDB y respaldos
android/                  Proyecto nativo Android con lector local de notificaciones
```

## Desarrollo y comprobaciones

Abrir `index.html` directamente como archivo no permite probar Service Worker ni todas las funciones de PWA. Servir el directorio desde un origen HTTPS o `localhost`. No se necesita un paso de compilación.

Ejecutar pruebas de conversión con Node.js:

```powershell
node --test tests/*.test.js
```

Para validar IndexedDB, servir el proyecto y abrir `tests/storage.test.html` en un perfil de navegador de prueba. El resultado debe mostrar `PASS`.

### Detección de compras en Android

La PWA instalada desde Chrome no puede leer notificaciones de otras apps. Antes de probar el APK, despliega también la versión actualizada de la interfaz web: Android la carga desde GitHub Pages. Instala Android SDK 35, JDK 17 y Gradle 8.7 o posterior; desde `android/`, genera el wrapper con `gradle wrapper --gradle-version 8.7` y compila con `.\gradlew.bat assembleDebug`. Al abrir el APK en un teléfono Android, concede el permiso de notificaciones y activa **Billetera: detectar compras** en el acceso especial del sistema. Marca solo los emisores que quieras vigilar.

La lectura y el filtrado se hacen en el dispositivo. Solo se muestra el aviso cuando la app coincide con uno de esos servicios y el texto parece una compra con un monto reconocible; los formatos varían y algunas transacciones pueden no detectarse. Revisa cada importe antes de usarlo como registro definitivo. La app carga la interfaz desde GitHub Pages, pero el monto y la descripción se transfieren a la página en memoria local, no en la URL.

El almacenamiento de Android WebView está separado del Chrome normal. Si ya tienes datos en la PWA, exporta un respaldo desde Ajustes y luego impórtalo en Billetera Android.

## Instalación Android

Desplegar por HTTPS. Confirmar que `manifest.webmanifest`, los iconos y `sw.js` responden desde la ruta del proyecto, luego probar la opción de instalación y el inicio standalone en Chrome Android. La disponibilidad de la opción depende también de la versión y políticas del navegador.
