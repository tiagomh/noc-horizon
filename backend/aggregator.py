"""
Agrega os problemas ativos do Zabbix por host e por grupo (os quadros do
painel), decide o status de cada um e monta o resumo (summary) do NOC Horizon.

Por compatibilidade, a API continua chamando os grupos de "locations".

- `aggregate()` é uma função pura (sem rede, sem config): recebe os dados
  brutos e devolve o snapshot. É o que os testes exercitam.
- `build_snapshot()` busca os dados no Zabbix e chama `aggregate()`.
"""

import logging
import time

log = logging.getLogger(__name__)

# Ordem de gravidade: quanto maior o índice, pior o status.
STATUS_ORDER = ["ok", "unknown", "warning", "attention", "critical"]


def severity_to_status(severity: int) -> str:
    """Severidade do Zabbix (0-5) -> status do painel."""
    if severity <= 2:
        return "warning"
    if severity == 3:
        return "attention"
    return "critical"


def worst(*statuses: str) -> str:
    """Status mais grave entre os informados ("ok" se nenhum)."""
    return max(statuses, key=STATUS_ORDER.index, default="ok")


def group_keys(value):
    """Valor do host_map -> lista de chaves (aceita uma chave só ou uma lista)."""
    return [value] if isinstance(value, str) else list(value)


def aggregate(problems, last_data, host_map, locations, now, stale_after, latency_ms=None):
    """
    problems:    [{"host", "name", "severity", "acknowledged", "suppressed", "clock"?}]
    last_data:   {host: unix_ts do dado mais recente} ou None se não foi possível obter
    host_map:    {host: chave do grupo | [chaves]} — um host pode estar em vários grupos
    locations:   {chave do grupo: {"label"}}
    now:         unix_ts atual
    stale_after: segundos sem dados para o host ser considerado "unknown"
    """
    # Problemas por host (só hosts mapeados); o resto é contado à parte.
    probs_by_host = {}
    unmapped_problems = 0
    for p in problems:
        if p.get("host") in host_map:
            probs_by_host.setdefault(p["host"], []).append(p)
        else:
            unmapped_problems += 1

    hosts_by_loc = {key: [] for key in locations}
    for host, value in host_map.items():
        for loc in group_keys(value):
            if loc in hosts_by_loc:
                hosts_by_loc[loc].append(host)

    locations_out = []
    all_hosts = {}  # host -> entrada (um host em 3 grupos conta 1 vez no resumo)
    for loc_key, info in locations.items():
        hosts_out = []
        loc_problems = []
        for host in sorted(hosts_by_loc[loc_key]):
            host_problems = probs_by_host.get(host, [])
            active = [p for p in host_problems if not p.get("suppressed")]

            age = None
            stale = False
            if last_data is not None:
                ts = last_data.get(host, 0)
                age = int(now - ts) if ts > 0 else None
                stale = age is None or age > stale_after

            status = worst(*(severity_to_status(p["severity"]) for p in active))
            if stale:
                status = worst(status, "unknown")

            host_entry = {
                "host": host,
                "status": status,
                "stale": stale,
                "last_data_age_seconds": age,
                "active_problems": len(active),
            }
            hosts_out.append(host_entry)
            all_hosts[host] = host_entry

            for p in host_problems:
                loc_problems.append(
                    {
                        "host": host,
                        "trigger": p["name"],
                        "severity": p["severity"],
                        "acknowledged": bool(p.get("acknowledged")),
                        "suppressed": bool(p.get("suppressed")),
                        "since": p.get("clock") or None,
                    }
                )

        loc_problems.sort(key=lambda p: (p["suppressed"], -p["severity"]))
        loc_status = worst(*(h["status"] for h in hosts_out)) if hosts_out else "unknown"

        locations_out.append(
            {
                "id": loc_key,
                "label": info["label"],
                "status": loc_status,
                "hosts": hosts_out,
                "problems": loc_problems,
            }
        )

    all_hosts = list(all_hosts.values())
    mapped_problems = [p for ps in probs_by_host.values() for p in ps]
    active_problems = [p for p in mapped_problems if not p.get("suppressed")]
    hosts_total = len(all_hosts)
    hosts_healthy = sum(1 for h in all_hosts if h["status"] == "ok")
    ages = [h["last_data_age_seconds"] for h in all_hosts if h["last_data_age_seconds"] is not None]

    summary = {
        "locations_count": len(locations_out),
        "locations_with_problems": sum(1 for loc in locations_out if loc["status"] != "ok"),
        "hosts_count": hosts_total,
        "hosts_healthy": hosts_healthy,
        "hosts_unhealthy": hosts_total - hosts_healthy,
        "hosts_with_problems": sum(1 for h in all_hosts if h["active_problems"] > 0),
        "hosts_stale": sum(1 for h in all_hosts if h["stale"]),
        "health_pct": round(100 * hosts_healthy / hosts_total, 1) if hosts_total else None,
        "active_problems": len(active_problems),
        "acknowledged_problems": sum(1 for p in active_problems if p.get("acknowledged")),
        "suppressed_problems": len(mapped_problems) - len(active_problems),
        "unmapped_problems": unmapped_problems,
        "oldest_data_age_seconds": max(ages) if ages else None,
        "stale_after_seconds": stale_after,
        "latency_ms": latency_ms,
    }
    return {"locations": locations_out, "summary": summary}


def resolve_locations(zc):
    """(host_map, grupos) conforme NOC_GROUP_BY (hostgroup, inventory ou config)."""
    from config import (
        HOST_LOCATION_MAP,
        LOCATIONS,
        NOC_DISCOVERY_TTL,
        NOC_GROUP_BY,
        NOC_HOST_TAG,
        NOC_HOSTGROUP_PREFIX,
    )

    if NOC_GROUP_BY == "config":
        return HOST_LOCATION_MAP, LOCATIONS

    if NOC_GROUP_BY == "hostgroup":
        import groups

        return groups.get_groups(
            fetch_hosts=lambda: zc.get_hosts_with_groups(NOC_HOST_TAG),
            prefix=NOC_HOSTGROUP_PREFIX,
            ttl=NOC_DISCOVERY_TTL,
        )

    import discovery

    return discovery.get_locations(
        fetch_hosts=lambda: zc.get_inventory_hosts(NOC_HOST_TAG),
        fallback_map=HOST_LOCATION_MAP,
        fallback_locations=LOCATIONS,
        ttl=NOC_DISCOVERY_TTL,
    )


def build_snapshot():
    """Busca os dados (Zabbix ou simulação) e devolve o snapshot agregado."""
    from config import NOC_MODE, STALE_AFTER_SECONDS

    now = time.time()

    if NOC_MODE == "demo":
        import demo_source

        return aggregate(**demo_source.generate(now), now=now, stale_after=STALE_AFTER_SECONDS)

    import zabbix_client as zc

    host_map, locations = resolve_locations(zc)

    problems = zc.get_active_problems()  # se falhar, a API devolve erro (sem dados parciais)

    try:
        last_data = zc.get_hosts_last_data()
    except Exception:
        log.exception("falha ao buscar last data; status 'unknown' desativado nesta rodada")
        last_data = None

    try:
        latency_ms = zc.get_api_latency_ms()
    except Exception:
        log.exception("falha ao medir latência do Zabbix")
        latency_ms = None

    return aggregate(
        problems=problems,
        last_data=last_data,
        host_map=host_map,
        locations=locations,
        now=now,
        stale_after=STALE_AFTER_SECONDS,
        latency_ms=latency_ms,
    )
