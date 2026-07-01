import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";
import {
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  MULTIPLIER_TIERS,
  POINTS_EXACT,
  POINTS_NONE,
  POINTS_RESULT,
} from "@/utils/scoring";

const examples = [
  {
    prediction: "Argentina 2 - 1 Brasil",
    result: "Argentina 2 - 1 Brasil",
    base: POINTS_EXACT,
    reason: "Marcador exacto",
  },
  {
    prediction: "Argentina 1 - 0 Brasil",
    result: "Argentina 2 - 1 Brasil",
    base: POINTS_RESULT,
    reason: "Ganador correcto",
  },
  {
    prediction: "Argentina 1 - 1 Brasil",
    result: "Argentina 2 - 1 Brasil",
    base: POINTS_NONE,
    reason: "Resultado incorrecto",
  },
];

const specialAwards = [
  { label: "Antes del partido inaugural", points: "50 pts" },
  { label: "Fase de grupos", points: "25 pts" },
  { label: "Octavos y cuartos", points: "10 pts" },
  { label: "Desde semifinales", points: "2 pts" },
];

export default function RulesPage() {
  return (
    <>
      <AppTopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5 lg:max-w-5xl lg:gap-6">
          <header className="space-y-2">
            <BrandEyebrow />
            <h1 className="font-display text-2xl font-bold lg:text-4xl">
              Instrucciones de la quiniela
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground lg:text-base">
              Pronostica marcadores, gana puntos por aciertos, multiplica si
              juegas temprano y reta a otros miembros apostando tu saldo.
            </p>
          </header>

          <section className="grid gap-3 lg:grid-cols-3">
            <RuleCard
              title="Marcador exacto"
              value={`${POINTS_EXACT} pts`}
              body="Aciertas los goles de ambos equipos."
            />
            <RuleCard
              title="Resultado correcto"
              value={`${POINTS_RESULT} pts`}
              body="Aciertas ganador o empate, pero no el marcador exacto."
            />
            <RuleCard
              title="Sin acierto"
              value={`${POINTS_NONE} pts`}
              body="El partido termina con otro resultado."
            />
          </section>

          <section className="rounded-md border border-border bg-card p-4 text-card-foreground">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fórmula
              </p>
              <h2 className="font-display text-xl font-bold">
                Puntos finales = puntos base x multiplicador
              </h2>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {examples.map((example) => (
                <article
                  key={`${example.prediction}-${example.reason}`}
                  className="rounded-sm border border-border bg-background p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {example.reason}
                  </p>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Tu jugada:</span>{" "}
                      {example.prediction}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Final:</span>{" "}
                      {example.result}
                    </p>
                  </div>
                  <p className="mt-3 font-display text-2xl font-bold text-accent">
                    {example.base} pts base
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4 text-card-foreground">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Multiplicadores
              </p>
              <h2 className="font-display text-xl font-bold">
                Mientras antes pronosticas, más vale tu acierto
              </h2>
              <p className="text-sm leading-6 text-muted-foreground">
                La Jornada 1 siempre vale {MIN_MULTIPLIER.toFixed(1)}x. Desde
                la Jornada 2 y en eliminatorias, el multiplicador depende de
                cuántas jornadas de antelación pronosticas respecto a la jornada
                en curso: cada jornada por delante suma. Si editas tarde (ya
                avanzó el torneo), baja.
              </p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MULTIPLIER_TIERS.map((tier) => (
                <div
                  key={tier.distance}
                  className="flex items-center justify-between rounded-sm border border-border bg-background px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">
                    {tier.distance === 1
                      ? "1 jornada antes"
                      : `${tier.distance} jornadas antes`}
                  </span>
                  <span className="font-display text-lg font-bold text-accent">
                    {tier.value.toFixed(2)}x
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Máximo posible por partido: marcador exacto de {POINTS_EXACT} pts
              x {MAX_MULTIPLIER.toFixed(1)} ={" "}
              {(POINTS_EXACT * MAX_MULTIPLIER).toFixed(1)} pts.
            </p>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4 text-card-foreground">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Premios especiales
              </p>
              <h2 className="mt-1 font-display text-xl font-bold">
                Campeón, goleador y MVP
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Estas predicciones dan puntos grandes si aciertas, pero pierden
                valor mientras avanza el torneo. Se pueden registrar y modificar
                hasta el inicio del partido de la final, momento en el que se bloquean.
              </p>
              <div className="mt-4 divide-y divide-border border-t border-border">
                {specialAwards.map((award) => (
                  <div
                    key={award.label}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-muted-foreground">{award.label}</span>
                    <span className="font-semibold">{award.points}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border bg-card p-4 text-card-foreground">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Duelos
              </p>
              <h2 className="mt-1 font-display text-xl font-bold">
                Apuesta puntos contra otros miembros
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>
                  Puedes crear un duelo directo o un pozo abierto seleccionando
                  partido, marcador y puntos apostados.
                </p>
                <p>
                  Los puntos quedan retenidos mientras el desafío está activo.
                  Al finalizar el partido, el sistema reparte el pozo según el
                  mejor pronóstico.
                </p>
                <div className="rounded-sm border border-border bg-background p-3">
                  <p className="font-semibold text-foreground">
                    Cómo se decide el ganador
                  </p>
                  <p className="mt-1">
                    Cada marcador del duelo usa la puntuación base de la
                    quiniela: {POINTS_EXACT} pts por marcador exacto,{" "}
                    {POINTS_RESULT} pts por acertar ganador o empate, y{" "}
                    {POINTS_NONE} pts si falla el resultado. No se usa el
                    multiplicador.
                  </p>
                </div>
                <p>
                  Si varias personas empatan con el mejor puntaje, todas ganan
                  y el pozo se reparte entre ellas. Por ejemplo, si dos jugadores
                  apuestan 6 pts cada uno, uno juega 3-0 y el otro 2-0, y el
                  partido queda 1-0, ambos suman {POINTS_RESULT} pts y reciben
                  6 pts del pozo de 12.
                </p>
                <p>
                  Si el reto se rechaza, expira antes del kickoff o el partido
                  se suspende/cancela, los puntos retenidos se devuelven.
                  También se devuelven si nadie suma puntos en el duelo.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4 text-card-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Posiciones
            </p>
            <h2 className="mt-1 font-display text-xl font-bold">
              Desempates de la tabla
            </h2>
            <ol className="mt-3 grid gap-2 text-sm text-muted-foreground lg:grid-cols-3">
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">1.</span>{" "}
                Más marcadores exactos (aciertos de 5 pts).
              </li>
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">2.</span>{" "}
                Más resultados acertados (aciertos de 2 pts, excluyendo exactos).
              </li>
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">3.</span>{" "}
                Más puntos por premios acertados (Awards).
              </li>
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">4.</span>{" "}
                Más puntos ganados en duelos (victorias resueltas).
              </li>
              <li className="rounded-sm border border-border bg-background p-3 lg:col-span-2">
                <span className="font-semibold text-foreground">5.</span>{" "}
                Empate absoluto: si persiste la igualdad en todos los criterios, comparten la posición y se define externamente (sorteo manual).
              </li>
            </ol>
          </section>
        </div>

        <BottomNavbar />
      </main>
    </>
  );
}

function RuleCard({
  title,
  value,
  body,
}: {
  title: string;
  value: string;
  body: string;
}) {
  return (
    <article className="rounded-md border border-border bg-card p-4 text-card-foreground">
      <p className="font-display text-3xl font-bold text-accent">{value}</p>
      <h2 className="mt-2 font-display text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  );
}
