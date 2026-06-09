"use client";

import { useState, useRef, useEffect, useCallback, useId, useTransition } from "react";
import { Check, Search } from "lucide-react";

import { searchAwardCandidates, getAwardCandidateById } from "@/app/actions/awards-search.actions";
import { cn } from "@/utils/utils";
import type { AwardCandidate } from "@/types";

function flagEmoji(code: string): string {
  if (!code) return "";
  return code.toUpperCase().replace(/./g, (c) =>
    String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6),
  );
}

interface TeamGroup {
  teamName: string;
  flagCode: string;
  players: AwardCandidate[];
}

function groupByTeam(candidates: AwardCandidate[]): TeamGroup[] {
  const map = new Map<string, TeamGroup>();
  for (const c of candidates) {
    const tn = c.team_name ?? "Sin equipo";
    if (!map.has(tn)) {
      map.set(tn, { teamName: tn, flagCode: c.flag_code ?? "", players: [] });
    }
    map.get(tn)!.players.push(c);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.teamName.localeCompare(b.teamName),
  );
}

interface AwardSelectorProps {
  selectedCandidate: AwardCandidate | null;
  selectedId: string | null;
  pendingId: string | null;
  disabled: boolean;
  onSelect: (candidateId: string) => void;
  category: "champion" | "top_scorer" | "mvp";
}

export function AwardSelector({
  selectedCandidate,
  selectedId,
  pendingId,
  disabled,
  onSelect,
  category,
}: AwardSelectorProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<AwardCandidate[]>([]);
  const [localSelected, setLocalSelected] = useState<AwardCandidate | null>(null);
  const [isSearching, startSearch] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const isChampion = category === "champion";
  const dropdownId = `award-search-${category}-${useId()}`;

  useEffect(() => {
    if (selectedCandidate) setLocalSelected(selectedCandidate);
    else setLocalSelected(null);
  }, [selectedCandidate]);

  useEffect(() => {
    if (selectedId && !selectedCandidate && !localSelected) {
      getAwardCandidateById(selectedId).then((c) => {
        if (c) setLocalSelected(c);
      });
    }
  }, [selectedId, selectedCandidate, localSelected]);

  const displayCandidate = localSelected || selectedCandidate;

  const doSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      const seq = ++requestSeq.current;
      startSearch(async () => {
        const data = await searchAwardCandidates(trimmed, category);
        // Descarta respuestas viejas si el usuario siguió escribiendo
        if (requestSeq.current !== seq) return;
        setResults(data);
        setIsOpen(true);
      });
    },
    [category],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(search), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setSearch("");
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  function selectCandidate(c: AwardCandidate) {
    setLocalSelected(c);
    onSelect(c.id);
    setIsOpen(false);
    setSearch("");
    setResults([]);
  }

  const isChampionResults = isChampion;

  const resultsGrouped = !isChampion ? groupByTeam(results) : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || search.trim()) setIsOpen(true);
          }}
          placeholder={isChampion ? "Buscar equipo..." : "Escribí para buscar jugador o país..."}
          disabled={disabled}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={dropdownId}
          aria-label={isChampion ? "Buscar equipo campeón" : "Buscar jugador"}
          className="h-10 w-full rounded-lg border border-white/10 bg-[#0D1B2A] pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#E9C46A] disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {displayCandidate && (
        <div
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="mt-2 flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#E9C46A]/40 bg-[#E9C46A]/10 px-3 py-2"
          role="button"
          tabIndex={0}
          aria-label={`Cambiar selección actual: ${displayCandidate.name}`}
        >
          <span className="text-lg" aria-hidden>
            {flagEmoji(displayCandidate.flag_code ?? "")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">
              {displayCandidate.name}
            </div>
            {displayCandidate.team_name && (
              <div className="truncate text-xs text-white/60">
                {displayCandidate.team_name}
              </div>
            )}
          </div>
          <Check className="h-5 w-5 shrink-0 text-[#10B981]" strokeWidth={3} />
        </div>
      )}

      {isOpen && (
        <div
          id={dropdownId}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/20 bg-[#1B263B] shadow-2xl"
        >
          {isSearching ? (
            <div className="flex items-center justify-center px-4 py-6">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-white/50">
              {search.trim() ? "Sin resultados." : "Escribí para buscar."}
            </div>
          ) : isChampionResults ? (
            results.map((c) => {
              const isSelected = c.id === selectedId;
              const isPending = c.id === pendingId;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectCandidate(c)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5",
                    isSelected && "bg-[#E9C46A]/10",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="text-lg">{flagEmoji(c.flag_code ?? "")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">
                    {c.name}
                  </span>
                  {isPending ? (
                    <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : isSelected ? (
                    <Check className="h-4 w-4 shrink-0 text-[#10B981]" strokeWidth={3} />
                  ) : null}
                </button>
              );
            })
          ) : resultsGrouped ? (
            resultsGrouped.map((team) => (
              <div key={team.teamName}>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-[#0D1B2A] px-3 py-1.5">
                  <span className="text-sm">{flagEmoji(team.flagCode)}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">
                    {team.teamName}
                  </span>
                </div>
                {team.players.map((player) => {
                  const isSelected = player.id === selectedId;
                  const isPending = player.id === pendingId;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => selectCandidate(player)}
                      className={cn(
                        "flex w-full items-center gap-3 pl-9 pr-3 py-2 text-left transition-colors hover:bg-white/5",
                        isSelected && "bg-[#E9C46A]/10",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-white">
                        {player.name}
                      </span>
                      {isPending ? (
                        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : isSelected ? (
                        <Check className="h-4 w-4 shrink-0 text-[#10B981]" strokeWidth={3} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          ) : null}
        </div>
      )}
    </div>
  );
}
