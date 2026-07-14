# MapasBot

Bot de operación de mapas, sesiones de scouts, revisiones y verificaciones.

## Comandos visibles

| Comando | Acceso | Objetivo |
| --- | --- | --- |
| `/mapas` | General | Publicar nuevamente el panel principal en el canal actual. |
| `/mapas-configurar` | Prio y superiores | Importar, editar, programar o vaciar mapas con vista previa. |
| `/revisar` | Scout y superiores | Iniciar una ronda o actualizar/mover el panel de la ronda activa. |
| `!revisar` | Scout y superiores | Alias de texto de `/revisar`. |
| `/mapas-historial` | General | Consultar el resumen operativo del día. |
| `/mapas-exportar` | Líder | Exportar sesiones cerradas y activas como CSV. |
| `/mapas-gestionar` | Prio y superiores | Abrir las herramientas permitidas por la jerarquía del usuario. |

`/scout revisar` dejó de registrarse porque duplicaba exactamente `/revisar`. La función permanece disponible mediante `/revisar` y `!revisar`.

## Jerarquía

- **General/Scout:** panel público, actividad personal y revisión de mapas.
- **Prio/operación:** configurar mapas, retirar scouts, enviar verificaciones y consultar auditoría.
- **GM/Officer:** horas, multiplicadores, control de rondas, modo de verificación y regeneración de resúmenes.
- **Líder:** exportación de actividad.

Todas las acciones vuelven a validar permisos al pulsar botones, seleccionar usuarios y enviar formularios.

## Automatizaciones

- Las alertas de mapas vacíos se consolidan en un único mensaje editable.
- Las rondas comienzan manualmente y cierran automáticamente después de 20 minutos.
- Un redeploy nunca inicia ni recupera automáticamente una ronda anterior.
- Las verificaciones se solicitan al completar el bloque configurado y las capturas se aceptan provisionalmente.
- Las evidencias pendientes avisan a GM/Officer después del tiempo configurado.
- La configuración de mapas puede aplicarse de inmediato o programarse para el cierre de las 10 UTC.
- El cierre diario archiva el resumen, cierra sesiones, limpia el período y activa los mapas programados.
- Editar mapas conserva asignaciones y horas de mapas que no fueron eliminados.
- Cobertura y auditoría sobreviven reinicios mediante la persistencia configurada en `DATA_DIR`.

## Railway

Configurar un volumen persistente y establecer `DATA_DIR` hacia ese volumen. Las variables principales se encuentran documentadas en `settings.js`.

## Pruebas

```bash
npm test
```
