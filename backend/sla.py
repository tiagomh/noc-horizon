"""
Confiabilidade: disponibilidade, SLO, orçamento de erro, MTTR e MTTA.

O histórico vem do próprio Zabbix (event.get) — o NOC Horizon não guarda
nada em banco. `compute_sla()` é pura e é o que os testes exercitam.

Definições:
- Um grupo está INDISPONÍVEL enquanto qualquer host dele tiver um problema
  com severidade >= NOC_SLO_MIN_SEVERITY (padrão: High). Problemas em
  manutenção não contam.
- Disponibilidade geral = média da disponibilidade dos grupos.
- Orçamento de erro = quanto da indisponibilidade permitida pela meta
  (ex.: 99,5% em 30 dias = 3h36min) ainda não foi gasto.
- MTTR = tempo médio entre o início e a resolução dos incidentes.
- MTTA = tempo médio entre o início e o primeiro reconhecimento.
"""

import time

from aggregator import group_keys

DAY = 86400
WINDOWS = {"7d": 7 * DAY, "30d": 30 * DAY}


def _union_length(intervals, lo, hi):
    """Soma dos intervalos [início, fim) dentro de [lo, hi), sem contar sobreposição."""
    clipped = sorted((max(s, lo), min(e, hi)) for s, e in intervals if e > lo and s < hi)
    total = 0
    cur_start = cur_end = None
    for start, end in clipped:
        if cur_end is None or start > cur_end:
            if cur_end is not None:
                total += cur_end - cur_start
            cur_start, cur_end = start, end
        else:
            cur_end = max(cur_end, end)
    if cur_end is not None:
        total += cur_end - cur_start
    return total


def _mean(values):
    return round(sum(values) / len(values)) if values else None


def compute_sla(incidents, host_map, locations, now, target, min_severity, windows=None):
    windows = windows or WINDOWS
    relevant = [i for i in incidents if i["host"] in host_map and i["severity"] >= min_severity]
    locs_with_hosts = {
        loc for value in host_map.values() for loc in group_keys(value) if loc in locations
    }

    out = {}
    for name, length in windows.items():
        lo = now - length
        intervals = {loc: [] for loc in locs_with_hosts}
        for inc in relevant:
            end = inc["end"] if inc["end"] is not None else now
            for loc in group_keys(host_map[inc["host"]]):
                if loc in intervals:
                    intervals[loc].append((inc["start"], end))

        by_location = {
            loc: round(100 * (1 - _union_length(ints, lo, now) / length), 3)
            for loc, ints in intervals.items()
        }
        overall = round(sum(by_location.values()) / len(by_location), 3) if by_location else None

        budget = None
        if overall is not None and target < 100:
            consumed = (100 - overall) / (100 - target)
            budget = round(max(0.0, 100 * (1 - consumed)), 1)

        in_window = [i for i in relevant if i["start"] >= lo]
        out[name] = {
            "availability": overall,
            "error_budget_remaining_pct": budget,
            "allowed_downtime_seconds": round((100 - target) / 100 * length),
            "mttr_seconds": _mean(
                [i["end"] - i["start"] for i in in_window if i["end"] is not None]
            ),
            "mtta_seconds": _mean(
                [max(0, i["ack"] - i["start"]) for i in in_window if i.get("ack") is not None]
            ),
            "incidents": len(in_window),
            "open_incidents": sum(1 for i in in_window if i["end"] is None),
            "locations": by_location,
        }

    return {"target": target, "min_severity": min_severity, "windows": out}


def build_sla():
    """Busca o histórico (Zabbix ou simulação) e calcula a confiabilidade."""
    from config import NOC_MODE, NOC_SLO_MIN_SEVERITY, NOC_SLO_TARGET

    now = time.time()
    longest = max(WINDOWS.values())

    if NOC_MODE == "demo":
        import demo_source

        incidents = demo_source.incidents(now, days=longest // DAY)
        host_map, locations = demo_source.HOST_MAP, demo_source.LOCATIONS
    else:
        import zabbix_client as zc
        from aggregator import resolve_locations

        host_map, locations = resolve_locations(zc)
        incidents = zc.get_incidents(now - longest)

    return compute_sla(incidents, host_map, locations, now, NOC_SLO_TARGET, NOC_SLO_MIN_SEVERITY)
