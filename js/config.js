// Única coisa que você deveria precisar editar no frontend.
const CONFIG = {
  API_URL: "/api/locations",
  POLL_INTERVAL_MS: 15000,
  SLA_URL: "/api/sla",
  ME_URL: "/api/me",
  LOGOUT_TO: "/public/saiu.html",
  SLA_POLL_INTERVAL_MS: 60000,
  WORLD_ATLAS_URL: "data/countries-110m.json",

  // Foco inicial do globo. null = globo inteiro girando.
  // Para hosts concentrados numa região (ex.: Grande Florianópolis):
  //   GLOBE_FOCUS: { lat: -27.62, lon: -48.62, zoom: 60, rotate: false },
  // Roda do mouse aproxima/afasta; duplo clique volta ao globo inteiro.
  GLOBE_FOCUS: null,

  // Visão inicial: "globe" (globo 3D) ou "map2d" (mapa do Brasil com zoom).
  // A URL tem prioridade: http://noc/#mapa ou http://noc/#globo (útil na TV).
  DEFAULT_VIEW: "globe",

  // Mapa 2D. Os mapas vêm do IBGE (tools/gerar_mapa_brasil.py) e são servidos
  // pelo próprio NOC Horizon. bounds = [[oeste, sul], [leste, norte]].
  MAP2D: {
    BRASIL_URL: "data/brasil-uf.json",
    DETALHE_URL: "data/sc-municipios.json",
    DEFAULT_PRESET: "grande-florianopolis",
    // Depois de alguém mexer no mapa, volta ao foco padrão (0 = nunca)
    IDLE_RETURN_SECONDS: 120,
    PRESETS: [
      { id: "brasil", label: "Brasil", bounds: [[-74.0, -33.8], [-34.8, 5.3]] },
      { id: "sc", label: "Santa Catarina", bounds: [[-53.9, -29.4], [-48.3, -25.9]] },
      { id: "grande-florianopolis", label: "Grande Florianópolis", bounds: [[-48.78, -27.78], [-48.40, -27.42]] },
    ],
  },

  STATUS_ORDER: ["ok", "unknown", "warning", "attention", "critical"],

  STATUS_COLOR: {
    ok: "var(--ok)",
    unknown: "var(--unknown)",
    warning: "var(--warning)",
    attention: "var(--attention)",
    critical: "var(--critical)",
  },

  STATUS_LABEL: {
    ok: "Saudável",
    unknown: "Sem dados",
    warning: "Atenção",
    attention: "Alerta",
    critical: "Crítico",
  },
};
