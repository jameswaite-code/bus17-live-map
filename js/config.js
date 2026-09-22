// Proof-of-concept configuration for the route 17 live map.
//
// NOTE ON THE API KEY: this is a static, client-side-only page (hosted on
// GitHub Pages), so there is no server to hide a secret behind. The TfL
// "app_key" is a low-sensitivity rate-limit token (not an account credential)
// and TfL's own docs show it used exactly this way in browser demos. Anyone
// could read it from this file's network requests regardless of where it's
// stored, so it is kept here in plain sight rather than pretending otherwise.
// If you want it kept private instead, move the fetches behind a small
// serverless proxy and delete this file.
const CONFIG = {
  TFL_APP_KEY: '4b827984767d49589f555a6431e2580f',
  LINE_ID: '17',

  // Home / office pins. Geocoded from the postcode/address you gave me.
  HOME: {
    lat: 51.556554,
    lon: -0.12268,
    label: 'Home',
    detail: '4 Moriarty Cl, N7'
  },
  OFFICE: {
    lat: 51.5304758,
    lon: -0.1187417,
    label: 'Office',
    detail: '25-28 Field Street, WC1X'
  },

  // How often to re-poll live arrivals (ms). TfL's countdown feed itself
  // only refreshes roughly every 25-30s, so polling much faster just burns
  // rate limit without fresher data.
  POLL_INTERVAL_MS: 25000,

  // Assumed average bus speed (m/s) used only to estimate how far between
  // two stops a bus is, from TfL's predicted seconds-to-next-stop. This is
  // an approximation, not GPS -- see the on-page disclaimer.
  ASSUMED_SPEED_MPS: 4.5,
  MIN_SEGMENT_SECONDS: 20
};
