"""
Cliente fino para a API JSON-RPC do Zabbix.
Não sabe nada sobre localizações ou mapa — só fala com o Zabbix.
"""

import time

import requests

from config import ZABBIX_API_TOKEN, ZABBIX_URL


def _call(method: str, params: dict, authenticated: bool = True) -> dict:
    headers = {"Content-Type": "application/json-rpc"}
    if authenticated:
        headers["Authorization"] = f"Bearer {ZABBIX_API_TOKEN}"
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    }
    res = requests.post(ZABBIX_URL, json=payload, headers=headers, timeout=15)
    res.raise_for_status()
    data = res.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]


def get_active_problems() -> list[dict]:
    """Retorna os problemas ativos, cada um com host, nome e severidade.

    A partir do Zabbix 7.0, problem.get não aceita mais "selectHosts".
    O "objectid" do problema é o ID do trigger que o gerou, então
    buscamos os hosts separadamente via trigger.get.
    """
    problems = _call(
        "problem.get",
        {
            "output": ["objectid", "clock", "name", "severity", "acknowledged", "suppressed"],
            "recent": False,
        },
    )

    trigger_ids = list({p["objectid"] for p in problems if p.get("objectid")})
    host_by_trigger = {}
    if trigger_ids:
        triggers = _call(
            "trigger.get",
            {
                "output": ["triggerid"],
                "triggerids": trigger_ids,
                "selectHosts": ["host"],
            },
        )
        for t in triggers:
            hosts = t.get("hosts", [])
            host_by_trigger[t["triggerid"]] = hosts[0]["host"] if hosts else None

    result = []
    for p in problems:
        result.append(
            {
                "host": host_by_trigger.get(p.get("objectid")),
                "name": p.get("name"),
                "severity": int(p.get("severity", 0)),
                "acknowledged": p.get("acknowledged") == "1",
                "suppressed": p.get("suppressed") == "1",
                "clock": int(p.get("clock") or 0),
            }
        )
    return result


def get_api_latency_ms() -> float:
    """Mede o round-trip da API do Zabbix com uma chamada leve (sem auth)."""
    start = time.time()
    _call("apiinfo.version", {}, authenticated=False)
    return round((time.time() - start) * 1000, 1)


def get_hosts_last_data() -> dict:
    """
    Retorna, por host, o timestamp (lastclock) do dado mais recente
    coletado pelo Zabbix. Usado pra calcular o "frescor" dos dados.
    """
    items = _call(
        "item.get",
        {
            "output": ["hostid", "lastclock"],
            "selectHosts": ["host"],
            "monitored": True,
        },
    )

    last_by_host = {}
    for item in items:
        hosts = item.get("hosts", [])
        if not hosts:
            continue
        host_name = hosts[0]["host"]
        lastclock = int(item.get("lastclock") or 0)
        if lastclock > last_by_host.get(host_name, 0):
            last_by_host[host_name] = lastclock
    return last_by_host


def get_inventory_hosts(tag: str = "") -> list[dict]:
    """
    Hosts monitorados com os campos de localização do inventário.
    Requer o método host.get liberado no papel (role) do usuário da API.
    """
    params = {
        "output": ["host", "name"],
        "selectInventory": ["location", "location_lat", "location_lon"],
        "monitored_hosts": True,
    }
    if tag:
        params["tags"] = [{"tag": tag, "operator": 4}]  # 4 = a tag existe
    return _call("host.get", params)


def get_hosts_with_groups(tag: str = "") -> list[dict]:
    """
    Hosts monitorados com os nomes dos seus grupos de hosts.
    Requer o método host.get liberado no papel (role) do usuário da API.
    Retorna [{"host", "name", "groups": [nome, ...]}].
    """
    params = {"output": ["host", "name"], "monitored_hosts": True}
    if tag:
        params["tags"] = [{"tag": tag, "operator": 4}]  # 4 = a tag existe
    try:
        hosts = _call("host.get", {**params, "selectHostGroups": ["name"]})  # Zabbix >= 6.2
        key = "hostgroups"
    except RuntimeError:
        hosts = _call("host.get", {**params, "selectGroups": ["name"]})  # Zabbix < 6.2
        key = "groups"
    return [
        {"host": h["host"], "name": h.get("name"), "groups": [g["name"] for g in h.get(key, [])]}
        for h in hosts
    ]


def get_incidents(time_from: float) -> list[dict]:
    """
    Problemas (eventos de trigger) desde `time_from`, com início, fim e primeiro
    reconhecimento. Requer o método event.get no papel (role) do usuário da API.
    Retorna [{"host", "name", "severity", "start", "end"|None, "ack"|None}].
    """
    events = _call(
        "event.get",
        {
            "output": ["eventid", "clock", "r_eventid", "severity", "name", "suppressed"],
            "source": 0,  # triggers
            "object": 0,
            "value": 1,  # eventos de PROBLEMA (a recuperação vem pelo r_eventid)
            "time_from": int(time_from),
            "selectHosts": ["host"],
            "select_acknowledges": ["clock", "action"],
            "sortfield": ["clock"],
            "sortorder": "ASC",
            "limit": 20000,
        },
    )

    recovery_ids = [ev["r_eventid"] for ev in events if ev.get("r_eventid") not in (None, "0")]
    recovered_at = {}
    for i in range(0, len(recovery_ids), 1000):
        chunk = recovery_ids[i : i + 1000]
        for ev in _call("event.get", {"output": ["eventid", "clock"], "eventids": chunk}):
            recovered_at[ev["eventid"]] = int(ev["clock"])

    result = []
    for ev in events:
        hosts = ev.get("hosts") or []
        if not hosts or ev.get("suppressed") == "1":  # manutenção não conta
            continue
        acks = [
            int(a["clock"])
            for a in ev.get("acknowledges", [])
            if int(a.get("action", 0)) & 2  # bit 2 = "acknowledge"
        ]
        result.append(
            {
                "host": hosts[0]["host"],
                "name": ev.get("name"),
                "severity": int(ev.get("severity", 0)),
                "start": int(ev["clock"]),
                "end": recovered_at.get(ev.get("r_eventid")),
                "ack": min(acks) if acks else None,
            }
        )
    return result
