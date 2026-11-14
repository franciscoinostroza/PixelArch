# Checklist legal 004 — Portal de propuestas

**Estado:** plantilla para completar y firmar. **No es asesoramiento legal.**
**Última actualización:** 2026-11-13
**Alcance:** prospección B2B por email con Resend, portal interno `/propuestas`, baja pública y ARCO.
**Documento operativo relacionado:** `runbook.md`.

> **Gate:** mientras este checklist no esté completo y firmado, `PROPUESTAS_ENVIO_HABILITADO=false`. El portal puede buscar, analizar, puntuar y redactar en seco, pero no enviar. La aprobación exige secreto, URL pública, from/reply-to, texto legal y base legal; no exige `RESEND_API_KEY` ni el gate, y no envía. La firma se obtiene **antes de iniciar T-27** (después de T-26 PASS); el smoke en seco de producción no reemplaza la firma. No completar con placeholders (`[COMPLETAR]`, `[VERIFICAR]`) ni firmar “a futuro”.

> **Cómo usar este documento:** el dueño y el abogado completan cada sección, adjuntan evidencia y firman. El texto legal literal **no se transcribe acá**: se aprueba en un anexo firmado y se carga en `PROPUESTAS_TEXTO_LEGAL`. No inventar números de inscripción, plazos legales ni textos de ley.

---

## 0. Control de versión y firmas

| Campo | Valor |
|-------|-------|
| Versión del checklist | `[COMPLETAR]` |
| Fecha de revisión | `[COMPLETAR]` |
| Dueño / responsable | `[COMPLETAR]` |
| Abogado / revisión legal | `[COMPLETAR]` |
| Normativa invocada | Ley 25.326; Disposición DNPDP 4/2009; Decreto 1558/01 (referencias a validar por el abogado) |
| Anexo de texto legal | `[COMPLETAR: referencia al documento firmado]` |
| Hash del texto aprobado (opcional) | `[COMPLETAR: SHA-256 del texto exacto cargado en PROPUESTAS_TEXTO_LEGAL]` |

| Rol | Nombre | Firma | Fecha |
|-----|--------|-------|-------|
| Dueño | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Abogado | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |

Si cambia el texto legal, la base legal o el alcance, se crea una nueva versión y se vuelve a firmar.

---

## 1. Regla de habilitación

- [ ] `PROPUESTAS_ENVIO_HABILITADO=false` hasta que **todas** las secciones obligatorias estén completas y firmadas.
- [ ] Se entiende que la aprobación de un borrador no envía; el envío requiere el gate y la segunda confirmación.
- [ ] El dueño autorizó explícitamente el primer envío real (T-27).
- [ ] T-26 (staging) PASS con evidencia.
- [ ] `PROPUESTAS_TEXTO_LEGAL` y `PROPUESTAS_BASE_LEGAL` cargados con el contenido aprobado, sin placeholders.
- [ ] SPF/DKIM/DMARC verificados y dominio verificado en Resend.
- [ ] Decisión sobre AAIP/inscripción documentada.
- [ ] Transferencia internacional documentada.
- [ ] Baja visible y one-click probados; supresión verificada.
- [ ] Retención (12 meses), supresión permanente y logs (30 días) verificados.

> Si falta un solo ítem obligatorio: **no habilitar**. No usar un texto de prueba en producción.

---

## 2. Texto legal literal aprobado (`PROPUESTAS_TEXTO_LEGAL`)

### 2.1 Regla

- El texto literal aprobado se guarda en un **anexo firmado** y se carga en `PROPUESTAS_TEXTO_LEGAL`.
- No se escribe en el repositorio ni en este checklist.
- Máximo operativo: 20.000 caracteres. Si se excede, la configuración lo rechaza y el envío falla cerrado.
- No se aceptan placeholders, textos incompletos ni “borradores” en producción.
- El texto debe estar aprobado para el canal email, el tipo de mensaje y el público B2B.

### 2.2 Contenido mínimo a validar

