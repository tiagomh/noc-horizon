"""O modo demo precisa produzir dados válidos e que mudam com o tempo."""

import demo_source
from aggregator import aggregate

T0 = 1_800_000_000  # instante fixo


def snap(now):
    return aggregate(**demo_source.generate(now), now=now, stale_after=600)


def test_todos_os_hosts_pertencem_a_grupos_existentes():
    for groups in demo_source.HOST_MAP.values():
        assert groups and set(groups) <= set(demo_source.LOCATIONS)


def test_todo_grupo_tem_hosts():
    usados = {g for groups in demo_source.HOST_MAP.values() for g in groups}
    assert usados == set(demo_source.LOCATIONS)


def test_snapshot_valido():
    s = snap(T0)
    assert len(s["locations"]) == len(demo_source.LOCATIONS)
    assert s["summary"]["hosts_count"] == len(demo_source.HOST_MAP)
    assert 0 <= s["summary"]["health_pct"] <= 100
    assert s["summary"]["unmapped_problems"] == 1


def test_deterministico_dentro_do_mesmo_minuto():
    a = demo_source.generate(T0 * 1.0)
    b = demo_source.generate(T0 + 30.0)
    assert a["problems"] == b["problems"]


def test_estado_muda_ao_longo_do_tempo():
    estados = {
        tuple(sorted((p["host"], p["name"]) for p in demo_source.generate(T0 + m * 60)["problems"]))
        for m in range(60)
    }
    assert len(estados) > 5


def test_cenarios_especiais_aparecem_em_uma_hora():
    status_vistos = set()
    teve_manutencao = teve_sem_dados = False
    for m in range(60):
        s = snap(T0 + m * 60)
        status_vistos |= {loc["status"] for loc in s["locations"]}
        teve_manutencao |= s["summary"]["suppressed_problems"] > 0
        teve_sem_dados |= s["summary"]["hosts_stale"] > 0
    assert {"ok", "unknown"} <= status_vistos
    assert status_vistos & {"warning", "attention", "critical"}
    assert teve_manutencao and teve_sem_dados


def test_incidentes_do_historico_batem_com_o_estado_atual():
    # Todo problema ativo agora (não suprimido, de host mapeado) existe no histórico
    now = T0 + 1234
    agora = {
        (p["host"], p["name"])
        for p in demo_source.generate(now)["problems"]
        if not p["suppressed"] and p["host"] in demo_source.HOST_MAP
    }
    abertos_ou_recentes = {
        (i["host"], i["name"])
        for i in demo_source.incidents(now, days=1)
        if i["start"] <= now and (i["end"] is None or i["end"] > now)
    }
    assert agora == abertos_ou_recentes
