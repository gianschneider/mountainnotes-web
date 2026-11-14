import { Component, ElementRef, Input, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonList, IonItem, IonTextarea, IonInput,
  IonSegment, IonSegmentButton, IonLabel, IonSelect, IonSelectOption, IonNote, IonText, IonListHeader, IonToggle,
  IonIcon, IonSpinner, ModalController,
} from '@ionic/angular';
import { GroupsService } from '../core/groups.service';
import { ApiService } from '../core/api.service';
import { Audience, DEFAULT_UNLOCK_RADIUS_M, DEFAULT_VALIDITY_YEARS, NewNote, SyncedNote, UNLOCK_RADIUS_OPTIONS, uuidv4 } from '../core/note';
import { LatLon } from '../core/geo';
import { NotePhoto, jpegDataUrl, preparePhoto } from '../core/photo';
import { addIcons } from 'ionicons';
import { cameraOutline, closeCircle } from 'ionicons/icons';
import { Ui } from '../core/ui';

export interface NoteFormResult {
  note: NewNote;
  audienceLabel: string;
  photo?: NotePhoto;       // new or replaced photo
  removePhoto?: boolean;   // edit mode: the existing photo was removed
}

/** "YYYY-MM-DD" in local time */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Quick choices for how long a note stays visible; "custom" shows the date fields. */
export type Validity = 'week' | 'month' | 'year' | 'years2' | 'custom';
const VALIDITY_OPTIONS: { value: Validity; label: string }[] = [
  { value: 'week', label: '1 week' },
  { value: 'month', label: '1 month' },
  { value: 'year', label: '1 year' },
  { value: 'years2', label: '2 years' },
];

function addValidity(d: Date, validity: Exclude<Validity, 'custom'>): Date {
  const r = new Date(d);
  if (validity === 'week') r.setDate(r.getDate() + 7);
  else if (validity === 'month') r.setMonth(r.getMonth() + 1);
  else r.setFullYear(r.getFullYear() + (validity === 'year' ? 1 : DEFAULT_VALIDITY_YEARS));
  return r;
}

function parseDate(value: string, endOfDay: boolean): Date {
  const [y, m, d] = value.split('-').map(Number);
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
}

function germanDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}.${m}.${y}`;
}

@Component({
  selector: 'app-note-form',
  templateUrl: 'note-form.component.html',
  styleUrls: ['note-form.component.scss'],
  imports: [
    FormsModule, DecimalPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonList, IonItem,
    IonTextarea, IonInput, IonSegment, IonSegmentButton, IonLabel, IonSelect, IonSelectOption, IonNote, IonText,
    IonListHeader, IonToggle, IonIcon, IonSpinner,
  ],
})
export class NoteFormComponent implements OnInit {
  // Set via componentProps. Plain @Input()s: depending on the setup Ionic assigns
  // componentProps with Object.assign (which would overwrite signal inputs) or with setInput.
  // New note (map page): position, gnss, adjustM. Editing (detail): existing and its photo.
  @Input() position!: LatLon;
  @Input() gnss!: LatLon & { accuracy: number };
  @Input() adjustM = 0;
  @Input() existing?: SyncedNote;
  @Input() existingPhotoUrl?: string | null;

  private modals = inject(ModalController);
  private api = inject(ApiService);
  private ui = inject(Ui);
  readonly groups = inject(GroupsService).groups;

  private today = new Date();
  readonly minDate = isoDate(this.today);

  // Narrow audience by default (privacy): my first group, otherwise a single person.
  audience = signal<Audience>(this.groups().length ? 'group' : 'user');
  groupId = this.groups()[0]?.id ?? '';
  username = '';
  usernameHint = signal<string | null>(null);
  body = '';
  readonly validityOptions = VALIDITY_OPTIONS;
  readonly radiusOptions = UNLOCK_RADIUS_OPTIONS;
  radius = signal(DEFAULT_UNLOCK_RADIUS_M);
  validity = signal<Validity>('years2');
  from = isoDate(this.today);
  until = isoDate(addValidity(this.today, 'years2'));

  error = signal<string | null>(null);
  photo = signal<NotePhoto | null>(null);
  photoBusy = signal(false);
  private keptPhotoUrl = signal<string | null>(null);   // edit mode: the photo the note already has
  readonly photoUrl = computed(() => {
    const photo = this.photo();
    return photo ? jpegDataUrl(photo.jpeg) : this.keptPhotoUrl();
  });

  /** Edit mode: fill the form from the note (the place cannot change: a note is made where you stand). */
  ngOnInit() {
    const n = this.existing;
    if (!n) return;
    this.position = { lat: n.lat, lon: n.lon };
    this.gnss = { lat: n.lat, lon: n.lon, accuracy: 0 };
    this.body = n.body;
    this.audience.set(n.audience);
    if (n.audience === 'group' && n.audienceGroupId) this.groupId = n.audienceGroupId;
    if (n.audience === 'user') this.username = n.audienceLabel ?? '';
    this.radius.set(n.unlockRadius);
    this.validity.set('custom');
    this.from = isoDate(new Date(n.validFrom));
    this.until = isoDate(new Date(n.validUntil));
    this.keptPhotoUrl.set(this.existingPhotoUrl ?? null);
  }

  constructor() {
    addIcons({ cameraOutline, closeCircle });
  }

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /**
   * Web app: open the phone's own picker (iOS and Android offer "Take photo" and the photo library there).
   * The click must happen right in the tap handler, otherwise browsers (Safari above all) block the picker.
   */
  addPhoto() {
    const input = this.fileInput().nativeElement;
    input.value = '';   // picking the same file again must fire "change" too
    input.click();
  }

  /** The photo is resized and stripped of EXIF (incl. GPS) before it is stored. */
  async onPhotoPicked(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    this.photoBusy.set(true);
    try {
      this.photo.set(await preparePhoto(url));
    } catch (err) {
      console.error('Photo failed', err);
      this.ui.toast('The photo could not be read. Please choose a JPEG or PNG photo.', 'danger');
    } finally {
      URL.revokeObjectURL(url);
      this.photoBusy.set(false);
    }
  }

  removePhoto() {
    this.photo.set(null);
    this.keptPhotoUrl.set(null);
  }
  readonly audienceOptions = computed(() => [
    { value: 'group', label: 'Group', disabled: !this.groups().length },
    { value: 'user', label: 'Person', disabled: false },
    { value: 'public', label: 'Everyone', disabled: false },
  ]);

  /** Exact lookup when online; offline the server checks the name on upload. */
  async checkUsername() {
    const name = this.username.trim();
    if (!name) return this.usernameHint.set(null);
    try {
      await this.api.get(`/users/${encodeURIComponent(name)}`);
      this.usernameHint.set(null);
    } catch (err) {
      const offline = err instanceof HttpErrorResponse && err.status === 0;
      this.usernameHint.set(offline ? 'Offline: the name is checked on upload.' : 'This user does not exist.');
    }
  }

  setCustom(custom: boolean) {
    this.setValidity(custom ? 'custom' : 'years2');
  }

  setValidity(validity: Validity) {
    this.validity.set(validity);
    if (validity === 'custom') return;            // keep the current dates as a starting point
    this.from = this.minDate;
    this.until = isoDate(addValidity(this.today, validity));
  }

  /** "ab sofort" or "ab 12.11.2026" */
  fromLabel(): string {
    return !this.from || this.from <= this.minDate ? 'right away' : `from ${germanDate(this.from)}`;
  }

  untilLabel(): string {
    return this.until ? germanDate(this.until) : '–';
  }

  cancel() {
    this.modals.dismiss(null, 'cancel');
  }

  save() {
    const result = this.build();
    if (typeof result === 'string') return this.error.set(result);
    this.modals.dismiss(result, 'confirm');
  }

  private build(): NoteFormResult | string {
    const body = this.body.trim();
    if (!body) return 'Write something in the note.';
    if (!this.from || !this.until) return 'Please choose a start and an end date.';

    const now = new Date();
    // "From today" means readable immediately, a later date means from midnight of that day.
    const validFrom = this.from === isoDate(now) ? now : parseDate(this.from, false);
    const validUntil = parseDate(this.until, true);
    if (validUntil <= validFrom) return 'The end date must be after the start date.';

    const audience = this.audience();
    let audienceLabel = 'Everyone';
    const extra: Partial<NewNote> = {};
    if (audience === 'group') {
      const group = this.groups().find((g) => g.id === this.groupId);
      if (!group) return 'Please choose a group.';
      extra.audienceGroupId = group.id;
      audienceLabel = group.name;
    } else if (audience === 'user') {
      const username = this.username.trim().toLowerCase();
      if (!username) return 'Please enter the username of the person.';
      extra.audienceUsername = username;
      audienceLabel = username;
    }

    const pos = this.position;
    const gnss = this.gnss;
    return {
      audienceLabel,
      photo: this.photo() ?? undefined,
      removePhoto: !!this.existing?.hasPhoto && !this.photo() && !this.keptPhotoUrl(),
      note: {
        id: this.existing?.id ?? uuidv4(),
        lat: pos.lat,
        lon: pos.lon,
        gnssLat: gnss.lat,
        gnssLon: gnss.lon,
        gnssAccuracy: gnss.accuracy,
        unlockRadius: this.radius(),
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        audience,
        ...extra,
        body,
        createdAt: this.existing?.createdAt ?? now.toISOString(),
      },
    };
  }
}
