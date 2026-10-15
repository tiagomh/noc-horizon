"""Quadros a partir dos grupos de hosts do Zabbix."""

import pytest

import groups


@pytest.fixture(autouse=True)
def limpa_cache():
    groups._cache.update(t=0.0, data=None)


HOSTS = [
    {"host": "fw1", "name": "fw1", "groups": ["NOC/Firewalls", "NOC/Florianópolis"]},
    {"host": "db1", "name": "db1", "groups": ["NOC/Banco de Dados", "Linux servers"]},
    {"host": "printer", "name": "printer", "groups": ["Impressoras"]},
]


def test_host_em_varios_grupos_aparece_em_todos():
    host_map, grps = groups.build_groups(HOSTS)
    assert host_map["fw1"] == ["noc-firewalls", "noc-florianopolis"]
    assert grps["noc-firewalls"] == {"label": "NOC/Firewalls"}
    assert len(grps) == 5


def test_prefixo_filtra_e_sai_do_nome():
    host_map, grps = groups.build_groups(HOSTS, prefix="NOC/")
    assert host_map == {"fw1": ["firewalls", "florianopolis"], "db1": ["banco-de-dados"]}
    assert [g["label"] for g in grps.values()] == ["Banco de Dados", "Firewalls", "Florianópolis"]
    assert "printer" not in host_map  # fora dos grupos do NOC


def test_cache_e_ultima_lista_boa_quando_o_zabbix_falha():
    calls = []

    def fetch():
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError("zabbix fora")
        return HOSTS

    first = groups.get_groups(fetch, "", ttl=300, now=0)
    assert groups.get_groups(fetch, "", ttl=300, now=100) is first  # cache
    assert groups.get_groups(fetch, "", ttl=300, now=1000) is first  # falhou: última boa
    assert len(calls) == 2


def test_sem_cache_e_zabbix_fora_propaga_o_erro():
    def fetch():
        raise RuntimeError("zabbix fora")

    with pytest.raises(RuntimeError):
        groups.get_groups(fetch, "", ttl=300, now=0)
