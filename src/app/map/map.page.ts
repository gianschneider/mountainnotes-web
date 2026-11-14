import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  IonContent, IonFabButton, IonIcon, IonChip, IonButton, IonText, IonSpinner, IonBadge, IonProgressBar, ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { locate, add, remove, cloudUploadOutline, cloudDownloadOutline, navigate, refresh, list, help, funnel, closeCircle } from 'ionicons/icons';
import { Position } from '@capacitor/geolocation';
import { Map as LeafletMap, Circle, CircleMarker, GeoJSON, LatLng, LatLngBounds, LayerGroup, Marker, Icon, DivIcon } from 'leaflet';
import { MaplibreGL } from '@maplibre/maplibre-gl-leaflet';
import type { FeatureCollection } from 'geojson';
import { LocationService } from '../core/location.service';
import { OutboxEntry, OutboxService } from '../core/outbox.service';
import { initMaplibreWorker } from '../core/maplibre-worker';
import { LatLon, clampToRadius, distanceM } from '../core/geo';
import { MAX_ACCURACY_M, MAX_ADJUST_M } from '../core/note';
import { NoteFormComponent, NoteFormResult } from '../notes/note-form.component';
import { NoteDetailComponent } from '../notes/note-detail.component';
import { NearbyComponent } from '../notes/nearby.component';
import { LegendComponent } from '../notes/legend.component';
import { OnboardingComponent } from '../onboarding/onboarding.component';
import { MapFilterService } from '../notes/map-filter.service';
import { BBox, MAX_BBOX_DEG, NotesService, isCovered } from '../core/notes.service';
import { UnlockService } from '../core/unlock.service';
import { NoteKind, noteKind, notePinHtml } from '../notes/note-kind';
import { Ui } from '../core/ui';
import { AuthService } from '../core/auth.service';
import { DownloadProgress, MAX_REGION_DEG, OfflineMapService } from '../core/offline-map.service';
import { errorMessage } from '../core/api.service';
import { SETTLEMENT_ATTRIBUTION, SettlementService } from '../core/settlement.service';

const SWITZERLAND = new LatLng(46.8, 8.23);
const BASEMAP_ATTRIBUTION = '<a href="https://www.swisstopo.admin.ch" target="_blank">© swisstopo</a>';
const MIN_LOAD_ZOOM = 10;                     // below this the view is larger than the server allows
// Sheets over the map: half height keeps the map visible and usable, drag up for more.
const SHEET = { breakpoints: [0, 0.5, 0.9], initialBreakpoint: 0.5, backdropBreakpoint: 0.5 };

const PIN_ICON = new Icon({
  iconUrl: 'leaflet/marker-icon.png',
  iconRetinaUrl: 'leaflet/marker-icon-2x.png',
  shadowUrl: 'leaflet/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
});

/** Synced notes come from NotesService, not yet synced own notes from the outbox. */
interface NoteMarker {
  id: string;
  lat: number;
  lon: number;
  kind: NoteKind;
  entry?: OutboxEntry;
}

const STATUS_TEXT: Record<OutboxEntry['status'], string> = {
  pending: 'Waiting for upload',
  synced: 'Uploaded',
  failed: 'Rejected',
};

@Component({
  selector: 'app-map',
  templateUrl: 'map.page.html',
  styleUrls: ['map.page.scss'],
  imports: [
    IonContent, IonFabButton, IonIcon, IonChip, IonButton, IonText, IonSpinner, IonBadge, IonProgressBar, DecimalPipe,
  ],
})
export class MapPage implements OnDestroy {
  readonly location = inject(LocationService);
  readonly outbox = inject(OutboxService);
  readonly notesService = inject(NotesService);
  private unlock = inject(UnlockService);
  private settlements = inject(SettlementService);
  private modals = inject(ModalController);
  private ui = inject(Ui);
  private auth = inject(AuthService);
  private offlineMap = inject(OfflineMapService);
  readonly filter = inject(MapFilterService);

  private mapElement = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map?: LeafletMap;
  private mapReady?: Promise<void>;
  private dot?: CircleMarker;
  private accuracy?: Circle;
  private centered = false;
  /** Keep my position in the middle of the map: double tap on "Centre on me" starts it, moving the map stops it. */
  readonly following = signal(false);
  private lastCentreTap = 0;
  private notesLayer = new LayerGroup();
  private renderedKey = '';

