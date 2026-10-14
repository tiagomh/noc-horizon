// Globo 3D (projeção ortográfica do D3) com auto-rotação, arraste manual,
// linhas de grande círculo entre os nós e partículas viajando nelas.
const InfraMap = (() => {
  let svg, g, projection, path;
  let landGroup, linesGroup, particlesGroup, spiderGroup, nodesGroup;
  let zoom = 1;
  const MAX_ZOOM = 400; // ~1 km na tela já separa um local do outro
  let rotation = [10, -15];
  let autoRotate = true;
  let active = true;
  let resumeTimer = null;
  let resizeTimer = null;
  let currentLocations = [];
  let onNodeClickCallback = null;
  let particles = [];

  function computeDimensions() {
    const rect = svg.node().getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    return { width, height };
  }

  function setup(onWorldLoaded) {
    svg = d3.select("#map");
    const { width, height } = computeDimensions();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const focus = CONFIG.GLOBE_FOCUS;
    if (focus) {
      rotation = [-focus.lon, -focus.lat];
      zoom = clampZoom(focus.zoom || 1);
      autoRotate = !!focus.rotate;
    }
    const scale = (Math.min(width, height) / 2.5) * zoom;
    projection = d3.geoOrthographic()
      .scale(scale)
      .translate([width / 2, height / 2 + 6])
      .clipAngle(90)
      .rotate(rotation);

    path = d3.geoPath(projection);
    g = svg.append("g");

    const defs = svg.append("defs");
    const grad = defs.append("radialGradient")
      .attr("id", "globe-gradient")
      .attr("cx", "35%")
      .attr("cy", "35%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#1c3568");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#050b1c");

    g.append("path")
      .datum({ type: "Sphere" })
      .attr("class", "globe-sphere")
      .attr("fill", "url(#globe-gradient)");

    g.append("path")
      .datum(d3.geoGraticule10())
      .attr("class", "graticule");

    landGroup = g.append("g").attr("class", "land-group");
    linesGroup = g.append("g").attr("class", "lines-group");
    particlesGroup = g.append("g").attr("class", "particles-group");
    spiderGroup = g.append("g").attr("class", "spider-group");
    nodesGroup = g.append("g").attr("class", "nodes-group");

    d3.json(CONFIG.WORLD_ATLAS_URL)
      .then(worldData => {
        const countries = topojson.feature(worldData, worldData.objects.countries);
        landGroup.selectAll("path")
          .data(countries.features)
          .join("path")
          .attr("class", "land");
        onWorldLoaded();
      })
      .catch(err => {
        console.error("Falha ao carregar o mapa-múndi:", err);
        onWorldLoaded();
      });

    setupDrag();
    setupZoom();
    setupResize();
    d3.timer(tick);
  }

  function setupResize() {
    function handleResize() {
      const { width, height } = computeDimensions();
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      const scale = (Math.min(width, height) / 2.5) * zoom;
      projection.scale(scale).translate([width / 2, height / 2 + 6]);
    }

    function debouncedResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 150);
    }

    window.addEventListener("resize", debouncedResize);
  }

  function clampZoom(z) {
    return Math.max(1, Math.min(MAX_ZOOM, z));
  }

  // Só volta a girar sozinho vendo o globo inteiro (ou se o foco pedir rotação).
  function scheduleResume() {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      autoRotate = zoom < 1.5 || !!(CONFIG.GLOBE_FOCUS && CONFIG.GLOBE_FOCUS.rotate);
    }, 4000);
  }

  function setZoom(z) {
    zoom = clampZoom(z);
    const { width, height } = computeDimensions();
    projection.scale((Math.min(width, height) / 2.5) * zoom);
  }

  // Roda do mouse aproxima/afasta; duplo clique volta ao globo inteiro.
  function setupZoom() {
    svg.on("wheel", event => {
      event.preventDefault();
      autoRotate = false;
      setZoom(zoom * Math.exp(-event.deltaY * 0.0015));
      scheduleResume();
    }, { passive: false });
    svg.on("dblclick", () => {
      setZoom(1);
      scheduleResume();
    });
  }

  // Centraliza e aproxima um ponto com animação (clique num agrupamento).
  function flyTo(lon, lat, targetZoom) {
    autoRotate = false;
    const z0 = zoom;
    const rot = d3.interpolate(rotation.slice(), [-lon, -lat]);
    d3.transition().duration(900).tween("fly", () => t => {
      rotation = rot(t);
      projection.rotate(rotation);
      setZoom(z0 * Math.pow(targetZoom / z0, t));
    }).on("end", scheduleResume);
  }

  function setupDrag() {
    svg.call(
      d3.drag()
        .on("start", () => {
          autoRotate = false;
          scheduleResume();
        })
        .on("drag", event => {
          const k = 60 / projection.scale();
          rotation[0] += event.dx * k;
          rotation[1] = Math.max(-90, Math.min(90, rotation[1] - event.dy * k));
          projection.rotate(rotation);
          scheduleResume();
        })
        .on("end", () => {
          scheduleResume();
        })
    );
  }

  function tick() {
    if (!active) return; // globo escondido (mapa 2D em uso): não gasta CPU
    if (autoRotate) {
      rotation[0] += 0.05 / zoom;
      projection.rotate(rotation);
    }
    render();
    NodeLayer.advanceParticles(particles);
  }

  function isFront([lon, lat]) {
    const r = projection.rotate();
    const center = [-r[0], -r[1]];
    return d3.geoDistance([lon, lat], center) < Math.PI / 2;
  }

  function render() {
    g.select(".globe-sphere").attr("d", path);
    g.select(".graticule").attr("d", path);
    landGroup.selectAll("path").attr("d", path);
    drawConnections();
    drawParticlesLayer();
    drawNodes();
  }

  function drawConnections() {
    const lines = NodeLayer.pairs(currentLocations).map(([a, b]) => ({
      type: "LineString",
      coordinates: [[a.lon, a.lat], [b.lon, b.lat]],
      status: NodeLayer.worstOf(a.status, b.status),
    }));

    const sel = linesGroup.selectAll("path").data(lines);
    sel.exit().remove();
    sel.enter()
      .append("path")
      .attr("class", "conn-line")
      .merge(sel)
      .attr("d", path)
      .style("stroke", d => CONFIG.STATUS_COLOR[d.status])
      .style("color", d => CONFIG.STATUS_COLOR[d.status])
      .classed("flow", d => d.status !== "ok");
  }

  function drawParticlesLayer() {
    const visible = particles
      .map(p => {
        const coord = d3.geoInterpolate(p.from, p.to)(p.t);
        return { ...p, coord, front: isFront(coord) };
      })
      .filter(p => p.front);

    const sel = particlesGroup.selectAll("circle").data(visible);
    sel.exit().remove();
    sel.enter()
      .append("circle")
      .attr("class", "particle")
      .attr("r", 2.2)
      .merge(sel)
      .attr("cx", d => projection(d.coord)[0])
      .attr("cy", d => projection(d.coord)[1])
      .style("fill", d => d.color)
      .style("color", d => d.color);
  }

  function drawNodes() {
    const visible = currentLocations.filter(d => isFront([d.lon, d.lat]));
    const { placed, hubs } = NodeLayer.layout(visible, d => projection([d.lon, d.lat]));
    NodeLayer.draw({
      spiderGroup,
      nodesGroup,
      placed,
      hubs,
      onNodeClick: onNodeClickCallback,
      // aproxima até o agrupamento se desfazer (limitado pelo MAX_ZOOM)
      onHubClick: h => flyTo(h.lon, h.lat, Math.min(MAX_ZOOM, zoom * 8)),
    });
  }

  function renderNodes(locations, onNodeClick) {
    currentLocations = locations;
    onNodeClickCallback = onNodeClick;
    particles = NodeLayer.buildParticles(locations);
    render();
  }

  function setActive(value) {
    active = value;
  }

  return { setup, renderNodes, setActive };
})();
