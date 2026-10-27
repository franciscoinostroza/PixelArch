---
description: Ejecuta la siguiente tarea pendiente (implementar, testear, revisar)
agent: coordinator
---
Fase IMPLEMENT. Spec: $ARGUMENTS

Toma la primera tarea sin marcar de `tasks.md`. Ejecuta el ciclo estandar: implementer → tester → reviewer, con maximo 3 correcciones. Al aprobarse, el **implementer** marca `[x]` en `tasks.md` y el **planner** guarda el informe del reviewer en `review.md` si corresponde. Resume el resultado. No empieces la siguiente tarea sin que la persona lo pida, salvo que haya dicho "continua hasta terminar".
