import { describe, it, expect } from "vitest";
import {
  zafronixMatchSchema,
  zafronixResponseSchema,
  tournamentTeamsSchema,
  rosterPlayerSchema,
  deriveMatchStatus,
  mapApiStatus,
  normalizeStage,
  extractGroupLabel,
  extractMatchNo,
  resolveMatchNo,
  normalizeTeamName,
  isPlaceholderTeam,
  extractRefereeName,
  type ZafronixMatch,
} from "../../src/lib/zafronix/matches";

import matchesResponseFixture from "../fixtures/zafronix/matches-response.sample.json";

// ── Helpers para construir fixtures inline ──────────────────────────

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _omitted, ...rest } = obj;
  void _omitted;
  return rest;
}

function makeMatch(overrides: Partial<ZafronixMatch> = {}): ZafronixMatch {
  return {
    id: "2026-001",
    matchNo: 1,
    date: null,
    kickoff: null,
    kickoffUtc: "2026-06-11T19:00:00.000Z",
    timezone: null,
    stage: "group_a",
    stageNormalized: null,
    homeTeam: "Mexico",
    awayTeam: "Canada",
    homeRef: null,
    awayRef: null,
    homeScore: null,
    awayScore: null,
    result: null,
    extraTime: null,
    penalties: null,
    stadium: null,
    stadiumId: null,
    city: null,
    country: null,
    attendance: null,
    referee: null,
    weather: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Pin del Schema
// ═══════════════════════════════════════════════════════════════════════

describe("Pin del Schema Canónico (REST API GET /matches)", () => {
  describe("Fixture dorado", () => {
    it("parsea el fixture completo (envelope)", () => {
      const result = zafronixResponseSchema.safeParse(matchesResponseFixture);
      expect(result.success, `Divergencia en zafronixResponseSchema: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      expect(result.data?.data).toHaveLength(3);
    });

    it("parsea fixture A — grupo completo con todos los campos", () => {
      const match = matchesResponseFixture.data[0];
      const result = zafronixMatchSchema.safeParse(match);
      expect(result.success, `Divergencia en match A: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      expect(result.data?.homeTeam).toBe("Mexico");
      expect(result.data?.homeScore).toBe(2);
      expect(result.data?.result).toBe("2-1");
      // referee como objeto
      const ref = result.data?.referee;
      expect(typeof ref).toBe("object");
      expect((ref as { name: string })?.name).toBe("Daniele Orsato");
    });

    it("parsea fixture B — knockout TBD (homeTeam/awayTeam null, scores null)", () => {
      const match = matchesResponseFixture.data[1];
      const result = zafronixMatchSchema.safeParse(match);
      expect(result.success, `Divergencia en match B: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      expect(result.data?.homeTeam).toBeNull();
      expect(result.data?.awayTeam).toBeNull();
      expect(result.data?.homeScore).toBeNull();
      expect(result.data?.awayScore).toBeNull();
      expect(result.data?.result).toBeNull();
      expect(result.data?.homeRef).toBe("1A");
      expect(result.data?.awayRef).toBe("2B");
      expect(result.data?.matchNo).toBe(73);
    });

    it("parsea fixture C — final con penalties y referee string", () => {
      const match = matchesResponseFixture.data[2];
      const result = zafronixMatchSchema.safeParse(match);
      expect(result.success, `Divergencia en match C: ${JSON.stringify(result.error?.issues)}`).toBe(true);
      expect(result.data?.homeScore).toBe(3);
      expect(result.data?.awayScore).toBe(2);
      expect(result.data?.result).toBe("3-2");
      expect(result.data?.penalties).toBe("4-3");
      expect(result.data?.referee).toBe("Szymon Marciniak");
    });
  });

  describe("Validación de campos requeridos", () => {
    it("rechaza match sin id", () => {
      const withoutId = omit(makeMatch(), "id");
      const result = zafronixMatchSchema.safeParse(withoutId);
      expect(result.success).toBe(false);
    });

    it("acepta match sin matchNo (opcional)", () => {
      const without = omit(makeMatch(), "matchNo");
      const result = zafronixMatchSchema.safeParse(without);
      expect(result.success).toBe(true);
    });

    it("rechaza match con homeScore string en vez de number", () => {
      const bad = makeMatch({ homeScore: "two" as unknown as number });
      const result = zafronixMatchSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it("rechaza response sin data", () => {
      const result = zafronixResponseSchema.safeParse({ year: 2026, count: 0 });
      expect(result.success).toBe(false);
    });

    it("acepta response con data vacío", () => {
      const result = zafronixResponseSchema.safeParse({ year: 2026, count: 0, data: [] });
      expect(result.success).toBe(true);
    });
  });

  describe("Union type: referee", () => {
    it("acepta referee como string", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ referee: "John Doe" }));
      expect(result.success).toBe(true);
    });

    it("acepta referee como objeto { name, country }", () => {
      const result = zafronixMatchSchema.safeParse(
        makeMatch({ referee: { name: "John Doe", country: "USA" } }),
      );
      expect(result.success).toBe(true);
    });

    it("acepta referee como objeto { name } sin country", () => {
      const result = zafronixMatchSchema.safeParse(
        makeMatch({ referee: { name: "John Doe" } as unknown as string }),
      );
      expect(result.success).toBe(true);
    });

    it("acepta referee null", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ referee: null }));
      expect(result.success).toBe(true);
    });

    it("acepta match sin referee (undefined)", () => {
      const without = omit(makeMatch(), "referee");
      const result = zafronixMatchSchema.safeParse(without);
      expect(result.success).toBe(true);
    });
  });

  describe("Nullable fields", () => {
    it("acepta homeTeam null", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ homeTeam: null }));
      expect(result.success).toBe(true);
    });

    it("acepta awayTeam null", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ awayTeam: null }));
      expect(result.success).toBe(true);
    });

    it("acepta homeScore null", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ homeScore: null }));
      expect(result.success).toBe(true);
    });

    it("acepta result null", () => {
      const result = zafronixMatchSchema.safeParse(makeMatch({ result: null }));
      expect(result.success).toBe(true);
    });

    it("acepta match con solo los campos obligatorios", () => {
      const minimal = { id: "2026-001", homeTeam: "A", awayTeam: "B", homeScore: null, awayScore: null };
      const result = zafronixMatchSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Pin de helpers
// ═══════════════════════════════════════════════════════════════════════

describe("deriveMatchStatus", () => {
  it("detecta finished por score string '3-2'", () => {
    const m = makeMatch({ homeScore: 3, awayScore: 2, result: "3-2" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta finished por score string '0-2'", () => {
    const m = makeMatch({ homeScore: 0, awayScore: 2, result: "0-2" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta finished por score string '3-3'", () => {
    const m = makeMatch({ homeScore: 3, awayScore: 3, result: "3-3" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta finished por legacy 'home'", () => {
    const m = makeMatch({ result: "home" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta finished por legacy 'away'", () => {
    const m = makeMatch({ result: "away" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta finished por legacy 'draw'", () => {
    const m = makeMatch({ result: "draw" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });

  it("detecta cancelled", () => {
    const m = makeMatch({ result: "cancelled" });
    expect(deriveMatchStatus(m)).toBe("canceled");
  });

  it("detecta suspended", () => {
    const m = makeMatch({ result: "postponed" });
    expect(deriveMatchStatus(m)).toBe("suspended");
  });

  it("detecta live cuando hay scores pero no result", () => {
    const m = makeMatch({ homeScore: 1, awayScore: 0, result: null });
    expect(deriveMatchStatus(m)).toBe("live");
  });

  it("detecta scheduled cuando no hay scores ni result", () => {
    const m = makeMatch({ homeScore: null, awayScore: null, result: null });
    expect(deriveMatchStatus(m)).toBe("scheduled");
  });

  it("detecta scheduled con result desconocido (sin scores)", () => {
    const m = makeMatch({ result: "bizarro", homeScore: null, awayScore: null });
    expect(deriveMatchStatus(m)).toBe("scheduled");
  });

  it("detecta finished con homeScore y result score string (no se confunde con live)", () => {
    // Si result es score string, debe ser finished aunque haya scores
    const m = makeMatch({ homeScore: 2, awayScore: 1, result: "2-1" });
    expect(deriveMatchStatus(m)).toBe("finished");
  });
});

describe("mapApiStatus", () => {
  it('mapea "finished" → "finished"', () => expect(mapApiStatus("finished")).toBe("finished"));
  it('mapea "completed" → "finished"', () => expect(mapApiStatus("completed")).toBe("finished"));
  it('mapea "live" → "live"', () => expect(mapApiStatus("live")).toBe("live"));
  it('mapea "in_progress" → "live"', () => expect(mapApiStatus("in_progress")).toBe("live"));
  it('mapea "suspended" → "suspended"', () => expect(mapApiStatus("suspended")).toBe("suspended"));
  it('mapea "postponed" → "suspended"', () => expect(mapApiStatus("postponed")).toBe("suspended"));
  it('mapea "cancelled" → "canceled"', () => expect(mapApiStatus("cancelled")).toBe("canceled"));
  it('mapea "abandoned" → "canceled"', () => expect(mapApiStatus("abandoned")).toBe("canceled"));
  it('mapea desconocido → "scheduled"', () => expect(mapApiStatus("unknown")).toBe("scheduled"));
});

describe("normalizeStage", () => {
  it('mapea "group_a" → "group"', () => expect(normalizeStage("group_a")).toBe("group"));
  it('mapea "group_l" → "group"', () => expect(normalizeStage("group_l")).toBe("group"));
  it('mapea "r32" → "round-32"', () => expect(normalizeStage("r32")).toBe("round-32"));
  it('mapea "round_of_32" → "round-32"', () => expect(normalizeStage("round_of_32")).toBe("round-32"));
  it('mapea "r16" → "round-16"', () => expect(normalizeStage("r16")).toBe("round-16"));
  it('mapea "qf" → "quarter"', () => expect(normalizeStage("qf")).toBe("quarter"));
  it('mapea "quarter_final" → "quarter"', () => expect(normalizeStage("quarter_final")).toBe("quarter"));
  it('mapea "sf" → "semi"', () => expect(normalizeStage("sf")).toBe("semi"));
  it('mapea "semi_final" → "semi"', () => expect(normalizeStage("semi_final")).toBe("semi"));
  it('mapea "3p" → "third-place"', () => expect(normalizeStage("3p")).toBe("third-place"));
  it('mapea "thirdPlace" → "third-place"', () => expect(normalizeStage("thirdPlace")).toBe("third-place"));
  it('mapea "f" → "final"', () => expect(normalizeStage("f")).toBe("final"));
  it('mapea "final" → "final"', () => expect(normalizeStage("final")).toBe("final"));
  it("retorna null para null", () => expect(normalizeStage(null)).toBeNull());
  it("retorna null para undefined", () => expect(normalizeStage(undefined)).toBeNull());
  it("passthrough para valor desconocido", () => expect(normalizeStage("bizarro")).toBe("bizarro"));
});

describe("extractGroupLabel", () => {
  it('extrae "A" de "group_a"', () => expect(extractGroupLabel("group_a")).toBe("A"));
  it('extrae "L" de "group_l"', () => expect(extractGroupLabel("group_l")).toBe("L"));
  it("retorna null para stage no-group", () => expect(extractGroupLabel("r32")).toBeNull());
  it("retorna null para null", () => expect(extractGroupLabel(null)).toBeNull());
  it("retorna null para undefined", () => expect(extractGroupLabel(undefined)).toBeNull());
});

describe("extractMatchNo", () => {
  it('extrae 1 de "2026-001"', () => expect(extractMatchNo("2026-001")).toBe(1));
  it('extrae 73 de "2026-073"', () => expect(extractMatchNo("2026-073")).toBe(73));
  it('extrae 104 de "2026-104"', () => expect(extractMatchNo("2026-104")).toBe(104));
  it("retorna null para formato inválido", () => expect(extractMatchNo("bad")).toBeNull());
});

describe("resolveMatchNo", () => {
  it("usa matchNo directo si está presente", () => {
    const m = makeMatch({ matchNo: 5, id: "2026-001" });
    expect(resolveMatchNo(m)).toBe(5);
  });

  it("extrae del id si matchNo no está presente", () => {
    const m = omit(makeMatch(), "matchNo");
    m.id = "2026-073";
    expect(resolveMatchNo(m)).toBe(73);
  });

  it("retorna null si ambos faltan", () => {
    const m = omit(makeMatch(), "matchNo");
    m.id = "bad";
    expect(resolveMatchNo(m)).toBeNull();
  });
});

describe("normalizeTeamName", () => {
  it('convierte "usa" → "United States"', () => expect(normalizeTeamName("usa")).toBe("United States"));
  it('convierte "united states" → "United States"', () => expect(normalizeTeamName("united states")).toBe("United States"));
  it('convierte "korea republic" → "Korea Republic"', () => expect(normalizeTeamName("korea republic")).toBe("Korea Republic"));
  it('convierte "ivory coast" → "Cote d\'Ivoire"', () => expect(normalizeTeamName("ivory coast")).toBe("Cote d'Ivoire"));
  it('convierte "cote d\'ivoire" → "Cote d\'Ivoire"', () => expect(normalizeTeamName("cote d'ivoire")).toBe("Cote d'Ivoire"));
  it('mantiene "Mexico" igual', () => expect(normalizeTeamName("Mexico")).toBe("Mexico"));
  it('convierte "iran" → "IR Iran"', () => expect(normalizeTeamName("iran")).toBe("IR Iran"));
});

describe("isPlaceholderTeam", () => {
  it('identifica "TBD" como placeholder', () => expect(isPlaceholderTeam("TBD")).toBe(true));
  it('identifica "POR DEFINIR" como placeholder', () => expect(isPlaceholderTeam("POR DEFINIR")).toBe(true));
  it("identifica string vacío como placeholder", () => expect(isPlaceholderTeam("")).toBe(true));
  it('identifica "1A" como placeholder', () => expect(isPlaceholderTeam("1A")).toBe(true));
  it('identifica "2B" como placeholder', () => expect(isPlaceholderTeam("2B")).toBe(true));
  it('identifica "W73" como placeholder', () => expect(isPlaceholderTeam("W73")).toBe(true));
  it('identifica "L102" como placeholder', () => expect(isPlaceholderTeam("L102")).toBe(true));
  it('identifica "3ABCDEF" como placeholder', () => expect(isPlaceholderTeam("3ABCDEF")).toBe(true));
  it('identifica "Mexico" como no-placeholder', () => expect(isPlaceholderTeam("Mexico")).toBe(false));
  it('identifica "France" como no-placeholder', () => expect(isPlaceholderTeam("France")).toBe(false));
});

describe("extractRefereeName", () => {
  it("extrae nombre de referee string", () => {
    expect(extractRefereeName("John Doe")).toBe("John Doe");
  });

  it("extrae nombre de referee objeto", () => {
    expect(extractRefereeName({ name: "John Doe", country: "USA" })).toBe("John Doe");
  });

  it("retorna null para referee null", () => {
    expect(extractRefereeName(null)).toBeNull();
  });

  it("retorna null para referee undefined", () => {
    expect(extractRefereeName(undefined)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Pin de schemas auxiliares
// ═══════════════════════════════════════════════════════════════════════

describe("tournamentTeamsSchema", () => {
  it("parsea respuesta válida de /tournaments/2026", () => {
    const data = {
      teams: [
        { name: "Mexico", iso: "mx", code: "MEX" },
        { name: "Argentina", iso: "ar", code: "ARG" },
        { name: "Soviet Union", iso: null, code: "URS" },
      ],
    };
    const result = tournamentTeamsSchema.safeParse(data);
    expect(result.success).toBe(true);
    expect(result.data?.teams).toHaveLength(3);
  });

  it("rechaza si falta code en un team", () => {
    const data = {
      teams: [{ name: "Mexico", iso: "mx" }],
    };
    const result = tournamentTeamsSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("acepta iso null", () => {
    const data = {
      teams: [{ name: "Soviet Union", iso: null, code: "URS" }],
    };
    const result = tournamentTeamsSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("rosterPlayerSchema", () => {
  it("parsea un jugador con campos mínimos", () => {
    const result = rosterPlayerSchema.safeParse({ name: "Diego Maradona" });
    expect(result.success).toBe(true);
  });

  it("parsea un jugador con todos los campos", () => {
    const result = rosterPlayerSchema.safeParse({
      name: "Diego Maradona",
      position: "MF",
      jersey: 10,
    });
    expect(result.success).toBe(true);
  });

  it("acepta jersey null", () => {
    const result = rosterPlayerSchema.safeParse({ name: "Sub", jersey: null });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Pin de import único (verifica que los módulos productivos importan
// desde el canonical)
// ═══════════════════════════════════════════════════════════════════════

describe("Verificación de fuente única (imports)", () => {
  it("el schema canónico es importable y tiene los campos esperados", () => {
    // Verifica que el módulo existe y la función shape del objeto tiene los campos clave
    const shape = zafronixMatchSchema.shape as Record<string, unknown>;
    expect(shape.id).toBeDefined();
    expect(shape.homeTeam).toBeDefined();
    expect(shape.awayTeam).toBeDefined();
    expect(shape.homeScore).toBeDefined();
    expect(shape.awayScore).toBeDefined();
    expect(shape.result).toBeDefined();
    expect(shape.matchNo).toBeDefined();
    expect(shape.referee).toBeDefined();
    expect(shape.stage).toBeDefined();
    expect(shape.kickoffUtc).toBeDefined();
  });

  it("deriveMatchStatus es una función exportada", () => {
    expect(typeof deriveMatchStatus).toBe("function");
  });

  it("normalizeTeamName es una función exportada", () => {
    expect(typeof normalizeTeamName).toBe("function");
  });

  it("isPlaceholderTeam es una función exportada", () => {
    expect(typeof isPlaceholderTeam).toBe("function");
  });

  it("resolveMatchNo es una función exportada", () => {
    expect(typeof resolveMatchNo).toBe("function");
  });

  it("extractRefereeName es una función exportada", () => {
    expect(typeof extractRefereeName).toBe("function");
  });
});
