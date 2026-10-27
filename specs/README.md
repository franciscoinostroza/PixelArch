# Specs — flujo SDD

Nada se implementa sin una spec aprobada. Flujo:

```
Constitucion → Spec (QUE/POR QUE) → Plan (COMO) → Tareas → Implementacion → Tests → Revision
```

## Artefactos

| Fase | Archivo | Quien lo produce |
|------|---------|------------------|
| 1. Specify | `specs/NNN-slug/spec.md` | planner |
| 2. Plan | `specs/NNN-slug/plan.md` | planner |
| 3. Tasks | `specs/NNN-slug/tasks.md` | planner |
| 4. Implement | codigo en `src/` | implementer |
| 5. Test | tests en `src/__tests__/` + reporte | tester |
| 6. Review | `specs/NNN-slug/review.md` | reviewer (lo guarda planner) |

## Comandos

- `/specify <idea>`: crea la spec.
- `/plan <NNN>`: plan tecnico + tareas.
- `/implement <NNN>`: ejecuta la siguiente tarea pendiente.
- `/verify <NNN>`: tests + revision global.

## Reglas

1. La spec es la fuente de verdad. Si el codigo y la spec difieren, se corrige uno de los dos de forma explicita.
2. Cada tarea referencia al menos un criterio de aceptacion (`AC-x`).
3. Una tarea = un cambio revisable (~1 commit).
4. Ante ambiguedad, marcar `[NECESITA ACLARACION]` en la spec en lugar de inventar.
5. Los principios no negociables estan en `constitution.md`.

## Plantillas

Copiar desde `_templates/` al crear un nuevo `NNN-slug/`.
