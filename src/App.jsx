import { useEffect, useMemo, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { FlyToInterpolator } from '@deck.gl/core'
import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import Map from 'react-map-gl/maplibre'
import { obtenerEstaciones } from './supabaseClient'

// ---------------- Configuración ----------------
const MAPA_BASE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' // gratis, sin token
const VISTA_INICIAL = { longitude: -58.585, latitude: -34.47, zoom: 11.2, pitch: 0, bearing: 0 }
const TIGRE_CENTRO = { lat: -34.4255, lon: -58.5797 } // ejemplo si no hay ubicación
const LEJOS_KM = 15 // más lejos que esto de cualquier estación = fuera de Zona Norte
const RADIOS = [3, 5, 10]

const COMBUSTIBLES = {
  super: { nombre: 'Súper', campo: 'precio_super' },
  premium: { nombre: 'Premium', campo: 'precio_premium' },
}

const CATEGORIAS = [
  { nombre: 'Barata', color: [26, 150, 65] },
  { nombre: 'Precio medio', color: [235, 170, 20] },
  { nombre: 'Cara', color: [215, 48, 39] },
]
const AZUL = [37, 99, 235]
const DORADO = [224, 164, 0]

const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

// ---------------- Utilidades ----------------
function distanciaKm(a, b) {
  const R = 6371
  const rad = (x) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const textoKm = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace('.', ',')} km`)

// ---------------- App ----------------
export default function App() {
  const [estaciones, setEstaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [combustible, setCombustible] = useState(null) // null hasta que el usuario elige
  const [yo, setYo] = useState(null) // { lat, lon }
  const [radioKm, setRadioKm] = useState(5)
  const [aviso, setAviso] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [pedirNafta, setPedirNafta] = useState(false)
  const [vista, setVista] = useState(VISTA_INICIAL)

  // 1) Traer los datos de Supabase
  useEffect(() => {
    obtenerEstaciones()
      .then(setEstaciones)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  // 2) Estaciones con el precio del combustible elegido (súper por defecto antes de elegir)
  const tipo = combustible ?? 'super'
  const lista = useMemo(() => {
    const campo = COMBUSTIBLES[tipo].campo
    return estaciones.filter((e) => e[campo] != null).map((e) => ({ ...e, precio: e[campo] }))
  }, [estaciones, tipo])

  // 3) Cortes de categoría: un tercio de las estaciones en cada color
  const cortes = useMemo(() => {
    const p = lista.map((e) => e.precio).sort((a, b) => a - b)
    if (!p.length) return [0, 0]
    return [p[Math.floor(p.length / 3)], p[Math.floor((p.length * 2) / 3)]]
  }, [lista])

  const categoriaDe = (precio) => (precio < cortes[0] ? CATEGORIAS[0] : precio < cortes[1] ? CATEGORIAS[1] : CATEGORIAS[2])

  // 4) Indicadores del dashboard (calculados con los datos de Supabase)
  const kpis = useMemo(() => {
    if (!lista.length) return null
    const barata = lista.reduce((a, b) => (b.precio < a.precio ? b : a))
    const cara = lista.reduce((a, b) => (b.precio > a.precio ? b : a))
    const promedio = lista.reduce((s, e) => s + e.precio, 0) / lista.length
    return { total: lista.length, promedio, barata, cara }
  }, [lista])

  // 5) Estaciones dentro del radio, ordenadas de la más barata a la más cara
  const cercanas = useMemo(() => {
    if (!yo) return []
    return lista
      .map((e) => ({ ...e, dist: distanciaKm(yo, { lat: e.latitud, lon: e.longitud }) }))
      .filter((e) => e.dist <= radioKm)
      .sort((a, b) => a.precio - b.precio || a.dist - b.dist)
  }, [lista, yo, radioKm])

  const masCercana = useMemo(() => {
    if (!yo || !lista.length) return null
    return lista
      .map((e) => ({ ...e, dist: distanciaKm(yo, { lat: e.latitud, lon: e.longitud }) }))
      .sort((a, b) => a.dist - b.dist)[0]
  }, [lista, yo])

  const mejor = cercanas[0]
  const promedioCerca = cercanas.length ? cercanas.reduce((s, e) => s + e.precio, 0) / cercanas.length : 0

  // ---------------- Acciones ----------------
  const [origen, setOrigen] = useState(null) // de dónde salió tu ubicación: 'gps', 'mapa' o 'ejemplo'
  const [elegida, setElegida] = useState(null) // id de la estación que tocaste

  function volarA(lon, lat, zoom) {
    setVista((v) => ({ ...v, longitude: lon, latitude: lat, zoom, transitionDuration: 800, transitionInterpolator: new FlyToInterpolator() }))
  }

  function ubicar(lat, lon, mensaje = null, desde = 'mapa') {
    setYo({ lat, lon })
    setOrigen(desde)
    setAviso(mensaje)
    volarA(lon, lat, radioKm >= 10 ? 11 : radioKm >= 5 ? 12 : 13)
  }

  function usarEjemplo(motivo) {
    ubicar(TIGRE_CENTRO.lat, TIGRE_CENTRO.lon, `${motivo} Te mostramos un ejemplo desde Tigre centro. También podés tocar el mapa para elegir otro punto.`, 'ejemplo')
  }

  function usarMiUbicacion() {
    if (!navigator.geolocation) return usarEjemplo('Este navegador no permite usar la ubicación.')
    setBuscando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscando(false)
        const aqui = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        const minimo = Math.min(...estaciones.map((e) => distanciaKm(aqui, { lat: e.latitud, lon: e.longitud })))
        if (minimo > LEJOS_KM) usarEjemplo(`Estás a ${Math.round(minimo)} km de Zona Norte.`)
        else ubicar(aqui.lat, aqui.lon, null, 'gps')
      },
      () => {
        setBuscando(false)
        usarEjemplo('No pudimos obtener tu ubicación.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function elegirCombustible(c) {
    setCombustible(c)
    setPedirNafta(false)
  }

  function clickEnMapa(info) {
    // Tocaste una estación: se muestra su cartel con nombre y precio (tu ubicación no se mueve)
    if (info.layer?.id === 'estaciones' && info.object) return setElegida(info.object.id)
    if (info.object) return // tocaste tu punto o un cartel
    setElegida(null)
    if (!combustible) return setPedirNafta(true)
    if (origen === 'gps') return // con tu ubicación real, el punto azul queda fijo
    if (info.coordinate) ubicar(info.coordinate[1], info.coordinate[0])
  }

  // ---------------- Capas de deck.gl ----------------
  const esMejor = (d) => mejor && d.id === mejor.id
  const estacionElegida = lista.find((e) => e.id === elegida && !esMejor(e))
  const enRadio = new Set(cercanas.map((e) => e.id))

  const capas = [
    yo &&
      new ScatterplotLayer({
        id: 'radio',
        data: [yo],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: radioKm * 1000,
        radiusUnits: 'meters',
        stroked: true,
        getFillColor: [...AZUL, 25],
        getLineColor: [...AZUL, 160],
        lineWidthMinPixels: 1.5,
        updateTriggers: { getRadius: radioKm },
      }),
    new ScatterplotLayer({
      id: 'estaciones',
      data: lista,
      getPosition: (d) => [d.longitud, d.latitud], // deck.gl usa [LONGITUD, LATITUD]
      getRadius: (d) => (esMejor(d) ? 11 : 7),
      radiusUnits: 'pixels',
      getFillColor: (d) => [...categoriaDe(d.precio).color, !yo || enRadio.has(d.id) ? 235 : 70],
      getLineColor: (d) => (esMejor(d) ? DORADO : [255, 255, 255]),
      getLineWidth: (d) => (esMejor(d) ? 3.5 : 1.2),
      lineWidthUnits: 'pixels',
      stroked: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [20, 20, 20, 80],
      updateTriggers: {
        getRadius: mejor?.id,
        getFillColor: [tipo, yo?.lat, yo?.lon, radioKm, cortes[0], cortes[1]],
        getLineColor: mejor?.id,
        getLineWidth: mejor?.id,
      },
    }),
    mejor &&
      new TextLayer({
        id: 'etiqueta-mejor',
        data: [mejor],
        getPosition: (d) => [d.longitud, d.latitud],
        getText: (d) => `${d.bandera} · ${pesos.format(d.precio)}`,
        getPixelOffset: [0, -26],
        getSize: 15,
        fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif',
        fontWeight: 700,
        characterSet: 'auto',
        getColor: [20, 20, 20],
        background: true,
        getBackgroundColor: DORADO,
        backgroundPadding: [6, 3],
      }),
    estacionElegida &&
      new ScatterplotLayer({
        id: 'anillo-elegida',
        data: [estacionElegida],
        getPosition: (d) => [d.longitud, d.latitud],
        getRadius: 14,
        radiusUnits: 'pixels',
        filled: false,
        stroked: true,
        getLineColor: [23, 32, 27],
        lineWidthMinPixels: 2,
      }),
    estacionElegida &&
      new TextLayer({
        id: 'etiqueta-elegida',
        data: [estacionElegida],
        getPosition: (d) => [d.longitud, d.latitud],
        getText: (d) => `${d.bandera} · ${pesos.format(d.precio)}`,
        getPixelOffset: [0, -26],
        getSize: 15,
        fontFamily: 'Barlow Condensed, Arial Narrow, sans-serif',
        fontWeight: 700,
        characterSet: 'auto',
        getColor: [20, 20, 20],
        background: true,
        getBackgroundColor: [255, 255, 255],
        getBorderColor: [23, 32, 27],
        getBorderWidth: 1,
        backgroundPadding: [6, 3],
      }),
    yo &&
      new ScatterplotLayer({
        id: 'yo',
        data: [yo],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: AZUL,
        getLineColor: [255, 255, 255],
        lineWidthMinPixels: 3,
        stroked: true,
      }),
  ].filter(Boolean)

  // Etapa 6: datos al pasar el mouse
  function tooltip({ object, layer }) {
    if (!object || layer?.id !== 'estaciones') return null
    const cat = categoriaDe(object.precio)
    const dist = yo ? textoKm(distanciaKm(yo, { lat: object.latitud, lon: object.longitud })) : null
    return {
      html: `
        <div class="tt-titulo">${object.bandera}</div>
        <div class="tt-sub">${object.nombre}</div>
        <div>${object.direccion}, ${object.localidad}</div>
        <div class="tt-precio">${pesos.format(object.precio)} <small>/ litro · ${COMBUSTIBLES[tipo].nombre}</small></div>
        <span class="tt-cat" style="background: rgb(${cat.color.join(',')})">${cat.nombre}</span>
        ${dist ? `<div class="tt-sub">a ${dist} de vos</div>` : ''}
        <div class="tt-sub">Precio informado: ${object.fecha}</div>`,
      style: {
        background: '#ffffff',
        color: '#17201b',
        border: '1px solid #dde3de',
        borderRadius: '8px',
        padding: '8px 10px',
        boxShadow: '0 4px 14px rgba(0,0,0,.18)',
        fontFamily: 'Barlow, system-ui, sans-serif',
        fontSize: '13px',
        lineHeight: '1.4',
      },
    }
  }

  // ---------------- Pantalla ----------------
  return (
    <div className="app">
      <header className="encabezado">
        <h1>⛽ Cargá Barato</h1>
        <p>Nafta súper y premium en Zona Norte: Tigre, San Fernando, San Isidro y Vicente López.</p>
      </header>

      {kpis && (
        <section className="kpis">
          <Kpi valor={kpis.total} titulo="Estaciones" sub="en 4 partidos" />
          <Kpi valor={pesos.format(kpis.promedio)} titulo="Precio promedio" sub={`${COMBUSTIBLES[tipo].nombre} por litro`} />
          <Kpi valor={pesos.format(kpis.barata.precio)} titulo="Más barata" sub={`${kpis.barata.bandera} · ${kpis.barata.localidad}`} />
          <Kpi valor={pesos.format(kpis.cara.precio)} titulo="Más cara" sub={`${kpis.cara.bandera} · ${kpis.cara.localidad}`} />
        </section>
      )}

      <section className="principal">
        <aside className="panel">
          <div className="paso">
            <span className="num">1</span>¿Qué nafta cargás?
          </div>
          <div className={`combustibles ${pedirNafta ? 'resaltar' : ''}`}>
            {Object.entries(COMBUSTIBLES).map(([clave, c]) => (
              <button key={clave} className={combustible === clave ? 'activo' : ''} onClick={() => elegirCombustible(clave)}>
                {c.nombre}
              </button>
            ))}
          </div>

          <div className={`paso ${combustible ? '' : 'apagado'}`}>
            <span className="num">2</span>¿Dónde estás?
          </div>
          <button className="ubicar" onClick={usarMiUbicacion} disabled={!combustible || buscando || cargando}>
            {buscando ? 'Buscando tu ubicación…' : yo ? '📍 Actualizar mi ubicación' : '📍 Usar mi ubicación'}
          </button>

          <div className="radios">
            <span>Buscar a menos de</span>
            <div>
              {RADIOS.map((r) => (
                <button key={r} className={radioKm === r ? 'activo' : ''} onClick={() => setRadioKm(r)}>
                  {r} km
                </button>
              ))}
            </div>
          </div>

          {aviso && <div className="aviso">{aviso}</div>}

          <Resultado
            combustible={combustible}
            yo={yo}
            radioKm={radioKm}
            cercanas={cercanas}
            mejor={mejor}
            masCercana={masCercana}
            promedioCerca={promedioCerca}
            categoriaDe={categoriaDe}
            alElegir={(e) => { setElegida(e.id); volarA(e.longitud, e.latitud, 14) }}
          />
        </aside>

        <div className="mapa">
          {cargando && <div className="estado">Cargando estaciones desde Supabase…</div>}
          {error && (
            <div className="estado error">
              <strong>No se pudieron cargar los datos.</strong>
              <br />
              {error}
            </div>
          )}
          {!cargando && !error && estaciones.length === 0 && (
            <div className="estado error">La tabla "puntos" está vacía o falta la política de lectura en Supabase.</div>
          )}

          <DeckGL
            initialViewState={vista}
            controller={true}
            pickingRadius={12}
            layers={capas}
            getTooltip={tooltip}
            onClick={clickEnMapa}
            getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'crosshair')}
          >
            <Map mapStyle={MAPA_BASE} />
          </DeckGL>

          <Leyenda tipo={tipo} cortes={cortes} />
        </div>
      </section>

      <footer className="pie">
        Datos: Secretaría de Energía, Precios vigentes en surtidor (Res. 314/2016) · Base de datos: Supabase · Mapa: deck.gl
      </footer>
    </div>
  )
}

// ---------------- Componentes ----------------
function Kpi({ valor, titulo, sub }) {
  return (
    <div className="kpi">
      <div className="kpi-valor">{valor}</div>
      <div className="kpi-titulo">{titulo}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function Resultado({ combustible, yo, radioKm, cercanas, mejor, masCercana, promedioCerca, categoriaDe, alElegir }) {
  if (!combustible) {
    return (
      <div className="tarjeta vacia">
        Elegí si cargás <strong>Súper</strong> o <strong>Premium</strong>. Después te ubicamos y te mostramos la estación más barata cerca tuyo.
      </div>
    )
  }
  if (!yo) {
    return (
      <div className="tarjeta vacia">
        Tocá <strong>Usar mi ubicación</strong> y permití el acceso. También podés tocar el mapa donde estés.
      </div>
    )
  }
  if (!mejor) {
    return (
      <div className="mejor">
        <div className="etiqueta">No hay estaciones a menos de {radioKm} km</div>
        {masCercana && (
          <>
            <div className="nombre">La más cercana: {masCercana.bandera} · {masCercana.direccion}</div>
            <div className="detalle">
              {masCercana.localidad} · a {textoKm(masCercana.dist)} · {pesos.format(masCercana.precio)}
            </div>
          </>
        )}
        <div className="ahorro">Probá con 10 km o tocá otro punto del mapa.</div>
      </div>
    )
  }

  const diferencia = promedioCerca - mejor.precio
  return (
    <>
      <div className="mejor">
        <div className="etiqueta">⭐ {combustible === 'super' ? 'Súper' : 'Premium'} más barata cerca tuyo</div>
        <div className="precio">
          {pesos.format(mejor.precio)} <small>/ litro</small>
        </div>
        <div className="nombre">
          {mejor.bandera} · {mejor.direccion}
        </div>
        <div className="detalle">
          {mejor.localidad} · a {textoKm(mejor.dist)}
        </div>
        <div className="promedio">
          <span>Promedio cerca tuyo</span>
          <strong>{pesos.format(promedioCerca)}</strong>
        </div>
        {diferencia >= 1 && <div className="ahorro">Está {pesos.format(diferencia)} por litro debajo del promedio.</div>}
      </div>

      <div className="tarjeta lista">
        <h3>
          {cercanas.length} estaciones a menos de {radioKm} km
        </h3>
        <ol>
          {cercanas.map((e, i) => (
            <li key={e.id}>
              <button onClick={() => alElegir(e)}>
                <span className="punto" style={{ background: `rgb(${categoriaDe(e.precio).color.join(',')})` }} />
                <span className="li-texto">
                  <span className="li-nombre">
                    {i === 0 ? '⭐ ' : ''}
                    {e.bandera} · {e.direccion}
                  </span>
                  <span className="li-sub">{e.localidad}</span>
                </span>
                <span className="li-derecha">
                  <span className="li-precio">{pesos.format(e.precio)}</span>
                  <span className="li-sub">{textoKm(e.dist)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

function Leyenda({ tipo, cortes }) {
  const rangos = [`hasta ${pesos.format(cortes[0] - 1)}`, `${pesos.format(cortes[0])} a ${pesos.format(cortes[1] - 1)}`, `desde ${pesos.format(cortes[1])}`]
  return (
    <div className="leyenda">
      <div className="leyenda-titulo">{COMBUSTIBLES[tipo].nombre} por litro</div>
      {CATEGORIAS.map((c, i) => (
        <div key={c.nombre} className="leyenda-item">
          <span className="punto" style={{ background: `rgb(${c.color.join(',')})` }} />
          <span>{c.nombre}</span>
          <span className="rango">{rangos[i]}</span>
        </div>
      ))}
      <div className="separador leyenda-extra" />
      <div className="leyenda-item leyenda-extra">
        <span className="punto borde-dorado" />
        <span>La más barata cerca tuyo</span>
      </div>
      <div className="leyenda-item leyenda-extra">
        <span className="punto" style={{ background: 'rgb(37,99,235)' }} />
        <span>Vos</span>
      </div>
      <div className="leyenda-item leyenda-extra">
        <span className="punto" style={{ background: 'rgba(120,120,120,.35)' }} />
        <span>Fuera de la distancia elegida</span>
      </div>
    </div>
  )
}
