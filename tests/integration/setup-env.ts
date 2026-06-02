// setupFile del proyecto "integration".
// Carga las credenciales del Supabase local desde archivos .env locales.
// dotenv NO sobreescribe variables ya presentes en process.env, por lo que
// en CI (donde se exportan directamente desde `supabase status -o env`) esas
// tienen precedencia sobre cualquier archivo.
import { config } from "dotenv";

config({ path: ".env.test.local" });
config({ path: ".env.test" });
