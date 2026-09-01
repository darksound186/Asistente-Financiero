# 📱 Mi Finanzas Personales (PWA)

Asistente y control financiero personal transformado en una **Progressive Web App (PWA)** instalable en dispositivos móviles (Android / iOS) y accesible desde PC.

---https://darksound186.github.io/Asistente-Financiero/

## 🚀 Características Principales

* **Control Financiero:** Gestión de gastos, ingresos, metas de ahorro y análisis quincenal/mensual.
* **Asistente Inteligente:** Chat con lógica de agente (`runAgent`), etapas de clarificación (`clarify`) y confirmación (`confirm`).
* **Sincronización:** Respaldo de información integrado con Google Sheets.
* **🤝 Módulo de Préstamos:** Registro y control de dinero prestado a terceros (estado 🟡 Pendiente / 🟢 Pagado) con historial y fechas de cobro.
* **Experiencia PWA Nativa:**
  * Navegación inferior (*Bottom Bar*) optimizada para teléfonos inteligentes.
  * Modo independiente (*standalone*) sin barra de navegación del explorador.
  * Soporte offline parcial para la interfaz estática.
  * Respeto de áreas seguras (*notch* y barras gestuales en iOS y Android).

---

## 🛠️ Estructura del Proyecto

```text
├── index.html            # Estructura principal, modales y vista PWA
├── styles.css            # Estilos UI responsive, bottom bar y adaptaciones móviles
├── app.js                # Lógica del frontend, módulo de préstamos y navegación
├── manifest.webmanifest  # Configuración e íconos para la instalación PWA
├── sw.js                 # Service Worker (Estrategia Network-First para APIs)
└── icons/                # Íconos de la aplicación (192x192, 512x512)
