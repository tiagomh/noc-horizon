"""Conversão das respostas da API do Zabbix (sem rede: _call é substituído)."""

import zabbix_client


def fake_call(responses):
    def _call(method, params, authenticated=True):
        key = "recovery" if method == "event.get" and "eventids" in params else method
        return responses[key]

    return _call


def test_get_incidents(monkeypatch):
    responses = {
        "event.get": [
            {  # resolvido e reconhecido (ação 2 = acknowledge; 4 = só mensagem)
                "eventid": "10",
                "clock": "1000",
                "r_eventid": "11",
                "severity": "4",
                "name": "Nginx down",
                "suppressed": "0",
                "hosts": [{"host": "web1"}],
                "acknowledges": [
                    {"clock": "1200", "action": "4"},
                    {"clock": "1100", "action": "6"},
                ],
            },
            {  # ainda aberto
                "eventid": "20",
                "clock": "2000",
                "r_eventid": "0",
                "severity": "5",
                "name": "Host down",
                "suppressed": "0",
                "hosts": [{"host": "db1"}],
                "acknowledges": [],
            },
            {  # em manutenção -> ignorado
                "eventid": "30",
                "clock": "3000",
                "r_eventid": "0",
                "severity": "4",
                "name": "x",
                "suppressed": "1",
                "hosts": [{"host": "db1"}],
                "acknowledges": [],
            },
            {  # sem host (ex.: trigger de outro tipo) -> ignorado
                "eventid": "40",
                "clock": "4000",
                "r_eventid": "0",
                "severity": "4",
                "name": "y",
                "suppressed": "0",
                "hosts": [],
                "acknowledges": [],
            },
        ],
        "recovery": [{"eventid": "11", "clock": "1500"}],
    }
    monkeypatch.setattr(zabbix_client, "_call", fake_call(responses))

    result = zabbix_client.get_incidents(0)

    assert result == [
        {
            "host": "web1",
            "name": "Nginx down",
            "severity": 4,
            "start": 1000,
            "end": 1500,
            "ack": 1100,
        },
        {
            "host": "db1",
            "name": "Host down",
            "severity": 5,
            "start": 2000,
            "end": None,
            "ack": None,
        },
    ]


def test_get_inventory_hosts_envia_filtro_de_tag(monkeypatch):
    sent = {}

    def _call(method, params, authenticated=True):
        sent.update(method=method, params=params)
        return []

    monkeypatch.setattr(zabbix_client, "_call", _call)
    zabbix_client.get_inventory_hosts("noc")
    assert sent["method"] == "host.get"
    assert sent["params"]["tags"] == [{"tag": "noc", "operator": 4}]


def test_get_hosts_with_groups(monkeypatch):
    def _call(method, params, authenticated=True):
        assert params["selectHostGroups"] == ["name"]
        return [{"host": "web1", "name": "Web 1", "hostgroups": [{"name": "A"}, {"name": "B"}]}]

    monkeypatch.setattr(zabbix_client, "_call", _call)
    assert zabbix_client.get_hosts_with_groups() == [
        {"host": "web1", "name": "Web 1", "groups": ["A", "B"]}
    ]


def test_get_hosts_with_groups_zabbix_antigo_usa_select_groups(monkeypatch):
    def _call(method, params, authenticated=True):
        if "selectHostGroups" in params:
            raise RuntimeError({"code": -32602, "message": "Invalid params."})
        return [{"host": "db1", "name": "db1", "groups": [{"name": "Banco"}]}]

    monkeypatch.setattr(zabbix_client, "_call", _call)
    assert zabbix_client.get_hosts_with_groups()[0]["groups"] == ["Banco"]
