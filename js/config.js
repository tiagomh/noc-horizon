// Única coisa que você deveria precisar editar no frontend.
const CONFIG = {
  API_URL: "/api/locations", // os grupos de hosts (o nome da rota ficou do tempo do mapa)
  POLL_INTERVAL_MS: 15000,
  SLA_URL: "/api/sla",
  ME_URL: "/api/me",
  LOGOUT_TO: "/public/saiu.html",
  SLA_POLL_INTERVAL_MS: 60000,

  // Severidade do Zabbix a partir da qual o problema é "alto" (vermelho).
  // 0 Não classificado, 1 Informação, 2 Atenção, 3 Média, 4 Alta, 5 Desastre
  HIGH_SEVERITY: 4,

  // Cor de cada quadro: alto > baixo > sem dados > ok
  TILE_ORDER: ["ok", "nodata", "low", "high"],
  TILE_COLOR: {
    ok: "var(--ok)",
    low: "var(--warning)",
    high: "var(--critical)",
    nodata: "var(--unknown)",
  },
  TILE_LABEL: {
    ok: "Tudo OK",
    low: "Severidade baixa",
    high: "Severidade alta",
    nodata: "Sem dados",
  },

  SEVERITY_LABEL: ["Não classificado", "Informação", "Atenção", "Média", "Alta", "Desastre"],
};
