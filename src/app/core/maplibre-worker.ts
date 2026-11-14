import { setWorkerUrl } from 'maplibre-gl';

let ready: Promise<void> | undefined;

/**
 * MapLibre v6 loads its worker as a separate file next to the bundle, which fails after bundling
 * and under the capacitor:// scheme on iOS. We ship the worker as an asset (see angular.json)
 * and hand it to MapLibre as a blob URL with an explicit JavaScript MIME type.
 */
export function initMaplibreWorker(): Promise<void> {
  ready ??= fetch('maplibre/maplibre-gl-worker.mjs')
    .then((res) => res.text())
    .then((code) => setWorkerUrl(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))));
  return ready;
}
