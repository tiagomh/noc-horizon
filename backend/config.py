import os

# "zabbix" (padrão, produção) ou "demo" (dados simulados, sem Zabbix)
NOC_MODE = os.environ.get("NOC_MODE", "zabbix").strip().lower()
if NOC_MODE not in ("zabbix", "demo"):
    raise RuntimeError(f"NOC_MODE inválido: {NOC_MODE!r} (use 'zabbix' ou 'demo')")

ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
if NOC_MODE == "zabbix" and not (ZABBIX_URL and ZABBIX_API_TOKEN):
    raise RuntimeError("Defina ZABBIX_URL e ZABBIX_API_TOKEN, ou use NOC_MODE=demo")

# Como os hosts são agrupados nos quadros do painel:
#   "hostgroup" -> grupos de hosts do Zabbix (padrão). Um host em vários grupos
#                  aparece em todos eles.
#   "inventory" -> campo "Location" do inventário de cada host (com Latitude e
#                  Longitude preenchidas); hosts sem inventário usam o mapa abaixo
#   "config"    -> HOST_LOCATION_MAP / LOCATIONS abaixo
# NOC_LOCATIONS_FROM é o nome antigo desta variável e continua aceito.
NOC_GROUP_BY = (
    (os.environ.get("NOC_GROUP_BY") or os.environ.get("NOC_LOCATIONS_FROM") or "hostgroup")
    .strip()
    .lower()
)
if NOC_GROUP_BY not in ("hostgroup", "inventory", "config"):
    raise RuntimeError(
        f"NOC_GROUP_BY inválido: {NOC_GROUP_BY!r} (use 'hostgroup', 'inventory' ou 'config')"
    )
# Só grupos de hosts que começam com este prefixo viram quadros; o prefixo sai
# do nome exibido (ex.: NOC_HOSTGROUP_PREFIX="NOC/" -> "NOC/Firewalls" vira "Firewalls").
# Vazio = todos os grupos que tenham hosts monitorados.
NOC_HOSTGROUP_PREFIX = os.environ.get("NOC_HOSTGROUP_PREFIX", "").strip()
# Opcional: só hosts com esta tag no Zabbix entram no painel (ex.: NOC_HOST_TAG=noc)
NOC_HOST_TAG = os.environ.get("NOC_HOST_TAG", "").strip()
# A lista de hosts e grupos é relida a cada N segundos
NOC_DISCOVERY_TTL = int(os.environ.get("NOC_DISCOVERY_TTL", 300))

# Mapa estático de hosts -> grupos. É usado quando NOC_GROUP_BY=config e, no
# modo "inventory", como reserva para hosts sem inventário.
#
#   HOST_LOCATION_MAP: "nome técnico do host no Zabbix" -> chave do grupo
#                      (ou lista de chaves, se o host estiver em vários)
#   LOCATIONS:         chave do grupo -> rótulo (lat/lon são opcionais)
#
# O exemplo abaixo usa o "Zabbix server", que existe em toda instalação do Zabbix.
HOST_LOCATION_MAP = {
    "Zabbix server": "matriz",
    # "web-01": "filial-rj",
}

LOCATIONS = {
    "matriz": {"label": "Matriz (São Paulo, SP)", "lat": -23.5505, "lon": -46.6333},
    # "filial-rj": {"label": "Filial (Rio de Janeiro, RJ)", "lat": -22.9068, "lon": -43.1729},
}

PORT = int(os.environ.get("PORT", 5004))

# Host sem nenhum dado novo há mais que isso aparece como "Sem dados" (unknown).
STALE_AFTER_SECONDS = int(os.environ.get("NOC_STALE_AFTER_SECONDS", 600))

# SLO: meta de disponibilidade (%) e severidade mínima que conta como indisponibilidade
# (Zabbix: 0 Not classified, 1 Information, 2 Warning, 3 Average, 4 High, 5 Disaster)
NOC_SLO_TARGET = float(os.environ.get("NOC_SLO_TARGET", 99.5))
NOC_SLO_MIN_SEVERITY = int(os.environ.get("NOC_SLO_MIN_SEVERITY", 4))
