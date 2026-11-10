# Verificación local de proveedores

## Package IDs permitidos

Los IDs se contrastaron con las fichas públicas de Google Play; identifican una ficha, no prueban quién firmó el APK instalado.

| App | Package ID | Ficha oficial |
|---|---|---|
| Nequi | `com.nequi.MobileApp` | [Google Play](https://play.google.com/store/apps/details?id=com.nequi.MobileApp) |
| Mi Bancolombia | `co.com.bancolombia.personas.superapp` | [Google Play](https://play.google.com/store/apps/details?id=co.com.bancolombia.personas.superapp) |
| Nu Colombia | `com.nu.production` | [Google Play](https://play.google.com/store/apps/details?id=com.nu.production) |
| Google Wallet | `com.google.android.apps.walletnfcrel` | [Google Play](https://play.google.com/store/apps/details?id=com.google.android.apps.walletnfcrel) |

## Fingerprints

Las fichas públicas no publican fingerprints SHA-256 de los certificados de firma. No se inventan ni se obtienen de mirrors de APK. `ExpenseSources.OFFICIAL_SHA256_CERTIFICATES` permanece vacío deliberadamente: todos los emisores quedan **sin verificar**, se presentan como posibles orígenes y su operación se propone como desconocida para revisión explícita. No se tratan como compras confiables por su package ID solamente. La revisión manual sigue disponible; al aceptar el usuario un gasto, su etiqueta indica que la firma no fue verificada.

Para habilitar verificación oficial, el responsable de cada app debe obtener el SHA-256 del **App signing key certificate** en Google Play Console: seleccionar la app y abrir **Setup > App integrity > App signing key certificate**. No usar el fingerprint del *upload key*: Play App Signing vuelve a firmar los APK distribuidos con la clave de firma de la app. Incorporar únicamente el valor entregado por el titular en `OFFICIAL_SHA256_CERTIFICATES` bajo el package ID exacto; ante rotación, confirmar con el titular qué certificados forman parte de la historia de firma autorizada. El código consulta varios fingerprints permitidos por paquete para soportar una rotación autorizada.

Android 9 / API 28 y posterior usa `PackageManager.hasSigningCertificate(..., CERT_INPUT_SHA256)`, que consulta certificados de firma autorizados. Para el mínimo soportado (API 26–27), la implementación compara SHA-256 de `PackageInfo.signatures` obtenido con `GET_SIGNATURES`, API heredada. `AndroidManifest.xml` declara solo los cuatro packages en `<queries>` para que `PackageManager` pueda consultarlos en Android 11+. Si no hay fingerprint configurado o la consulta falla, la validación falla cerrada y el usuario revisa el movimiento manualmente.

Referencias oficiales:

- [Play App Signing: certificado de firma y certificados de carga](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
- [Android app signing](https://developer.android.com/studio/publish/app-signing)
- [PackageManager.hasSigningCertificate](https://developer.android.com/reference/android/content/pm/PackageManager#hasSigningCertificate(java.lang.String,byte[],int))
- [Package visibility](https://developer.android.com/training/package-visibility)