  /** Synced notes with their unlock state, plus own notes that are only in the outbox so far. */
  readonly markers = computed<NoteMarker[]>(() => {
    const states = this.unlock.states();
    const synced = this.notesService.notes();
    const ids = new Set(synced.map((n) => n.id));
    return [
      ...synced.map((n) => ({ id: n.id, lat: n.lat, lon: n.lon, kind: noteKind(states.get(n.id), n.isMine) })),
      ...this.outbox.entries()
        .filter((e) => !ids.has(e.note.id))
        .map((e) => ({
          id: e.note.id, lat: e.note.lat, lon: e.note.lon, entry: e,
          kind: (e.status === 'synced' ? 'mine' : e.status) as NoteKind,
        })),
    ];
  });

  // Placing a note: the marker follows the GNSS fix (anchor) until the user drags it.
  readonly placing = signal(false);
  private readonly anchor = signal<Position | null>(null);
  private readonly adjusted = signal<LatLon | null>(null);
  private dragged = false;
  private placeLayer = new LayerGroup();
  private placeMarker?: Marker;
  private placeCircle?: Circle;
  private maskLayer?: GeoJSON;
  /** Building zones of the visible area (switchable in the "Karte" sheet). */
  private zonesLayer = new LayerGroup();
  private zonesBox?: BBox;
  private zonesAreas?: unknown;

  readonly anchorAccuracy = computed(() => this.anchor()?.coords.accuracy ?? Infinity);
  readonly accuracyOk = computed(() => this.anchorAccuracy() <= MAX_ACCURACY_M);
  readonly adjustM = computed(() => {
    const anchor = this.anchor();
    const adjusted = this.adjusted();
    return anchor && adjusted ? distanceM(toLatLon(anchor), adjusted) : 0;
  });
  /** Offline check against the stored settlement mask (building zones); the server checks again on upload. */
  readonly settlementCheck = computed(() => {
    this.settlements.areas();                 // re-check when a mask was loaded
    const adjusted = this.adjusted();
    return adjusted ? this.settlements.check(adjusted) : 'unknown';
  });
  /** Admins may place notes in building zones for testing (the server allows it too). */
  readonly isAdmin = computed(() => this.auth.user()?.role === 'admin');
  readonly canContinue = computed(() => this.accuracyOk() && (this.settlementCheck() !== 'inside' || this.isAdmin()));
  readonly maxAccuracy = MAX_ACCURACY_M;
  readonly maxAdjust = MAX_ADJUST_M;

  /** Visible map area; a button offers to load it when it is not loaded yet ("search this area"). */
  private readonly viewBox = signal<BBox | null>(null);
  readonly loadingView = signal(false);
  readonly download = signal<DownloadProgress | null>(null);
  private downloadAbort?: AbortController;
  readonly canLoadView = computed(() => {
    const box = this.viewBox();
    return !!box && !this.placing() && !isCovered(box, this.notesService.loadedBoxes());
  });

  constructor() {
    addIcons({ locate, add, cloudUploadOutline, cloudDownloadOutline, navigate, refresh, list, help, funnel, closeCircle, remove });
    effect(() => {
      const pos = this.location.position();
      if (!pos) return;
      this.showPosition(pos);
      if (untracked(this.placing) && !this.dragged) this.setAnchor(pos);
      untracked(() => this.notesService.syncAround(toLatLon(pos)));   // throttled, rounded position only
    });
    effect(() => this.renderNotes(this.markers().filter((m) => this.filter.shows(m.kind))));
    effect(() => {
      const visible = this.filter.zones();
      const box = this.viewBox();
      const areas = this.settlements.areas();   // redraw when a mask was loaded
      untracked(() => this.renderZones(visible ? box : null, areas));
    });
  }

  ionViewDidEnter() {                         // Ionic lifecycle: view is visible
    this.location.start();
    if (this.mapReady) this.map?.invalidateSize();   // tab was hidden, container size may have changed
    else this.mapReady = this.createMap();
    OnboardingComponent.showOnce(this.modals);
  }

