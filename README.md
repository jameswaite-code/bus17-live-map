# Route 17 Live Map (proof of concept)

A single static page showing the London Buses route 17 (Archway ↔ London
Bridge), with live buses on top, built on the [TfL Unified
API](https://api-portal.tfl.gov.uk/).

- Red line: the route, fetched live from `Line/17/Route/Sequence`.
- Black dots: bus stops.
- Flashing red bus icons: vehicles currently in service, polled from
  `Line/17/Arrivals` every ~25s.
- Two marked pins: home and office.

## How bus positions work (important caveat)

TfL's public feed gives **predicted seconds until a bus reaches its next
stop**, not the bus's live GPS coordinates. This page estimates each bus's
position by taking the stop it's next due at, the stop before that in the
route sequence, and interpolating between them using the countdown and an
assumed average speed (see `ASSUMED_SPEED_MPS` in `js/config.js`). It's a
reasonable approximation for a proof of concept, not a precise tracker.

## Running locally

It's a static site — no build step. Serve the folder with anything, e.g.:

```bash
python3 -m http.server 8080
```

then open `http://localhost:8080`.

## Deploying

Hosted on GitHub Pages from this repo's `main` branch (Settings → Pages →
Deploy from branch → `main` / `/ (root)`).

## Notes

- `js/config.js` holds the TfL `app_key` in plain sight — this is a
  client-side-only page with no backend to hide it behind, and TfL's own key
  is a rate-limit token rather than an account credential. See the comment in
  that file if you'd rather proxy requests through a server instead.
- Home/office coordinates were geocoded once from the given address/postcode
  and hardcoded into `js/config.js` rather than geocoded live on every page
  load.
