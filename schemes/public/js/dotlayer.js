// A Leaflet layer that draws tens of thousands of points on one canvas.
// Points are projected once per zoom level, so panning stays smooth.
(function () {
  'use strict';
  if (!window.L) return;

  L.DotLayer = L.Layer.extend({
    initialize(options) {
      L.setOptions(this, options);
      this._lat = new Float64Array(0);
      this._lon = new Float64Array(0);
      this._px = new Float32Array(0);
      this._py = new Float32Array(0);
      this._zoom = null;
    },

    setPoints(lat, lon) {
      this._lat = lat;
      this._lon = lon;
      this._zoom = null;
      if (this._map) this._reset();
      return this;
    },

    setColors(fill, stroke, highlight) {
      Object.assign(this.options, { color: fill, stroke, highlight });
      if (this._map) this._draw();
    },

    /** Draws a ring around one location (or clears it with null). */
    setHighlight(latlng) {
      this._highlight = latlng ? L.latLng(latlng) : null;
      if (this._map) this._draw();
    },

    onAdd(map) {
      this._canvas = L.DomUtil.create('canvas', 'leaflet-dot-layer leaflet-zoom-hide');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      map.getPane('overlayPane').appendChild(this._canvas);
      map.on('moveend resize viewreset', this._reset, this);
      map.on('click', this._onClick, this);
      this._reset();
    },

    onRemove(map) {
      L.DomUtil.remove(this._canvas);
      map.off('moveend resize viewreset', this._reset, this);
      map.off('click', this._onClick, this);
    },

    _project() {
      const map = this._map;
      const z = map.getZoom();
      const n = this._lat.length;
      this._px = new Float32Array(n);
      this._py = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = map.project([this._lat[i], this._lon[i]], z);
        this._px[i] = p.x; this._py[i] = p.y;
      }
      this._zoom = z;
    },

    _radius() {
      const z = this._map.getZoom();
      return z < 8 ? 2.2 : z < 10 ? 3 : z < 12 ? 4 : z < 14 ? 5 : 6.5;
    },

    _reset() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize();
      const dpr = window.devicePixelRatio || 1;
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, topLeft);
      this._canvas.width = size.x * dpr;
      this._canvas.height = size.y * dpr;
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      if (this._zoom !== map.getZoom()) this._project();
      this._draw();
    },

    _draw() {
      const map = this._map;
      const ctx = this._canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const size = map.getSize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const origin = map.getPixelBounds().min;
      const r = this._radius();
      ctx.fillStyle = this.options.color || '#145b38';
      const px = this._px, py = this._py, n = px.length;
      const w = size.x + r, h = size.y + r;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = px[i] - origin.x, y = py[i] - origin.y;
        if (x < -r || y < -r || x > w || y > h) continue;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, 6.2832);
      }
      ctx.globalAlpha = 0.85;
      ctx.fill();
      if (r >= 3) { // a light outline keeps dense clusters readable
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = r >= 5 ? 1.25 : 0.75;
        ctx.strokeStyle = this.options.stroke || '#ffffff';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (this._highlight) {
        const p = this._map.project(this._highlight, this._map.getZoom());
        const x = p.x - origin.x, y = p.y - origin.y;
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, 6.2832);
        ctx.lineWidth = 3;
        ctx.strokeStyle = this.options.highlight || '#d99a12';
        ctx.stroke();
      }
    },

    _onClick(e) {
      if (!this.options.onPick || this._zoom !== this._map.getZoom()) return;
      const origin = this._map.getPixelBounds().min;
      const cx = e.containerPoint.x + origin.x, cy = e.containerPoint.y + origin.y;
      const limit = Math.max(8, this._radius() + 4);
      let best = -1, bestD = limit * limit;
      for (let i = 0; i < this._px.length; i++) {
        const dx = this._px[i] - cx, dy = this._py[i] - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) this.options.onPick(best, L.latLng(this._lat[best], this._lon[best]));
    },
  });
})();
