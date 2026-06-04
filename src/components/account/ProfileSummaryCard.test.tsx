import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BadgeHistory } from "@/components/account/BadgeHistory";
import { ProfileSummaryCard } from "@/components/account/ProfileSummaryCard";

const BADGES = [
  {
    badgeType: "nostradamus",
    badgeLabel: "Nostradamus",
    matchday: 1,
    reason: "Marcador exacto difícil",
    points: 5,
  },
];

describe("ProfileSummaryCard", () => {
  it("renderiza identidad, liga y perfil psicológico", () => {
    render(
      <ProfileSummaryCard
        displayName="Ana"
        avatarUrl="/assets/avatars/default-player.svg"
        leagueName="Liga de Ana"
        latestProfile={{
          profileType: "optimista",
          profileLabel: "Optimista",
          matchday: 1,
          summary: "Juega esperando marcadores amplios.",
        }}
        badges={BADGES}
      />,
    );

    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Liga de Ana")).toBeInTheDocument();
    expect(screen.getByText("Optimista")).toBeInTheDocument();
    expect(screen.getByAltText("Avatar de Ana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /compartir perfil/i })).toBeInTheDocument();
  });

  it("muestra estado sin perfil si no hay jornadas materializadas", () => {
    render(
      <ProfileSummaryCard
        displayName="Ana"
        avatarUrl=""
        leagueName="Liga de Ana"
        latestProfile={null}
        emptyProfileMessage="Hay jornadas cerradas, pero todavía no tienes predicciones evaluables para perfilar tu juego."
        badges={[]}
      />,
    );

    expect(
      screen.getByText(
        "Hay jornadas cerradas, pero todavía no tienes predicciones evaluables para perfilar tu juego.",
      ),
    ).toBeInTheDocument();
  });
});

describe("BadgeHistory", () => {
  it("renderiza medallas de jornada", () => {
    render(<BadgeHistory badges={BADGES} />);

    expect(screen.getByText("Nostradamus")).toBeInTheDocument();
    expect(screen.getByText("Jornada 1")).toBeInTheDocument();
    expect(screen.getByText("5.0 pts")).toBeInTheDocument();
  });

  it("renderiza empty state si no hay medallas", () => {
    render(<BadgeHistory badges={[]} />);

    expect(
      screen.getByText("Aún no cae una medalla, pero el torneo es largo."),
    ).toBeInTheDocument();
  });
});