| Elemento | Qué debe contener / verificarse | Estado |
|----------|----------------------------------|--------|
| Identificación | Nombre legal de PixelArch, CUIT/identificación y datos de contacto que el abogado considere exigibles. | `[COMPLETAR]` |
| Finalidad | Propuesta de servicios de diseño y desarrollo web; motivo del contacto. | `[COMPLETAR]` |
| Fuente de los datos | Sitio web del negocio o URL de carga manual; fecha. | `[COMPLETAR]` |
| Canal ARCO | `hola@pixelarch.dev` visible y operativo para acceso, rectificación y supresión. | `[COMPLETAR]` |
| Transcripción legal | Transcripción de la Ley 25.326 art. 27 inc. 3 y del Decreto 1558/01 Anexo I art. 27, párrafo tercero, según la interpretación aprobada. **No transcribir acá; adjuntar anexo firmado.** | `[COMPLETAR]` |
| «Publicidad» | Ubicación y redacción exacta del término «publicidad»; validar asunto y cuerpo. | `[COMPLETAR]` |
| Enlace de baja | Enlace visible y operativo, sin login. | `[COMPLETAR]` |
| Aviso de privacidad | Remisión al aviso/Política de Privacidad si el abogado lo exige. | `[COMPLETAR]` |
| Texto plano | Versión texto equivalente, sin HTML ni tracking. | `[COMPLETAR]` |

### 2.3 Verificación de carga

- [ ] El texto cargado coincide exactamente con el anexo firmado (comparar hash/fecha).
- [ ] No tiene placeholders ni datos de prueba.
- [ ] Se renderiza correctamente en HTML y texto.
- [ ] El footer incluye identificación, finalidad, fuente, canal ARCO, texto legal, «publicidad» cuando corresponde y baja.
- [ ] El asunto no tiene `Re:`/`Fwd:` falsos ni saltos de línea.
- [ ] No hay claims, métricas inventadas, garantías absolutas ni presión desmedida.
- [ ] No hay píxeles de tracking, adjuntos ni enlaces de tracking personalizados.
- [ ] Se revisó una muestra real (staging o dirección propia) antes de producción.

---

## 3. Base legal (`PROPUESTAS_BASE_LEGAL`)

- [ ] El abogado definió la base legal aplicable al contacto B2B en frío y al envío de publicidad directa.
- [ ] **No se asume** que “dato público” equivale a consentimiento.
- [ ] La base legal quedó documentada por campaña/prospecto (`Prospecto.baseLegal`/`notaLegal`) y/o en `PROPUESTAS_BASE_LEGAL`.
- [ ] Se definió si el mensaje es publicidad directa no solicitada y qué tratamiento corresponde.
- [ ] Se definió si hace falta opt-in, opt-out o algún requisito adicional para determinados destinatarios.
- [ ] Se documentó la fuente de cada dato y la fecha.

| Campo | Valor |
|-------|-------|
| Base legal aprobada | `[COMPLETAR: texto breve de la base, sin inventar]` |
| Alcance | `[COMPLETAR: campañas/prospectos/países]` |
| Aprobado por | `[COMPLETAR]` |
| Fecha | `[COMPLETAR]` |
| Evidencia | `[COMPLETAR: documento/acta]` |

> Si el abogado concluye que no se puede contactar en frío con esta base, el portal no se habilita para envío.

---

## 4. Identificación, finalidad, fuente, ARCO, «publicidad» y baja

### 4.1 Remitente y respuesta

| Elemento | Valor | Estado |
|----------|-------|--------|
| From | `PixelArch <propuestas@pixelarch.dev>` | `[VERIFICAR]` |
| Reply-To | `hola@pixelarch.dev` | `[VERIFICAR]` |
| Nombre visible | `PixelArch` | `[VERIFICAR]` |
| Canal ARCO | `hola@pixelarch.dev` | `[VERIFICAR]` |
| Dominio | `pixelarch.dev` verificado en Resend | `[VERIFICAR]` |

- [ ] El buzón `hola@pixelarch.dev` está atendido y tiene un procedimiento de respuesta.
- [ ] El remitente no es `onboarding@resend.dev` ni una dirección inventada.
- [ ] El reply-to no es un buzón abandonado.

### 4.2 Contenido del email

- [ ] Identifica a PixelArch y el servicio.
- [ ] Explica el motivo del contacto.
- [ ] Indica la fuente de los datos (sitio web o URL de carga) y la fecha.
- [ ] Incluye el canal ARCO visible.
- [ ] Incluye el texto legal aprobado.
- [ ] Incluye «publicidad» cuando corresponde, en la ubicación aprobada.
- [ ] Incluye enlace visible de baja.
- [ ] Incluye versión texto plano.
- [ ] No incluye datos sensibles, PII innecesaria ni datos de terceros.
- [ ] No incluye afirmaciones no verificadas ni métricas inventadas.
- [ ] No incluye adjuntos, píxeles ni tracking.

### 4.3 «Publicidad»

- [ ] El abogado aprobó la ubicación exacta (asunto y/o cuerpo) y la redacción.
- [ ] `PROPUESTAS_ETIQUETA_PUBLICIDAD=true` si corresponde por la interpretación aprobada.
- [ ] El asunto no duplica el prefijo si ya está presente.
- [ ] El aviso de publicidad directa no solicitada está aprobado y visible.

