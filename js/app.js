// Route 17 live map -- proof of concept.
//
// Data flow:
//   1. On load, fetch the route geometry + ordered stop list for both
//      directions from TfL's Route/Sequence endpoint (static-ish, but
//      fetched live so the map always reflects the current published route).
//   2. Draw the road-following polyline (red) and every stop (black dot).
//   3. Poll TfL's live Arrivals endpoint on a timer. TfL gives predicted
//      seconds-until-arrival per stop, not raw vehicle GPS, so each bus's
//      on-map position is *estimated*: find the stop it's next due at, find
//      the stop before that in the route sequence, and interpolate between
//      them using the predicted time and an assumed average speed.
//   4. Render one flashing red bus icon per vehicle, moving it smoothly
//      (CSS transition) between polls.

const TFL_BASE = 'https://api.tfl.gov.uk';

const state = {
  map: null,
  directions: {}, // { outbound: {stops: [...], naptanIndex: Map}, inbound: {...} }
  naptanLookup: new Map(), // naptanId -> { direction, index }
  busMarkers: new Map(), // vehicleId -> L.Marker
  stopLayer: null,
  statusEl: document.getElementById('status'),
};

function setStatus(text, isError) {
  state.statusEl.textContent = text;
  state.statusEl.classList.toggle('status-error', !!isError);
}

function tflUrl(path, params) {
  const url = new URL(TFL_BASE + path);
  url.searchParams.set('app_key', CONFIG.TFL_APP_KEY);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Map setup ----------

function initMap() {
  const map = L.map('map', { zoomControl: true }).setView([51.545, -0.125], 13);

  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; Bus data &copy; <a href="https://tfl.gov.uk">TfL</a>',
  });
  tiles.addTo(map);

  state.map = map;
  state.stopLayer = L.layerGroup().addTo(map);
  return map;
}

const HOME_SVG = `<svg viewBox="0 0 24 24" width="15" height="15"><path fill="#fff" d="M12 2.5 1.5 11h3V21h6v-6h3v6h6V11h3z"/></svg>`;
const OFFICE_SVG = `<svg viewBox="0 0 24 24" width="15" height="15"><rect x="4" y="2" width="16" height="20" fill="#fff"/><rect x="7" y="5" width="3" height="3" fill="#000"/><rect x="14" y="5" width="3" height="3" fill="#000"/><rect x="7" y="10" width="3" height="3" fill="#000"/><rect x="14" y="10" width="3" height="3" fill="#000"/><rect x="7" y="15" width="3" height="3" fill="#000"/><rect x="14" y="15" width="3" height="3" fill="#000"/></svg>`;

function pinIcon(kind) {
  // kind: 'home' | 'office'
  const glyph = kind === 'home' ? HOME_SVG : OFFICE_SVG;
  return L.divIcon({
    className: `poi-icon poi-${kind}`,
    html: `<div class="poi-pin">${glyph}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    popupAnchor: [0, -26],
  });
}

function addPoi(point, kind) {
  const marker = L.marker([point.lat, point.lon], { icon: pinIcon(kind) }).addTo(state.map);
  marker.bindTooltip(`<strong>${point.label}</strong><br>${point.detail}`, { direction: 'top' });
  return marker;
}

// ---------- Route + stops ----------

async function loadDirection(direction) {
  const data = await fetchJson(
    tflUrl(`/Line/${CONFIG.LINE_ID}/Route/Sequence/${direction}`, { serviceTypes: 'Regular' })
  );

  const stopPoints = data.stopPointSequences?.[0]?.stopPoint || [];
  const stops = stopPoints.map((sp, i) => ({
    id: sp.id,
    name: sp.name,
    lat: sp.lat,
    lon: sp.lon,
    index: i,
  }));

  stops.forEach((s) => state.naptanLookup.set(s.id, { direction, index: s.index }));

  // lineStrings is an array of GeoJSON-style [ [lon,lat], ... ] rings (as a
  // JSON string per TfL's API), one per contiguous section of the route.
  const latLngs = [];
  for (const raw of data.lineStrings || []) {
    const coords = JSON.parse(raw); // [[[lon,lat], ...]]
    for (const ring of coords) {
      latLngs.push(ring.map(([lon, lat]) => [lat, lon]));
    }
  }

  state.directions[direction] = { stops, latLngs };
}

function drawRoute() {
  for (const direction of ['outbound', 'inbound']) {
    const dir = state.directions[direction];
    if (!dir) continue;

    for (const path of dir.latLngs) {
      L.polyline(path, {
        color: '#DC241F', // official TfL bus red
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(state.map);
    }
  }

  // De-duplicate near-identical stop positions across both directions'
  // bays so we don't draw two dots on top of each other.
  const seen = new Map();
  for (const direction of ['outbound', 'inbound']) {
    const dir = state.directions[direction];
    if (!dir) continue;
    for (const s of dir.stops) {
      const key = `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.set(key, s);
      L.circleMarker([s.lat, s.lon], {
        radius: 5,
        color: '#000',
        weight: 1,
        fillColor: '#000',
        fillOpacity: 1,
      })
        .bindTooltip(s.name, { direction: 'top' })
        .addTo(state.stopLayer);
    }
  }
}

