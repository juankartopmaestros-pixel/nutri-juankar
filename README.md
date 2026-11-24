# NutriK (Nutri Juankar)

Haz una foto a un alimento o a su etiqueta y te dice lo saludable que es, según la hoja "detective de etiquetas" de la nutricionista.

- `index.html`: la app (se instala en el móvil como icono).
- `api/`: el servidor en Supabase (función `analizar`) que lee la foto con Claude y aplica las reglas. La clave de Anthropic vive solo como secreto en Supabase, nunca en este repositorio.
