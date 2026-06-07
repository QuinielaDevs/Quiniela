import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { TopNav } from "@/components/layout/TopNav";
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
  { label: "Desde semifinales", points: "Bloqueado" },
];

export default function RulesPage() {
  return (
    <>
      <TopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-5 lg:max-w-5xl lg:gap-6">
          <header className="space-y-2">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent lg:hidden">
              PIJA Quiniela
            </p>
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
                la Jornada 2 y en eliminatorias, el multiplicador se calcula por
                la antelación contra el kickoff de cada partido. Si editas una
                predicción tarde, puede bajar.
              </p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MULTIPLIER_TIERS.map((tier) => (
                <div
                  key={tier.minDays}
                  className="flex items-center justify-between rounded-sm border border-border bg-background px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">
                    {tier.minDays === 0
                      ? "Menos de 7 días"
                      : `${tier.minDays}+ días antes`}
                  </span>
                  <span className="font-display text-lg font-bold text-accent">
                    {tier.value.toFixed(1)}x
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
                valor mientras avanza el torneo.
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
                <p>
                  Si el reto se rechaza, expira antes del kickoff o el partido
                  se suspende/cancela, los puntos retenidos se devuelven.
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
                Más marcadores exactos.
              </li>
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">2.</span>{" "}
                Puntos de duelos directos.
              </li>
              <li className="rounded-sm border border-border bg-background p-3">
                <span className="font-semibold text-foreground">3.</span>{" "}
                Fecha de entrada a la liga.
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