  ionViewWillLeave() {
    this.location.stop();                     // GNSS drains the battery
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  /** One tap: jump to me once. Second tap within 400 ms (double tap): follow me until the map is moved. */
  centerOnMe() {
    const pos = this.location.position();
    if (!pos || !this.map) return;
    const now = Date.now();
    this.following.set(now - this.lastCentreTap < 400);
    this.lastCentreTap = now;
    this.map.setView(toLatLng(pos), Math.max(this.map.getZoom(), 16));
  }

  startPlacing() {
    const pos = this.location.position();
    if (!pos || !this.map) return;
    this.dragged = false;
    this.following.set(false);                // the map must not move under the finger while placing
    this.placing.set(true);
    this.setAnchor(pos);
    this.placeLayer.addTo(this.map);
    this.map.setView(toLatLng(pos), 19);
    if (!this.filter.zones()) this.showMask(toLatLon(pos));   // otherwise the zones are already on the map
  }

  cancelPlacing() {
    this.placing.set(false);
    this.placeLayer.clearLayers().remove();
    this.placeMarker = this.placeCircle = undefined;
    this.maskLayer = undefined;
    this.updateZoneAttribution();
    this.anchor.set(null);
    this.adjusted.set(null);
  }

  async openForm() {
    const anchor = this.anchor();
    const adjusted = this.adjusted();
    if (!anchor || !adjusted || !this.canContinue()) return;
    const modal = await this.modals.create({
      component: NoteFormComponent,
      componentProps: {
        position: adjusted,
        gnss: { ...toLatLon(anchor), accuracy: anchor.coords.accuracy },
        adjustM: this.adjustM(),
      },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<NoteFormResult>();
    if (role !== 'confirm' || !data) return;
    await this.outbox.add(data.note, data.audienceLabel, data.photo);
    this.cancelPlacing();
    this.ui.toast('Note placed', 'success');
  }

  /** "Prepare a tour": load the notes of the visible map area for offline use. */
  async loadView() {
    const box = this.viewBox();
    if (!box || this.loadingView()) return;
    this.loadingView.set(true);
    try {
      const n = await this.notesService.syncBox(box);
      this.ui.toast(`${n} ${n === 1 ? 'note' : 'notes'} in this area, saved for offline use`, 'success');
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    } finally {
      this.loadingView.set(false);
    }
  }

  /** "Prepare a tour": base map, notes and building zones of the visible area for use without network. */
  async saveOffline() {
    if (!this.map || this.download()) return;
    const b = this.map.getBounds();
    const box = { minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() };
    if (box.maxLat - box.minLat > MAX_REGION_DEG || box.maxLon - box.minLon > MAX_REGION_DEG) {
      this.ui.toast('The area is too large to save. Zoom in closer (to about 40 km).');
      return;
    }
    const { megabytes } = this.offlineMap.estimate(box);
    const name = await this.ui.prompt('Save area for offline use', {
      message: `Saves the map, notes and building zones of the visible area (about ${megabytes} MB). Best on Wi-Fi.`,
      placeholder: 'Name, e.g. Eiger', okText: 'Save', value: `Area of ${new Date().toLocaleDateString('en-GB')}`,
    });
    if (!name) return;
    this.downloadAbort = new AbortController();
    this.download.set({ done: 0, total: 1 });
    try {
      await this.notesService.syncBox(box).catch(() => {});   // notes and building zones of the same area
      await this.offlineMap.download(name, box, (p) => this.download.set(p), this.downloadAbort.signal);
      if (!this.downloadAbort.signal.aborted) this.ui.toast(`«${name}» is available offline`, 'success');
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    } finally {
      this.download.set(null);
    }
  }

  cancelDownload() {
    this.downloadAbort?.abort();
    this.ui.toast('Download abgebrochen');
  }

  private updateViewBox() {
    if (!this.map || this.map.getZoom() < MIN_LOAD_ZOOM) return this.viewBox.set(null);
    const b = this.map.getBounds();
    const box = { minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() };
    const tooLarge = box.maxLat - box.minLat > MAX_BBOX_DEG || box.maxLon - box.minLon > MAX_BBOX_DEG;
    this.viewBox.set(tooLarge ? null : box);
  }

  zoomIn() {
    this.map?.zoomIn();                       // around the centre, so a followed position stays in the middle
  }

  zoomOut() {
    this.map?.zoomOut();
  }

  async openLegend() {
    const sheet = await this.modals.create({ component: LegendComponent, breakpoints: [0, 0.9], initialBreakpoint: 0.9 });
    await sheet.present();
  }

  /** List of my notes by distance; choosing one shows it on the map and opens it. */
  async openNearby() {
    const sheet = await this.modals.create({ component: NearbyComponent, ...SHEET });
    await sheet.present();
    const { data: id, role } = await sheet.onWillDismiss<string>();
    const note = this.notesService.notes().find((n) => n.id === id);
    if (role !== 'select' || !note || !this.map) return;
    this.following.set(false);                // keep me and the note together in view
    // Show me and the note together in the upper half, above the sheet.
    const pos = this.location.position();
    const bounds = new LatLngBounds([[note.lat, note.lon]]);
    if (pos) bounds.extend(toLatLng(pos));
    this.map.fitBounds(bounds, {
      paddingTopLeft: [40, 80], paddingBottomRight: [40, this.map.getSize().y / 2 + 40], maxZoom: 18, animate: false,
    });
    this.openDetail(note.id);
  }

  /** Detail sheet; meanwhile the map shows the unlock radius around the note (how close you have to get). */
  private async openDetail(noteId: string) {
    const note = this.notesService.notes().find((n) => n.id === noteId);
    const radius = note && this.map && !this.notesService.isReadable(note)
      ? new Circle([note.lat, note.lon], {
        radius: note.unlockRadius, color: '#e8772e', weight: 2, dashArray: '6 6', fillOpacity: 0.12, interactive: false,
      }).addTo(this.map)
      : undefined;
    const modal = await this.modals.create({ component: NoteDetailComponent, componentProps: { noteId }, ...SHEET });
    await modal.present();
    await modal.onWillDismiss();
    radius?.remove();
  }

  private async createMap() {
    await initMaplibreWorker();
    this.map = new LeafletMap(this.mapElement().nativeElement, { zoomControl: false, maxZoom: 19 })
      .setView(SWITZERLAND, 8);
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank">Leaflet</a>');
    // Listen before awaiting the style: the first fix may already centre the map meanwhile.
    this.map.on('moveend', () => this.updateViewBox());
    // Moving the map by hand ends following (Leaflet drag, plus raw finger/mouse moves on the map to be safe).
    const stopFollowing = () => this.following() && this.following.set(false);
    this.map.on('dragstart', stopFollowing);
    const el = this.mapElement().nativeElement as HTMLElement;
    el.addEventListener('touchmove', stopFollowing, { passive: true });
    el.addEventListener('mousemove', (e) => e.buttons && stopFollowing());
    const style = await this.offlineMap.style();   // cached copy when offline, tiles from downloaded regions first
    new MaplibreGL({ style, attributionControl: { customAttribution: BASEMAP_ATTRIBUTION } }).addTo(this.map);
    this.zonesLayer.addTo(this.map);          // below the notes
    this.notesLayer.addTo(this.map);
    this.renderedKey = '';
    this.renderNotes(this.markers().filter((m) => this.filter.shows(m.kind)));

    const pos = this.location.position();
    if (pos) this.showPosition(pos);
    this.updateViewBox();
  }

  private showPosition(pos: Position) {
    if (!this.map) return;
    const ll = toLatLng(pos);
    if (!this.dot) {
      this.accuracy = new Circle(ll, { radius: pos.coords.accuracy, weight: 1, fillOpacity: 0.15 }).addTo(this.map);
      this.dot = new CircleMarker(ll, { radius: 7, weight: 2, color: '#fff', fillColor: '#3880ff', fillOpacity: 1 })
        .addTo(this.map);
      // Who is walking: makes it clear on screen (and in the demo videos) whose position this is.
      this.dot.bindTooltip('', { permanent: true, direction: 'right', offset: [10, 0], className: 'me-label', interactive: false });
    } else {
      this.accuracy!.setLatLng(ll).setRadius(pos.coords.accuracy);
      this.dot.setLatLng(ll);
    }
    const name = this.auth.user()?.username ?? '';
    if (this.dot.getTooltip()?.getContent() !== name) this.dot.setTooltipContent(name);
    if (!this.centered) {                     // first fix: jump to the user
      this.centered = true;
      this.map.setView(ll, 16);
    } else if (this.following()) {
      this.map.panTo(ll, { animate: true, duration: 0.25, easeLinearity: 1 });   // glide steadily from fix to fix
    }
  }

  /** Building zones around the fix in red, so it is clear why a spot is not allowed (with required attribution). */
  private showMask(center: LatLon) {
    const d = 0.02;                           // ~2 km around the fix is plenty for a 20 m adjustment
    const zones = this.settlements.zonesIn({
      minLat: center.lat - d, maxLat: center.lat + d, minLon: center.lon - d, maxLon: center.lon + d,
    });
    if (!zones.length || !this.map) return;
    const mask: FeatureCollection = { type: 'FeatureCollection', features: zones };
    this.maskLayer = new GeoJSON(mask, {
      style: { color: '#eb445a', weight: 1, fillOpacity: 0.2 },
      interactive: false,
    }).addTo(this.placeLayer);
    this.updateZoneAttribution();
  }

  /**
   * Building zones of the visible area plus a margin, redrawn only when the view leaves the drawn area.
   * Below MIN_LOAD_ZOOM the view box is null and nothing is drawn (too many polygons).
   */
  private renderZones(box: BBox | null, areas: unknown) {
    if (!box) {
      this.zonesLayer.clearLayers();
      this.zonesBox = undefined;
    } else if (!this.zonesBox || !isCovered(box, [this.zonesBox]) || areas !== this.zonesAreas) {
      const padLat = (box.maxLat - box.minLat) / 2, padLon = (box.maxLon - box.minLon) / 2;
      const drawn = { minLat: box.minLat - padLat, maxLat: box.maxLat + padLat, minLon: box.minLon - padLon, maxLon: box.maxLon + padLon };
      const zones = this.settlements.zonesIn(drawn);
      this.zonesLayer.clearLayers();
      if (zones.length) {
        new GeoJSON({ type: 'FeatureCollection', features: zones } as FeatureCollection, {
          style: { color: '#eb445a', weight: 1, fillOpacity: 0.2 },
          interactive: false,
        }).addTo(this.zonesLayer);
      }
      this.zonesBox = drawn;
      this.zonesAreas = areas;
    }
    this.updateZoneAttribution();
  }

  /** Required source note whenever building zones are on the map. */
  private updateZoneAttribution() {
    const shown = this.zonesLayer.getLayers().length > 0 || !!this.maskLayer;
    this.map?.attributionControl.removeAttribution(SETTLEMENT_ATTRIBUTION);
    if (shown) this.map?.attributionControl.addAttribution(SETTLEMENT_ATTRIBUTION);
  }

  /** New reference fix while placing: marker and 20 m circle move with it. */
  private setAnchor(pos: Position) {
    const ll = toLatLng(pos);
    this.anchor.set(pos);
    this.adjusted.set(toLatLon(pos));
    if (!this.placeCircle) {
      this.placeCircle = new Circle(ll, {
        radius: MAX_ADJUST_M, color: '#eb445a', weight: 2, dashArray: '6 6', fillOpacity: 0.05, interactive: false,
      }).addTo(this.placeLayer);
      this.placeMarker = new Marker(ll, { icon: PIN_ICON, draggable: true, autoPan: true }).addTo(this.placeLayer);
      this.placeMarker.on('drag', () => this.onDrag());
    } else {
      this.placeCircle.setLatLng(ll);
      this.placeMarker!.setLatLng(ll);
    }
  }

  /** Keep the dragged marker within MAX_ADJUST_M of the fix (Turf). */
  private onDrag() {
    const anchor = this.anchor();
    if (!anchor || !this.placeMarker) return;
    this.dragged = true;                      // freeze the anchor: the adjustment is measured from this fix
    const ll = this.placeMarker.getLatLng();
    const clamped = clampToRadius(toLatLon(anchor), { lat: ll.lat, lon: ll.lng }, MAX_ADJUST_M);
    if (clamped.lat !== ll.lat || clamped.lon !== ll.lng) this.placeMarker.setLatLng([clamped.lat, clamped.lon]);
    this.adjusted.set(clamped);
  }

  /** Rebuild the markers only when a note or its kind changed, not on every fix. */
  private renderNotes(markers: NoteMarker[]) {
    const key = markers.map((m) => m.id + m.kind).join();
    if (key === this.renderedKey || !this.map) return;
    this.renderedKey = key;
    this.notesLayer.clearLayers();
    for (const m of markers) {
      const icon = new DivIcon({
        className: '',
        html: notePinHtml(m.kind),
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const marker = new Marker([m.lat, m.lon], { icon }).addTo(this.notesLayer);
      if (m.entry) marker.bindPopup(notePopup(m.entry));
      else marker.on('click', () => this.openDetail(m.id));
    }
  }
}

/** Popup built from DOM nodes, so the note text is never interpreted as HTML. */
function notePopup(entry: OutboxEntry): HTMLElement {
  const el = document.createElement('div');
  const body = document.createElement('p');
  body.textContent = entry.note.body;
  const meta = document.createElement('small');
  meta.textContent = `For ${entry.audienceLabel} · ${STATUS_TEXT[entry.status]}${entry.error ? ': ' + entry.error : ''}`;
  el.append(body, meta);
  return el;
}

function toLatLng(pos: Position): LatLng {
  return new LatLng(pos.coords.latitude, pos.coords.longitude);
}

function toLatLon(pos: Position): LatLon {
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}
