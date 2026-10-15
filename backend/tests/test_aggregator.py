"""Testes da lógica de agregação (sem rede, sem Zabbix)."""

import pytest

from aggregator import aggregate, severity_to_status, worst

NOW = 1_000_000
STALE = 600

LOCATIONS = {
    "sp": {"label": "São Paulo", "lat": -23.5, "lon": -46.6},
    "rj": {"label": "Rio", "lat": -22.9, "lon": -43.2},
}
HOST_MAP = {"web1": "sp", "web2": "sp", "db1": "rj", "db2": "rj"}
FRESH = {h: NOW - 30 for h in HOST_MAP}


def prob(host, severity=4, name="Problema", ack=False, suppressed=False):
    return {
        "host": host,
        "name": name,
        "severity": severity,
        "acknowledged": ack,
        "suppressed": suppressed,
    }


def run(problems=(), last_data=FRESH, host_map=HOST_MAP, locations=LOCATIONS):
    return aggregate(list(problems), last_data, host_map, locations, NOW, STALE)


def loc(snapshot, key):
    return next(item for item in snapshot["locations"] if item["id"] == key)


# --- helpers -----------------------------------------------------------------


@pytest.mark.parametrize(
    "sev,expected",
    [
        (0, "warning"),
        (1, "warning"),
        (2, "warning"),
        (3, "attention"),
        (4, "critical"),
        (5, "critical"),
    ],
)
def test_severity_to_status(sev, expected):
    assert severity_to_status(sev) == expected


def test_worst_respeita_ordem_de_gravidade():
    assert worst() == "ok"
    assert worst("ok", "unknown") == "unknown"
    assert worst("unknown", "warning") == "warning"
    assert worst("critical", "warning", "ok") == "critical"


# --- saúde geral --------------------------------------------------------------


def test_tudo_ok():
    s = run()["summary"]
    assert s["health_pct"] == 100.0
    assert s["hosts_unhealthy"] == 0
    assert s["active_problems"] == 0
    assert all(item["status"] == "ok" for item in run()["locations"])


def test_saude_conta_hosts_e_nao_problemas():
    # 5 problemas no MESMO host: só 1 de 4 hosts está com problema -> 75%
    snap = run([prob("web1") for _ in range(5)])
    s = snap["summary"]
    assert s["active_problems"] == 5
    assert s["hosts_with_problems"] == 1
    assert s["health_pct"] == 75.0


def test_problemas_de_hosts_fora_do_mapa_nao_entram_no_total():
    snap = run([prob("web1"), prob("host-desconhecido"), prob(None)])
    s = snap["summary"]
    assert s["active_problems"] == 1
    assert s["unmapped_problems"] == 2


# --- estado "sem dados" (unknown) --------------------------------------------


def test_host_sem_dados_recentes_fica_unknown():
    last = {**FRESH, "db1": NOW - (STALE + 1)}
    snap = run(last_data=last)
    db1 = next(h for h in loc(snap, "rj")["hosts"] if h["host"] == "db1")
    assert db1["status"] == "unknown"
    assert db1["stale"] is True
    assert loc(snap, "rj")["status"] == "unknown"
    assert loc(snap, "sp")["status"] == "ok"
    assert snap["summary"]["hosts_stale"] == 1
    assert snap["summary"]["health_pct"] == 75.0


def test_host_que_nunca_enviou_dados_fica_unknown():
    last = {h: ts for h, ts in FRESH.items() if h != "db2"}
    db2 = next(h for h in loc(run(last_data=last), "rj")["hosts"] if h["host"] == "db2")
    assert db2["status"] == "unknown"
    assert db2["last_data_age_seconds"] is None


def test_problema_grave_prevalece_sobre_unknown():
    last = {**FRESH, "db1": NOW - 99999}
    snap = run([prob("db1", severity=5)], last_data=last)
    assert loc(snap, "rj")["status"] == "critical"


def test_sem_last_data_nao_marca_ninguem_como_unknown():
    # Se a consulta de last data falhar, não pintamos tudo de cinza.
    snap = run(last_data=None)
    assert snap["summary"]["hosts_stale"] == 0
    assert snap["summary"]["health_pct"] == 100.0


def test_idade_do_dado_mais_antigo():
    last = {**FRESH, "web2": NOW - 300}
    assert run(last_data=last)["summary"]["oldest_data_age_seconds"] == 300


# --- reconhecidos e manutenção -----------------------------------------------


def test_problema_em_manutencao_nao_colore_o_local():
    snap = run([prob("web1", severity=5, suppressed=True)])
    assert loc(snap, "sp")["status"] == "ok"
    assert snap["summary"]["active_problems"] == 0
    assert snap["summary"]["suppressed_problems"] == 1
    # mas continua listado no modal
    assert loc(snap, "sp")["problems"][0]["suppressed"] is True


def test_problema_reconhecido_continua_contando():
    snap = run([prob("web1", severity=4, ack=True)])
    assert loc(snap, "sp")["status"] == "critical"
    assert snap["summary"]["active_problems"] == 1
    assert snap["summary"]["acknowledged_problems"] == 1


# --- status do local e ordenação ---------------------------------------------


def test_local_assume_o_pior_status_dos_hosts():
    snap = run([prob("web1", severity=2), prob("web2", severity=3)])
    assert loc(snap, "sp")["status"] == "attention"


def test_problemas_ordenados_por_gravidade_e_manutencao_por_ultimo():
    snap = run(
        [
            prob("web1", severity=2, name="baixo"),
            prob("web1", severity=5, name="manut", suppressed=True),
            prob("web2", severity=4, name="alto"),
        ]
    )
    assert [p["trigger"] for p in loc(snap, "sp")["problems"]] == ["alto", "baixo", "manut"]


def test_local_sem_hosts_fica_unknown():
    locations = {**LOCATIONS, "vazio": {"label": "Vazio", "lat": 0, "lon": 0}}
    assert loc(run(locations=locations), "vazio")["status"] == "unknown"


def test_sem_hosts_saude_e_none():
    snap = run(host_map={}, last_data={})
    assert snap["summary"]["health_pct"] is None


# --- host em vários grupos ----------------------------------------------------


def test_host_em_dois_grupos_aparece_nos_dois_e_conta_uma_vez():
    host_map = {"fw1": ["sp", "rj"], "db1": "rj"}
    snap = run([prob("fw1", severity=4)], last_data={"fw1": NOW, "db1": NOW}, host_map=host_map)
    assert loc(snap, "sp")["status"] == "critical"
    assert loc(snap, "rj")["status"] == "critical"
    assert [p["host"] for p in loc(snap, "rj")["problems"]] == ["fw1"]
    s = snap["summary"]
    assert s["hosts_count"] == 2
    assert s["hosts_with_problems"] == 1
    assert s["active_problems"] == 1


def test_problema_traz_o_inicio():
    p = {**prob("web1"), "clock": NOW - 300}
    assert loc(run([p]), "sp")["problems"][0]["since"] == NOW - 300
    assert loc(run([prob("web1")]), "sp")["problems"][0]["since"] is None
