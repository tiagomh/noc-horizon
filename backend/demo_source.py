"""
Fonte de dados de DEMONSTRAÇÃO — simula um Zabbix com grupos de hosts.

Usada quando NOC_MODE=demo: permite rodar o NOC Horizon sem nenhum Zabbix.
Como num Zabbix real, cada host está em dois grupos: o do site (ex.: "Filial
São José") e o da função (ex.: "Firewalls").
Os dados são determinísticos por minuto (todos os workers e navegadores veem
o mesmo estado) e evoluem com o tempo: problemas surgem, são reconhecidos e
resolvidos; um host entra em manutenção; outro às vezes para de enviar dados.
"""

import hashlib
import math

_SITES = {
    "floripa-dc": (
        "Datacenter Florianópolis",
        ["web-01", "web-02", "db-01", "db-02", "fw-01", "sw-01", "wan-01"],
    ),
    "sao-jose": ("Filial São José", ["web-01", "db-01", "fw-01", "sw-01", "wan-01"]),
    "palhoca": ("CD Palhoça", ["wms-01", "fw-01", "sw-01", "wan-01"]),
    "biguacu": ("Loja Biguaçu", ["fw-01", "wan-01"]),
    "sao-paulo": ("Escritório São Paulo", ["web-01", "fw-01", "wan-01"]),
}

_ROLE_GROUPS = {
    "web": "Aplicações Web",
    "wms": "Aplicações Web",
    "db": "Banco de Dados",
    "fw": "Firewalls",
    "sw": "Switches",
    "wan": "Links WAN",
}

LOCATIONS = {key: {"label": label} for key, (label, _) in _SITES.items()}
LOCATIONS.update(
    {f"grupo-{role}": {"label": label} for role, label in _ROLE_GROUPS.items() if role != "wms"}
)


def _role_group(role):
    kind = role.split("-")[0]
    return "grupo-web" if kind == "wms" else f"grupo-{kind}"


HOST_MAP = {
    f"{site}-{role}": [site, _role_group(role)]
    for site, (_, roles) in _SITES.items()
    for role in roles
}

# (nome do trigger, severidade Zabbix 0-5)
_SCENARIOS = [
    ("Linux: High CPU utilization (over 90% for 5m)", 3),
    ("Linux: FS [/]: Space is low (used > 80%)", 2),
    ("Linux: FS [/]: Space is critically low (used > 90%)", 3),
    ("Linux: High memory utilization (>90% for 5m)", 3),
    ("Linux: High swap space usage (less than 50% free)", 2),
    ("Nginx: Service is down", 4),
    ("PostgreSQL: Too many connections (over 90% of max)", 3),
    ("Redis: Memory fragmentation ratio is too high", 1),
    ("ICMP: High ICMP ping loss", 2),
    ("ICMP: Unavailable by ICMP ping", 5),
    ("Certificate: SSL certificate expires in less than 7 days", 2),
    ("Linux: Zabbix agent is not available (for 3m)", 4),
]

_MAINTENANCE_HOST = "palhoca-wms-01"
_FLAKY_HOST = "biguacu-wan-01"


def _h(*parts) -> int:
    """Hash estável (não usa hash() do Python, que muda a cada processo)."""
    raw = "|".join(str(p) for p in parts).encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


_CRITICAL = [sc for sc in _SCENARIOS if sc[1] >= 4]
_NORMAL = [sc for sc in _SCENARIOS if sc[1] < 4]


def _recurrence(host):
    """(seed, período, duração) em minutos, ou None se o host não tem incidentes."""
    seed = _h(host)
    if seed % 3 != 0:  # ~1/3 dos hosts têm incidentes recorrentes
        return None
    return seed, 7 + seed % 13, 2 + seed % 4  # período 7-19 min, duração 2-5 min


def _scenario(host, episode):
    """Cenário de um episódio. Incidentes graves (High/Disaster) são ~4%; nos
    links WAN, ~1 em 3 (link caído aparece em vermelho com frequência na demo)."""
    k = _h(host, episode)
    grave = k % 25 == 0 or ("-wan-" in host and k % 3 == 0)
    pool = _CRITICAL if grave else _NORMAL
    return pool[k % len(pool)]


def incidents(now: float, days: int = 30) -> list[dict]:
    """Histórico de incidentes simulados (mesmo formato de zabbix_client.get_incidents)."""
    now_min = int(now // 60)
    lo_min = now_min - days * 1440
    out = []
    for host in HOST_MAP:
        rec = _recurrence(host)
        if rec is None:
            continue
        seed, period, duration = rec
        for episode in range((lo_min + seed) // period, (now_min + seed) // period + 1):
            start_min = episode * period - seed
            if start_min > now_min:
                break
            name, severity = _scenario(host, episode)
            start = start_min * 60
            end = (start_min + duration) * 60
            out.append(
                {
                    "host": host,
                    "name": name,
                    "severity": severity,
                    "start": start,
                    "end": end if end <= now else None,
                    "ack": start + 60 if start + 60 <= now else None,
                }
            )
    return out


def generate(now: float) -> dict:
    """Devolve os argumentos de `aggregate()` para o instante `now`."""
    minute = int(now // 60)
    problems = []
    last_data = {}

    for host in HOST_MAP:
        seed = _h(host)
        last_data[host] = now - (seed % 45)  # dado recebido há 0-44 s

        rec = _recurrence(host)
        if rec is not None:
            _, period, duration = rec
            phase = (minute + seed) % period
            if phase < duration:
                episode = (minute + seed) // period
                name, severity = _scenario(host, episode)
                problems.append(
                    {
                        "host": host,
                        "name": name,
                        "severity": severity,
                        "acknowledged": phase >= 1,  # alguém reconhece após 1 min
                        "suppressed": False,
                        "clock": (minute - phase) * 60,
                    }
                )

    # Janela de manutenção: 10 min a cada 30 — problema existe mas não colore.
    if minute % 30 < 10:
        problems.append(
            {
                "host": _MAINTENANCE_HOST,
                "name": "Linux: Zabbix agent is not available (for 3m)",
                "severity": 4,
                "acknowledged": False,
                "suppressed": True,
                "clock": (minute - minute % 30) * 60,
            }
        )

    # Host que para de enviar dados por 5 min a cada 20 — vira "Sem dados".
    if minute % 20 < 5:
        last_data[_FLAKY_HOST] = now - 900

    # Problema de host fora dos grupos do painel (conta em unmapped_problems).
    problems.append(
        {
            "host": "legacy-printer-01",
            "name": "Toner baixo",
            "severity": 1,
            "acknowledged": False,
            "suppressed": False,
            "clock": (minute - minute % 1440) * 60,
        }
    )

    latency_ms = round(18 + 8 * math.sin(now / 37) + (_h(minute) % 7), 1)

    return {
        "problems": problems,
        "last_data": last_data,
        "host_map": HOST_MAP,
        "locations": LOCATIONS,
        "latency_ms": latency_ms,
    }
