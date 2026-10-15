"""
Quadros do painel a partir dos GRUPOS DE HOSTS do Zabbix (NOC_GROUP_BY=hostgroup).

- cada grupo de hosts com hosts monitorados vira um quadro;
- um host em vários grupos aparece em todos eles;
- com NOC_HOSTGROUP_PREFIX (ex.: "NOC/"), só os grupos com esse prefixo entram
  e o prefixo sai do nome exibido;
- a lista fica em cache (grupos mudam pouco) e, se o Zabbix falhar, a última
  lista boa continua sendo usada.
"""

import logging
import time

from discovery import _slug

log = logging.getLogger(__name__)


def build_groups(hosts, prefix=""):
    """
    hosts: [{"host", "name", "groups": [nome do grupo, ...]}]
    Retorna (host_map, groups): host -> [chaves], chave -> {"label"}.
    """
    host_map = {}
    groups = {}
    for h in hosts:
        keys = []
        for name in h.get("groups", []):
            if prefix and not name.startswith(prefix):
                continue
            label = name[len(prefix) :].strip() or name
            key = _slug(label)
            groups.setdefault(key, {"label": label})
            if key not in keys:
                keys.append(key)
        if keys:
            host_map[h["host"]] = keys
    return host_map, dict(sorted(groups.items(), key=lambda kv: kv[1]["label"].lower()))


_cache = {"t": 0.0, "data": None}


def get_groups(fetch_hosts, prefix, ttl, now=None):
    """(host_map, groups) com cache de `ttl` segundos."""
    now = time.monotonic() if now is None else now
    if _cache["data"] is not None and now - _cache["t"] < ttl:
        return _cache["data"]
    try:
        data = build_groups(fetch_hosts(), prefix)
    except Exception:
        if _cache["data"] is None:
            raise  # sem lista anterior: a API responde erro
        log.exception("falha ao ler os grupos de hosts; usando a última lista boa")
        return _cache["data"]
    _cache.update(t=now, data=data)
    return data
