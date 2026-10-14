// Mapa 2D (Mercator) com zoom: Brasil inteiro até o nível de bairro na Grande
// Florianópolis. Mesmo visual do globo (nós, pulsos, ligações e partículas),
// mais radar, grade de coordenadas, nomes de municípios e régua de escala.
// Os mapas são arquivos locais (data/), sem tiles externos.
const InfraMap2D = (() => {
  const OPT = CONFIG.MAP2D;
  const MIN_K = 0.8;
  const MAX_K = 4000;
  const MUN_SHOW_K = 4; // a partir daqui aparecem as divisas municipais
  const MUN_LABEL_K = 30; // ... e os nomes dos municípios
  const UF_LABEL_MAX_K = 6; // siglas dos estados só com o Brasil inteiro na tela

  let svg, projection, path, zoomBehavior;
  let geoGroup, gridPath, countriesGroup, ufGroup, munGroup;
  let labelsGroup, radarGroup, linesGroup, particlesGroup, spiderGroup, nodesGroup;
  let transform = d3.zoomIdentity;
  let width = 0;
  let height = 0;
  let active = false;
  let ready = false;
  let idleTimer = null;
  let ufLabels = [];
  let munLabels = [];
  let currentLocations = [];
  let onNodeClickCallback = null;
  let particles = [];

  const screen = ([lon, lat]) => transform.apply(projection([lon, lat]));

  function dimensions() {
    const rect = svg.node().getBoundingClientRect();
    return { w: rect.width || window.innerWidth, h: rect.height || window.innerHeight };
  }

  // Área livre da tela (sem o cabeçalho, o card da direita e o rodapé).
  function safeArea() {
    const narrow = width < 900;
    return {
      x0: narrow ? 16 : 40,
      y0: narrow ? 120 : 130,
      x1: width - (narrow ? 16 : 290),
      y1: height - (narrow ? 200 : 90),
    };
  }

  function setup() {
    svg = d3.select("#map2d");
    ({ w: width, h: height } = dimensions());
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    projection = d3.geoMercator();
    path = d3.geoPath(projection);

    const defs = svg.append("defs");
    const sweep = defs.append("linearGradient").attr("id", "radar-sweep")
      .attr("x1", "0").attr("y1", "0").attr("x2", "1").attr("y2", "0");
    sweep.append("stop").attr("offset", "0%").attr("stop-color", "#4d7fd6").attr("stop-opacity", 0);
    sweep.append("stop").attr("offset", "100%").attr("stop-color", "#4d7fd6").attr("stop-opacity", 0.35);

    // Camadas em coordenadas geográficas (seguem o zoom por transform)
    geoGroup = svg.append("g").attr("class", "geo-group");
    countriesGroup = geoGroup.append("g").attr("class", "m2d-countries");
    ufGroup = geoGroup.append("g").attr("class", "m2d-ufs");
    munGroup = geoGroup.append("g").attr("class", "m2d-muns");
    // Camadas em coordenadas de tela (tamanho fixo em qualquer zoom)
    gridPath = svg.append("path").attr("class", "m2d-grid");
    radarGroup = svg.append("g").attr("class", "m2d-radar");
    labelsGroup = svg.append("g").attr("class", "m2d-labels");
    linesGroup = svg.append("g").attr("class", "lines-group");
    particlesGroup = svg.append("g").attr("class", "particles-group");
    spiderGroup = svg.append("g").attr("class", "spider-group");
    nodesGroup = svg.append("g").attr("class", "nodes-group");
    buildRadar();

    zoomBehavior = d3.zoom()
      .scaleExtent([MIN_K, MAX_K])
      .on("zoom", event => {
        transform = event.transform;
        geoGroup.attr("transform", transform);
        onViewChange();
        if (event.sourceEvent) scheduleIdleReturn(); // só interação humana
      });
    svg.call(zoomBehavior);

    Promise.all([
      d3.json(CONFIG.WORLD_ATLAS_URL),
      d3.json(OPT.BRASIL_URL),
      d3.json(OPT.DETALHE_URL),
    ])
      .then(([world, brasil, detalhe]) => {
        const BRASIL_ISO = "076"; // o contorno do IBGE substitui o do mapa-múndi
        const countries = topojson.feature(world, world.objects.countries).features
          .filter(f => String(f.id) !== BRASIL_ISO);
        fitProjection(brasil);

        countriesGroup.selectAll("path").data(countries).join("path").attr("d", path);
        ufGroup.selectAll("path").data(brasil.features).join("path").attr("d", path)
          .classed("detalhe", f => detalhe.features.some(m => String(m.id).startsWith(String(f.id))));
        munGroup.selectAll("path").data(detalhe.features).join("path").attr("d", path)
          .append("title").text(f => f.properties.nome);

        ufLabels = labelsFor(brasil.features, f => f.properties.nome);
        munLabels = labelsFor(detalhe.features, f => f.properties.nome);
        ready = true;
        goToPreset(OPT.DEFAULT_PRESET, 0);
      })
      .catch(err => console.error("Falha ao carregar o mapa 2D:", err));

    window.addEventListener("resize", () => {
      if (active) resize();
    });
    d3.timer(tick);
  }

  function fitProjection(brasil) {
    projection.fitExtent([[0, 0], [width, height]], brasil);
  }

  // Rótulos em coordenadas da projeção-base; ordenados do maior para o menor
  // (os grandes ganham a vaga quando dois nomes disputam o mesmo lugar).
  function labelsFor(features, name) {
    return features
      .map(f => ({ name: name(f), p: path.centroid(f), area: path.area(f) }))
      .filter(l => Number.isFinite(l.p[0]))
      .sort((a, b) => b.area - a.area);
  }

  function resize() {
    const center = projection.invert(transform.invert([width / 2, height / 2]));
    const k = transform.k;
    ({ w: width, h: height } = dimensions());
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    if (!ready) return;
    // mantém o mesmo ponto no centro com o mesmo zoom
    const p = projection(center);
    const t = d3.zoomIdentity.translate(width / 2 - k * p[0], height / 2 - k * p[1]).scale(k);
    svg.call(zoomBehavior.transform, t);
  }

  // Zoom que enquadra [[oeste, sul], [leste, norte]] na área livre da tela.
  function transformForBounds([[w, s], [e, n]], maxK = MAX_K) {
    const a = safeArea();
    const [x0, y0] = projection([w, n]);
    const [x1, y1] = projection([e, s]);
    const k = Math.min(maxK, MAX_K, 0.92 / Math.max((x1 - x0) / (a.x1 - a.x0), (y1 - y0) / (a.y1 - a.y0)));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return d3.zoomIdentity
      .translate((a.x0 + a.x1) / 2 - k * cx, (a.y0 + a.y1) / 2 - k * cy)
      .scale(k);
  }

  function flyTo(t, duration = 1200) {
    if (duration === 0) svg.call(zoomBehavior.transform, t);
    else svg.transition().duration(duration).ease(d3.easeCubicInOut).call(zoomBehavior.transform, t);
  }

  function goToPreset(id, duration) {
    const preset = OPT.PRESETS.find(p => p.id === id) || OPT.PRESETS[0];
    flyTo(transformForBounds(preset.bounds), duration);
    markPreset(preset.id);
  }

  // Enquadra todos os locais (ou os do agrupamento clicado).
  function boundsOf(locs) {
    const lons = locs.map(d => d.lon);
    const lats = locs.map(d => d.lat);
    const pad = 0.01; // ~1 km de folga: dois locais colados ainda se separam
    return [
      [d3.min(lons) - pad, d3.min(lats) - pad],
      [d3.max(lons) + pad, d3.max(lats) + pad],
    ];
  }

  function fitHosts(duration = 1200) {
    if (!currentLocations.length) return;
    flyTo(transformForBounds(boundsOf(currentLocations)), duration);
    markPreset("hosts");
  }

  function markPreset(id) {
    d3.selectAll("#map2d-presets button").classed("active", function () {
      return this.dataset.preset === id;
    });
  }

  // Depois de alguém mexer no mapa, volta sozinho ao foco padrão (modo TV).
  function scheduleIdleReturn() {
    markPreset(null);
    if (!OPT.IDLE_RETURN_SECONDS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => goToPreset(OPT.DEFAULT_PRESET), OPT.IDLE_RETURN_SECONDS * 1000);
  }

  // ---- Elementos que mudam só quando o zoom muda ----

  function onViewChange() {
    const k = transform.k;
    // Com os municípios na tela, o contorno simplificado do estado sai de cena
    // (ele cortaria a ilha de Florianópolis e as baías).
    const showMuns = k >= MUN_SHOW_K;
    munGroup.style("display", showMuns ? null : "none");
    ufGroup.selectAll("path.detalhe").style("display", showMuns ? "none" : null);
    drawGrid();
    drawLabels();
    updateHud();
  }

  // Grade de latitude/longitude com espaçamento "redondo" (~120 px na tela).
  function drawGrid() {
    const [w, n] = projection.invert(transform.invert([0, 0]));
    const [e, s] = projection.invert(transform.invert([width, height]));
    const degPerPx = (e - w) / width;
    const steps = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
    const step = steps.find(st => st / degPerPx < 160) || steps[steps.length - 1];
    const grat = d3.geoGraticule()
      .extent([[Math.floor(w / step) * step, Math.floor(s / step) * step],
        [Math.ceil(e / step) * step, Math.ceil(n / step) * step]])
      .step([step, step])
      .precision(step);
    gridPath.attr("d", d3.geoPath(d3.geoTransform({
      point(lon, lat) {
        const [x, y] = screen([lon, lat]);
        this.stream.point(x, y);
      },
    }))(grat()));
  }

  function drawLabels() {
    const k = transform.k;
    const placed = [];
    const pick = (list, cls, minGap) =>
      list
        .map(l => ({ ...l, s: transform.apply(l.p), cls }))
        .filter(l => l.s[0] > 0 && l.s[0] < width && l.s[1] > 0 && l.s[1] < height)
        .filter(l => {
          if (placed.some(o => Math.abs(o.s[0] - l.s[0]) < minGap && Math.abs(o.s[1] - l.s[1]) < 14)) return false;
          placed.push(l);
          return true;
        });

    let labels = [];
    if (k <= UF_LABEL_MAX_K) labels = pick(ufLabels, "uf-label", 30);
    else if (k >= MUN_LABEL_K) labels = pick(munLabels, "mun-label", 90);

    labelsGroup.selectAll("text")
      .data(labels, l => l.cls + l.name)
      .join("text")
      .attr("class", l => l.cls)
      .attr("text-anchor", "middle")
      .attr("x", l => l.s[0])
      .attr("y", l => l.s[1])
      .text(l => l.name);
  }

  function updateHud() {
    const center = projection.invert(transform.invert([width / 2, height / 2]));
    const coords = document.getElementById("hud-coords");
    if (coords) coords.textContent = `${fmtCoord(center[1], "S", "N")} · ${fmtCoord(center[0], "O", "L")}`;

    // Régua: maior valor "redondo" (1-2-5) que cabe em 120 px
    const a = projection.invert(transform.invert([width / 2, height / 2]));
    const b = projection.invert(transform.invert([width / 2 + 100, height / 2]));
    const kmPer100 = d3.geoDistance(a, b) * 6371;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
      .filter(v => (v / kmPer100) * 100 <= 120)
      .pop() || 0.1;
    const bar = document.getElementById("hud-scale-bar");
    const text = document.getElementById("hud-scale-text");
    if (bar) bar.style.width = `${Math.round((nice / kmPer100) * 100)}px`;
    if (text) text.textContent = nice < 1 ? `${nice * 1000} m` : `${nice} km`;
  }

  function fmtCoord(v, neg, pos) {
    return `${Math.abs(v).toFixed(3)}° ${v < 0 ? neg : pos}`;
  }

  // ---- Radar: anéis e varredura girando sobre o centro dos locais ----

  function buildRadar() {
    [70, 140, 210].forEach(r => radarGroup.append("circle").attr("class", "radar-ring").attr("r", r));
    radarGroup.append("line").attr("class", "radar-axis").attr("x1", -230).attr("x2", 230);
    radarGroup.append("line").attr("class", "radar-axis").attr("y1", -230).attr("y2", 230);
    const r = 210;
    const a = Math.PI / 5; // abertura do feixe
    radarGroup.append("g").attr("class", "radar-sweep")
      .append("path")
      .attr("d", `M0,0 L${r},0 A${r},${r} 0 0,0 ${r * Math.cos(a)},${-r * Math.sin(a)} Z`)
      .attr("fill", "url(#radar-sweep)");
  }

  // Centro do radar: média dos locais que estão na tela.
  function drawRadar(visible) {
    if (!visible.length) {
      radarGroup.style("display", "none");
      return;
    }
    const pts = visible.map(d => screen([d.lon, d.lat]));
    radarGroup.style("display", null)
      .attr("transform", `translate(${d3.mean(pts, p => p[0])},${d3.mean(pts, p => p[1])})`);
  }

  // ---- Elementos animados (a cada quadro) ----

  // Curva suave entre dois pontos da tela (rota "de voo", como no globo).
  function curve([x1, y1], [x2, y2]) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const bend = 0.18;
    return { x1, y1, x2, y2, cx: mx - (y2 - y1) * bend, cy: my + (x2 - x1) * bend };
  }

  function pointOn(c, t) {
    const u = 1 - t;
    return [
      u * u * c.x1 + 2 * u * t * c.cx + t * t * c.x2,
      u * u * c.y1 + 2 * u * t * c.cy + t * t * c.y2,
    ];
  }

  function drawConnections() {
    const lines = NodeLayer.pairs(currentLocations).map(([a, b]) => ({
      c: curve(screen([a.lon, a.lat]), screen([b.lon, b.lat])),
      status: NodeLayer.worstOf(a.status, b.status),
    }));
    linesGroup.selectAll("path")
      .data(lines)
      .join("path")
      .attr("class", "conn-line")
      .attr("d", l => `M${l.c.x1},${l.c.y1} Q${l.c.cx},${l.c.cy} ${l.c.x2},${l.c.y2}`)
      .style("stroke", l => CONFIG.STATUS_COLOR[l.status])
      .style("color", l => CONFIG.STATUS_COLOR[l.status])
      .classed("flow", l => l.status !== "ok");
  }

  function drawParticles() {
    const pts = particles.map(p => ({ ...p, s: pointOn(curve(screen(p.from), screen(p.to)), p.t) }));
    particlesGroup.selectAll("circle")
      .data(pts)
      .join("circle")
      .attr("class", "particle")
      .attr("r", 2.2)
      .attr("cx", p => p.s[0])
      .attr("cy", p => p.s[1])
      .style("fill", p => p.color)
      .style("color", p => p.color);
  }

  function visibleLocations() {
    const margin = 60;
    return currentLocations.filter(d => {
      const [x, y] = screen([d.lon, d.lat]);
      return x > -margin && x < width + margin && y > -margin && y < height + margin;
    });
  }

  function drawNodes(visible) {
    // No mapa os nomes são mais longos que a distância entre os pontos: agrupa
    // com folga maior que no globo para os rótulos não se encavalarem.
    const { placed, hubs } = NodeLayer.layout(visible, d => screen([d.lon, d.lat]), 48);
    NodeLayer.draw({
      spiderGroup,
      nodesGroup,
      placed,
      hubs,
      onNodeClick: onNodeClickCallback,
      onHubClick: h => {
        flyTo(transformForBounds(boundsOf(h.items)));
        scheduleIdleReturn();
      },
    });
  }

  function tick() {
    if (!active || !ready) return;
    const visible = visibleLocations();
    drawRadar(visible);
    drawConnections();
    drawParticles();
    drawNodes(visible);
    NodeLayer.advanceParticles(particles);
  }

  function renderNodes(locations, onNodeClick) {
    currentLocations = locations;
    onNodeClickCallback = onNodeClick;
    particles = NodeLayer.buildParticles(locations);
  }

  function setActive(value) {
    active = value;
    if (active) resize(); // o tamanho pode ter mudado enquanto estava escondido
  }

  return { setup, renderNodes, setActive, goToPreset, fitHosts };
})();