### 4.4 Enlace de baja y RFC 8058

- [ ] Enlace visible: `https://pixelarch.dev/propuestas/baja/<token>`.
- [ ] Página pública sin login, `noindex`, `no-store`, `Referrer-Policy: no-referrer`.
- [ ] Token opaco, sin email/nombre; no se loguea.
- [ ] POST one-click: `https://pixelarch.dev/api/opt-out?token=<token>`.
- [ ] Header `List-Unsubscribe` presente.
- [ ] Header `List-Unsubscribe-Post: List-Unsubscribe=One-Click` presente.
- [ ] POST responde 200/202 genérico, idempotente y sin enumeración.
- [ ] La baja crea supresión global por email y cancela pendientes.
- [ ] Se probó con un cliente de correo real (Gmail/Outlook) y con `curl`.
- [ ] Se evaluó el requisito de baja sin JavaScript; la página actual requiere JS para confirmar (deuda T-19).

Encabezados esperados (token ficticio, no usar uno real en la evidencia):

```text
List-Unsubscribe: <https://pixelarch.dev/api/opt-out?token=<token>>, <mailto:hola@pixelarch.dev?subject=Baja>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

> Si el abogado exige baja sin JS, implementar un formulario POST de fallback antes de habilitar.

---

## 5. SPF, DKIM, DMARC y dominio en Resend

### 5.1 Verificación técnica

| Control | Valor / evidencia | Estado |
|---------|-------------------|--------|
| Dominio verificado en Resend | `pixelarch.dev` | `[VERIFICAR]` |
| SPF | Registro con inclusión de Resend; sin múltiples SPF; dentro de límites | `[VERIFICAR]` |
| DKIM | Selector de Resend verificado | `[VERIFICAR]` |
| DMARC | Política `p=` aprobada por el dueño; alineación; reporte `rua` si aplica | `[VERIFICAR]` |
| Return-Path / bounce | Configurado por Resend | `[VERIFICAR]` |
| From | `propuestas@pixelarch.dev` | `[VERIFICAR]` |
| Reply-To | `hola@pixelarch.dev` | `[VERIFICAR]` |

- [ ] Envío de prueba a Gmail y Outlook; autenticación PASS (SPF, DKIM, DMARC).
- [ ] Encabezados originales revisados; no hay `onboarding@resend.dev`.
- [ ] El mensaje no cae en spam de forma consistente.
- [ ] Enlaces de baja y texto legal se ven correctamente.
- [ ] Se revisó la reputación del dominio/IP antes del primer envío masivo (aunque v1 sea de bajo volumen).
- [ ] `RESEND_API_KEY` es server-only y no está en el repositorio.

### 5.2 Evidencia

Adjuntar capturas o extractos de:

- estado del dominio en Resend;
- registros DNS (SPF/DKIM/DMARC);
- encabezados de un email de prueba;
- resultado de la baja one-click.

No adjuntar API keys ni tokens reales.

---

## 6. AAIP / inscripción y transferencia internacional

### 6.1 AAIP / registro de base

El abogado determina si corresponde inscribir o actualizar una base de datos ante la AAIP. **No inventar número de inscripción ni afirmar que no corresponde sin análisis.**

| Pregunta | Respuesta | Evidencia |
|----------|-----------|-----------|
| ¿Corresponde inscripción/actualización? | `[COMPLETAR: sí/no/a definir]` | `[COMPLETAR]` |
| Número de inscripción (si existe) | `[COMPLETAR]` | `[COMPLETAR]` |
| Fecha de trámite | `[COMPLETAR]` | `[COMPLETAR]` |
| Responsable | `[COMPLETAR]` | `[COMPLETAR]` |

- [ ] Si corresponde, el trámite está resuelto **antes** del primer envío real.
- [ ] Si no corresponde, quedó registrada la justificación legal.
- [ ] Se identificó el responsable de la base y el domicilio aplicable.

### 6.2 Transferencia internacional

Google, Resend, Railway y un futuro LLM pueden procesar datos fuera de Argentina. Verificar país/región, contrato/DPA y si hace falta aviso o base legal adicional. **No asumir países ni mecanismos.**

| Proveedor | Finalidad | Datos | País/región | Mecanismo/DPA | Estado |
|-----------|-----------|-------|-------------|----------------|--------|
| Google Places | Búsqueda de negocios | Consulta, `place_id`; sin persistir nombre/address/rating | `[VERIFICAR]` | `[VERIFICAR]` | `[COMPLETAR]` |
| Resend | Envío de email | Email profesional, asunto, cuerpo, message ID | `[VERIFICAR]` | `[VERIFICAR]` | `[COMPLETAR]` |
| Railway | Hosting/BD | Datos del portal; sin secretos en reposo fuera de la plataforma | `[VERIFICAR]` | `[VERIFICAR]` | `[COMPLETAR]` |
| Sentry (opcional) | Errores/tracing | IDs, estados; sin PII si la redacción funciona | `[VERIFICAR]` | `[VERIFICAR]` | `[COMPLETAR]` |
| LLM futuro | Redacción (no v1) | Datos del negocio/auditoría; sin CRM | `[VERIFICAR]` | `[VERIFICAR]` | `[COMPLETAR]` |

- [ ] Se documentó la transferencia en el aviso de privacidad o en el documento que el abogado indique.
- [ ] Se aceptaron los términos/DPA de los proveedores aplicables.
- [ ] Si el LLM se habilita en el futuro, se hace con una spec/revisión legal propia; v1 no lo usa.

---

## 7. B2B, minimización, datos sensibles y listas

- [ ] Solo se contacta a organizaciones/contactos profesionales B2B.
- [ ] Se excluyen consumidores, menores y uso personal.
- [ ] No se guardan datos sensibles: salud, ideología, religión, sindicato, vida sexual, origen racial/étnico, biometría ni equivalentes.
- [ ] No se compran listas ni se usan bases de terceros sin verificar origen y base legal.
- [ ] No se adivinan emails por patrón (`nombre@dominio`).
- [ ] No se usan data brokers, directorios, formularios de contacto ni redes sociales como fuente.
- [ ] No se scrapea Google Maps, la SERP, LinkedIn ni otras redes.
- [ ] Se respetan robots.txt, términos del sitio y límites de acceso; no se saltan login/paywall/CAPTCHA.
- [ ] Solo se persiste `place_id` de Google Places; el resto del contenido es transitorio y no se guarda fuera de los términos.
- [ ] Cada dato relevante tiene fuente, URL y fecha.
- [ ] Un prospecto tiene un contacto principal; no se cargan múltiples contactos en v1.
- [ ] No se copian datos del CRM (`Cliente`, `Pago`, etc.).
- [ ] Las notas internas no contienen PII innecesaria ni datos sensibles.
- [ ] No se usan testimonios, empleados ni terceros que aparezcan en la web como contacto del negocio.

---

## 8. Retención, supresión y logs

| Dato | Plazo | Regla | Evidencia |
|------|-------|-------|-----------|
| Prospecto | 12 meses desde la última interacción | Purga cron/manual; borra borradores/envíos; conserva supresión | `[VERIFICAR]` |
| Borradores/envíos | Con el prospecto | Cascada; no retención indefinida | `[VERIFICAR]` |
| Supresión | Permanente | No se borra por retención ni por borrar el prospecto; revocación solo excepción con motivo | `[VERIFICAR]` |
| Logs técnicos | 30 días | Retención Railway; sin PII; no es evidencia legal | `[VERIFICAR]` |
| Evidencia de aprobaciones/envíos | Mientras viva el prospecto | Base de datos; no logs | `[VERIFICAR]` |

- [ ] La retención de 12 meses está configurada (`PROPUESTAS_RETENCION_MESES=12` o el valor aprobado).
- [ ] La purga conserva la supresión; se probó en staging.
- [ ] La eliminación ARCO crea supresión `SOLICITUD_ARCO` si hay email y conserva la supresión.
- [ ] Sin email, la eliminación ARCO solo deja un log sanitizado; se registró la limitación de evidencia durable.
- [ ] Los logs no contienen email completo, nombre, teléfono, cuerpo, HTML, token de baja ni secretos.
- [ ] Sentry tiene redacción de `/propuestas/baja/<token>` y `?token=`.
- [ ] No se prometieron plazos legales distintos a los aprobados por el abogado.

---

## 9. Procedimiento de baja y ARCO

- [ ] La baja pública no requiere login, no revela si el email existía y es idempotente.
- [ ] La baja por enlace y la baja por respuesta al correo están documentadas.
- [ ] El admin registra bajas por respuesta y quejas/rebotes manuales.
- [ ] El canal ARCO (`hola@pixelarch.dev`) está monitoreado.
- [ ] Existe un registro de solicitudes: fecha, tipo, prospecto, acción, responsable, evidencia.
- [ ] Exportar/rectificar/eliminar se probó en staging.
- [ ] La supresión no se elimina para “limpiar” datos.
- [ ] La revocación de supresión es una excepción con motivo y registro, no un flujo normal.
- [ ] Se evaluó la baja sin JavaScript (deuda T-19) y el abogado aceptó el mecanismo o se implementó el fallback.

---

## 10. Checklist final y firma

### 10.1 Obligatorio antes de habilitar

- [ ] Texto legal aprobado, cargado y verificado.
- [ ] Base legal aprobada y documentada.
- [ ] Identificación, finalidad, fuente, ARCO y «publicidad» aprobados.
- [ ] Enlace visible y headers RFC 8058 probados.
- [ ] SPF/DKIM/DMARC PASS; dominio verificado en Resend.
- [ ] AAIP/inscripción resuelta o justificada.
- [ ] Transferencia internacional documentada.
- [ ] B2B, datos sensibles y listas revisados.
- [ ] Retención 12 meses, supresión permanente y logs 30 días verificados.
- [ ] T-26 PASS; T-27 autorizado por el dueño.
- [ ] Rollback probado (`PROPUESTAS_ENVIO_HABILITADO=false`).

### 10.2 Firma

| Rol | Nombre | Firma | Fecha |
|-----|--------|-------|-------|
| Dueño | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Abogado | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |

> Sin esta firma y sin todos los ítems obligatorios, `PROPUESTAS_ENVIO_HABILITADO=false`. La firma no reemplaza el gate técnico ni el T-26.

---

## 11. Preguntas abiertas

Marcar y resolver con el abogado/dueño. No inventar respuestas.

| ID | Pregunta | Responsable | Estado |
|----|----------|-------------|--------|
| QL-1 | ¿Cuál es el texto legal literal exacto y la transcripción aprobada de la Ley 25.326 art. 27 inc. 3 y del Decreto 1558/01? | Abogado | `[ABIERTA]` |
| QL-2 | ¿Dónde debe ir «publicidad» (asunto, cuerpo o ambos) y con qué redacción? | Abogado | `[ABIERTA]` |
| QL-3 | ¿Cuál es la base legal para el contacto B2B en frío y para la publicidad directa no solicitada? ¿Hace falta opt-in? | Abogado | `[ABIERTA]` |
| QL-4 | ¿Corresponde inscribir/actualizar la base ante la AAIP? ¿Con qué número y fecha? | Abogado/dueño | `[ABIERTA]` |
| QL-5 | ¿Qué mecanismo/aviso corresponde por transferencia internacional a Google, Resend, Railway y un futuro LLM? | Abogado | `[ABIERTA]` |
| QL-6 | ¿Hay que actualizar `/privacidad` u otra página legal? ¿Con qué texto? | Abogado/dueño | `[ABIERTA]` |
| QL-7 | ¿Qué plazo/procedimiento de respuesta ARCO se promete? | Abogado | `[ABIERTA]` |
| QL-8 | ¿Resend tiene DPA/subprocesadores aceptables? ¿Hay que firmar algo? | Dueño/abogado | `[ABIERTA]` |
| QL-9 | ¿Los términos de Google Places permiten el uso y la atribución previstos? | Abogado/dueño | `[ABIERTA]` |
| QL-10 | Si se habilita un LLM futuro, ¿qué proveedor, datos y transferencia se aprueban? | Abogado/dueño | `[ABIERTA]` |
| QL-11 | ¿Se prospectarán países fuera de Argentina? ¿Qué reglas locales aplican? | Abogado | `[ABIERTA]` |
| QL-12 | ¿La supresión por dominio de negocio es admisible en todos los casos? | Abogado | `[ABIERTA]` |
| QL-13 | ¿Se exige baja sin JavaScript? Si sí, ¿se implementa fallback? | Abogado/dueño | `[ABIERTA]` |
| QL-14 | ¿Quién monitorea `hola@pixelarch.dev` y con qué registro? | Dueño | `[ABIERTA]` |

---

## 12. Anexo de evidencia

| Evidencia | Ubicación / referencia | Fecha | Responsable |
|-----------|------------------------|-------|-------------|
| Texto legal firmado | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Hash del texto cargado | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Base legal aprobada | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| DNS SPF/DKIM/DMARC | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Dominio verificado en Resend | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Email de prueba (headers) | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Baja one-click (evidencia) | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Decisión AAIP | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Transferencia internacional/DPA | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| T-26 PASS | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Autorización T-27 | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |

No adjuntar secretos, API keys, tokens de baja reales, emails completos ni cuerpos de mensajes.
