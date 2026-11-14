import { Injectable, computed, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { NoteKind } from './note-kind';

/** Groups the map can hide; the nearby list always shows everything. */
export type FilterGroup = 'toOpen' | 'opened' | 'mine';

export const FILTER_GROUPS: { group: FilterGroup; label: string; kinds: NoteKind[] }[] = [
  { group: 'toOpen', label: 'To open', kinds: ['locked', 'unlockable', 'future'] },
  { group: 'opened', label: 'Opened by me', kinds: ['opened'] },
  { group: 'mine', label: 'My notes', kinds: ['mine', 'pending', 'failed'] },
];

const KEY = 'map-filter';
const ZONES_KEY = 'map-zones';

/** Which note kinds the map shows and whether building zones are drawn; remembered on the phone. */
@Injectable({ providedIn: 'root' })
export class MapFilterService {
  readonly hidden = signal<ReadonlySet<FilterGroup>>(new Set());
  readonly active = computed(() => this.hidden().size > 0);
  /** Building zones (no notes allowed) drawn in red; a layer, not a filter, so it does not count as "Filter aktiv". */
  readonly zones = signal(true);
  private readonly hiddenKinds = computed(
    () => new Set(FILTER_GROUPS.filter((g) => this.hidden().has(g.group)).flatMap((g) => g.kinds)),
  );

  constructor() {
    Preferences.get({ key: KEY })
      .then(({ value }) => value && this.hidden.set(new Set(JSON.parse(value) as FilterGroup[])))
      .catch(() => {});
    Preferences.get({ key: ZONES_KEY })
      .then(({ value }) => value && this.zones.set(value === 'true'))
      .catch(() => {});
  }

  setZones(visible: boolean) {
    this.zones.set(visible);
    Preferences.set({ key: ZONES_KEY, value: String(visible) }).catch(() => {});
  }

  shows(kind: NoteKind): boolean {
    return !this.hiddenKinds().has(kind);
  }

  set(group: FilterGroup, visible: boolean) {
    const next = new Set(this.hidden());
    if (visible) next.delete(group);
    else next.add(group);
    this.save(next);
  }

  reset() {
    this.save(new Set());
  }

  private save(hidden: Set<FilterGroup>) {
    this.hidden.set(hidden);
    Preferences.set({ key: KEY, value: JSON.stringify([...hidden]) }).catch(() => {});
  }
}
