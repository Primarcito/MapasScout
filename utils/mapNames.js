const STATUS_PREFIX_RE = /^(?:(?:🚨|⚠️?|🔴|🟢|🟡|🔵|📍|🗺️)\s*)+/u;

function normalizarNombreMapa(value) {
  const limpio = String(value || "")
    .trim()
    .replace(STATUS_PREFIX_RE, "")
    .replace(/^[•·]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");

  return limpio.replace(/(^|[\s'’-])([\p{L}\p{N}])/gu, (_, separador, letra) => (
    `${separador}${letra.toLocaleUpperCase("es")}`
  ));
}

function normalizarListaMapas(lista) {
  const unicos = new Map();
  for (const value of Array.isArray(lista) ? lista : []) {
    const mapa = normalizarNombreMapa(value);
    if (mapa) unicos.set(mapa.toLocaleLowerCase("es"), mapa);
  }
  return [...unicos.values()];
}

function normalizarMapasPorCiudad(mapas) {
  const resultado = {};
  for (const [ciudad, lista] of Object.entries(mapas || {})) {
    resultado[ciudad] = normalizarListaMapas(lista);
  }
  return resultado;
}

function normalizarRegistros(registros) {
  const resultado = {};
  for (const [ciudad, porMapa] of Object.entries(registros || {})) {
    resultado[ciudad] = {};
    for (const [nombre, usuarios] of Object.entries(porMapa || {})) {
      const mapa = normalizarNombreMapa(nombre);
      if (!mapa) continue;
      const actuales = resultado[ciudad][mapa] || [];
      resultado[ciudad][mapa] = [...new Set([...actuales, ...(Array.isArray(usuarios) ? usuarios : [])])];
    }
  }
  return resultado;
}

function normalizarReferenciasMapas(lista) {
  const unicos = new Map();
  for (const entrada of Array.isArray(lista) ? lista : []) {
    if (!entrada?.ciudad) continue;
    const mapa = normalizarNombreMapa(entrada.mapa);
    if (!mapa) continue;
    const normalizada = { ...entrada, mapa };
    unicos.set(`${entrada.ciudad}__${mapa}`.toLocaleLowerCase("es"), normalizada);
  }
  return [...unicos.values()];
}

function normalizarAlertasMapas(alertas) {
  const resultado = {};
  for (const alerta of Object.values(alertas || {})) {
    if (!alerta?.ciudad) continue;
    const mapa = normalizarNombreMapa(alerta.mapa);
    if (!mapa) continue;
    const key = `${alerta.ciudad}__${mapa}`;
    const vacioDesde = Number(alerta.vacioDesde) || Date.now();
    if (!resultado[key] || vacioDesde < resultado[key].vacioDesde) {
      resultado[key] = { ciudad: alerta.ciudad, mapa, vacioDesde };
    }
  }
  return resultado;
}

module.exports = {
  normalizarNombreMapa,
  normalizarListaMapas,
  normalizarMapasPorCiudad,
  normalizarRegistros,
  normalizarReferenciasMapas,
  normalizarAlertasMapas,
};