function fitToRoute() {
  const bounds = [];
  for (const direction of ['outbound', 'inbound']) {
    const dir = state.directions[direction];
    if (!dir) continue;
    for (const path of dir.latLngs) bounds.push(...path);
  }
  if (bounds.length) state.map.fitBounds(bounds, { padding: [24, 24] });
}

// ---------- Live buses ----------

const BUS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18">
  <rect x="1" y="5" width="22" height="11" rx="2.5" fill="#DC241F" stroke="#000" stroke-width="1.2"/>
  <rect x="3.5" y="7.2" width="3.6" height="4" fill="#fff"/>
  <rect x="8.5" y="7.2" width="3.6" height="4" fill="#fff"/>
  <rect x="13.5" y="7.2" width="3.6" height="4" fill="#fff"/>
  <rect x="18.5" y="7.2" width="2.7" height="4" fill="#fff"/>
  <circle cx="6.5" cy="17" r="2.1" fill="#000"/>
  <circle cx="17.5" cy="17" r="2.1" fill="#000"/>
</svg>`;

// TfL's "outbound" for route 17 runs Archway -> London Bridge (southbound);
// "inbound" runs the reverse, London Bridge -> Archway (northbound).
const DIRECTION_LETTER = { outbound: 'S', inbound: 'N' };

function busIcon(letter) {
  return L.divIcon({
    className: 'bus-icon-wrap',
    html: `<div class="bus-icon">${BUS_SVG}<div class="bus-badge">${letter || '?'}</div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function estimatePosition(direction, stopIndex, timeToStationSec) {
  const stops = state.directions[direction].stops;
  const next = stops[stopIndex];
  if (stopIndex === 0) return { lat: next.lat, lon: next.lon };

  const prev = stops[stopIndex - 1];
  const segMeters = haversineMeters(prev, next);
  const estSegSeconds = Math.max(
    segMeters / CONFIG.ASSUMED_SPEED_MPS,
    CONFIG.MIN_SEGMENT_SECONDS
  );
  const fraction = 1 - Math.min(Math.max(timeToStationSec / estSegSeconds, 0), 1);

  return {
    lat: prev.lat + (next.lat - prev.lat) * fraction,
    lon: prev.lon + (next.lon - prev.lon) * fraction,
  };
}

async function pollArrivals() {
  let predictions;
  try {
    predictions = await fetchJson(tflUrl(`/Line/${CONFIG.LINE_ID}/Arrivals`, {}));
  } catch (err) {
    console.error(err);
    setStatus('Live update failed (TfL API unreachable or rate-limited) — retrying next cycle.', true);
    return;
  }

  const byVehicle = new Map();
  for (const p of predictions) {
    const list = byVehicle.get(p.vehicleId) || [];
    list.push(p);
    byVehicle.set(p.vehicleId, list);
  }

  const seenVehicles = new Set();

  for (const [vehicleId, preds] of byVehicle) {
    preds.sort((a, b) => a.timeToStation - b.timeToStation);
    const next = preds[0];
    const loc = state.naptanLookup.get(next.naptanId);
    if (!loc) continue; // stop not on our matched route sequence (rare branch variant)

    const pos = estimatePosition(loc.direction, loc.index, next.timeToStation);
    const letter = DIRECTION_LETTER[next.direction] || '?';
    seenVehicles.add(vehicleId);

    let marker = state.busMarkers.get(vehicleId);
    if (!marker) {
      marker = L.marker([pos.lat, pos.lon], { icon: busIcon(letter) }).addTo(state.map);
      marker._direction = letter;
      state.busMarkers.set(vehicleId, marker);
    } else if (marker._direction !== letter) {
      marker.setIcon(busIcon(letter));
      marker._direction = letter;
    }
    marker.setLatLng([pos.lat, pos.lon]);

    const mins = Math.floor(next.timeToStation / 60);
    const secs = next.timeToStation % 60;
    marker.bindTooltip(
      `<strong>Bus ${vehicleId}</strong><br>${next.direction} to ${next.destinationName || '?'}<br>` +
        `Next stop: ${next.stationName} in ${mins}m ${secs}s`,
      { direction: 'top' }
    );
  }

  // Remove markers for buses no longer reporting (finished route / dropped off feed).
  for (const [vehicleId, marker] of state.busMarkers) {
    if (!seenVehicles.has(vehicleId)) {
      state.map.removeLayer(marker);
      state.busMarkers.delete(vehicleId);
    }
  }

  const now = new Date();
  setStatus(
    `Live · ${seenVehicles.size} bus${seenVehicles.size === 1 ? '' : 'es'} on route · last updated ${now.toLocaleTimeString('en-GB')}`
  );
}

// ---------- Boot ----------

async function main() {
  initMap();
  addPoi(CONFIG.HOME, 'home');
  addPoi(CONFIG.OFFICE, 'office');

  setStatus('Loading route 17 from TfL…');
  try {
    await Promise.all([loadDirection('outbound'), loadDirection('inbound')]);
  } catch (err) {
    console.error(err);
    setStatus('Failed to load route geometry from TfL. Check the app_key / network and reload.', true);
    return;
  }

  drawRoute();
  fitToRoute();

  await pollArrivals();
  setInterval(pollArrivals, CONFIG.POLL_INTERVAL_MS);
}

main();
