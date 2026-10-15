"""Cálculo de disponibilidade, orçamento de erro, MTTR e MTTA (sem rede)."""

import demo_source
from sla import DAY, _union_length, compute_sla

NOW = 1_800_000_000
HOST_MAP = {"web1": "sp", "web2": "sp", "db1": "rj"}
LOCATIONS = {
    "sp": {"label": "SP", "lat": 0, "lon": 0},
    "rj": {"label": "RJ", "lat": 0, "lon": 0},
    "vazio": {"label": "Sem hosts", "lat": 0, "lon": 0},
}
W = {"1d": DAY}


def inc(host, start_ago, minutes, severity=4, ack_after=None, open_=False):
    start = NOW - start_ago
    return {
        "host": host,
        "name": "x",
        "severity": severity,
        "start": start,
        "end": None if open_ else start + minutes * 60,
        "ack": start + ack_after if ack_after is not None else None,
    }


def run(incidents, target=99.5, min_severity=4):
    return compute_sla(incidents, HOST_MAP, LOCATIONS, NOW, target, min_severity, W)["windows"][
        "1d"
    ]


def test_union_nao_conta_sobreposicao_e_respeita_a_janela():
    assert _union_length([(0, 10), (5, 15), (20, 30)], 0, 100) == 25
    assert _union_length([(-50, 10)], 0, 100) == 10  # corta o que começou antes da janela
    assert _union_length([], 0, 100) == 0


def test_sem_incidentes_100_por_cento():
    r = run([])
    assert r["availability"] == 100.0
    assert r["error_budget_remaining_pct"] == 100.0
    assert r["mttr_seconds"] is None and r["mtta_seconds"] is None


def test_disponibilidade_por_local_e_media_geral():
    # 144 min = 10% de um dia fora em SP; RJ intacto -> geral 95%
    r = run([inc("web1", 10 * 3600, 144)])
    assert r["locations"] == {"sp": 90.0, "rj": 100.0}
    assert r["availability"] == 95.0


def test_dois_hosts_do_mesmo_local_ao_mesmo_tempo_contam_uma_vez():
    r = run([inc("web1", 10 * 3600, 144), inc("web2", 10 * 3600, 144)])
    assert r["locations"]["sp"] == 90.0


def test_local_sem_hosts_fica_de_fora_da_media():
    assert "vazio" not in run([])["locations"]


def test_severidade_abaixo_do_minimo_nao_conta():
    r = run([inc("web1", 3600, 60, severity=3)])
    assert r["availability"] == 100.0 and r["incidents"] == 0


def test_host_fora_do_mapa_e_ignorado():
    assert run([inc("outro", 3600, 60)])["incidents"] == 0


def test_incidente_aberto_conta_ate_agora():
    r = run([inc("db1", 864 * 10, 0, open_=True)])  # aberto há 8640 s = 10% do dia
    assert r["locations"]["rj"] == 90.0
    assert r["open_incidents"] == 1
    assert r["mttr_seconds"] is None  # não resolvido não entra no MTTR


def test_mttr_e_mtta():
    r = run(
        [
            inc("web1", 7200, 10, ack_after=60),
            inc("db1", 3600, 20, ack_after=180),
            inc("web2", 1800, 30),  # nunca reconhecido
        ]
    )
    assert r["mttr_seconds"] == 20 * 60  # média de 10, 20, 30 min
    assert r["mtta_seconds"] == 120  # média de 60 s e 180 s
    assert r["incidents"] == 3


def test_orcamento_de_erro():
    # meta 99%: em 1 dia o permitido é 864 s. Gastou 432 s em SP (geral 99,75%)
    r = run([inc("web1", 3600, 7.2)], target=99.0)
    assert r["allowed_downtime_seconds"] == 864
    assert r["availability"] == 99.75
    assert r["error_budget_remaining_pct"] == 75.0


def test_orcamento_nunca_fica_negativo():
    r = run([inc("web1", 10 * 3600, 600)], target=99.9)
    assert r["error_budget_remaining_pct"] == 0.0


def test_incidente_antes_da_janela_nao_entra_na_contagem():
    r = run([inc("web1", 2 * DAY, 10)])
    assert r["incidents"] == 0 and r["availability"] == 100.0


def test_demo_tem_numeros_plausiveis():
    now = 1_800_000_000
    data = compute_sla(
        demo_source.incidents(now, 30),
        demo_source.HOST_MAP,
        demo_source.LOCATIONS,
        now,
        99.5,
        4,
    )
    for window in data["windows"].values():
        # grupos pequenos e links WAN instáveis de propósito: ~97-99%
        assert 95.0 < window["availability"] <= 100.0
        assert window["incidents"] > 0
        assert window["mtta_seconds"] == 60


def test_host_em_varios_grupos_derruba_todos():
    host_map = {"fw1": ["a", "b"]}
    locations = {"a": {"label": "A"}, "b": {"label": "B"}}
    inc = {"host": "fw1", "name": "x", "severity": 4, "start": 0, "end": 3600, "ack": None}
    out = compute_sla(
        [inc], host_map, locations, now=86400, target=99.5, min_severity=4, windows={"1d": 86400}
    )
    by = out["windows"]["1d"]["locations"]
    assert by["a"] == by["b"] < 100
