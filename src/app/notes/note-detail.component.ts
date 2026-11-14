import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonNote, IonText, IonList, IonListHeader,
  IonItem, IonLabel, ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { lockClosed, lockOpen, time, locate, trashOutline, navigate, camera, compassOutline, createOutline, personCircleOutline } from 'ionicons/icons';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { NotesService } from '../core/notes.service';
import { UnlockService } from '../core/unlock.service';
import { LocationService } from '../core/location.service';
import { MAX_ACCURACY_M, UNLOCK_FIXES } from '../core/note';
import { AuthService } from '../core/auth.service';
import { ApiService, errorMessage } from '../core/api.service';
import { Ui } from '../core/ui';
import { PhotoService } from '../core/photo.service';
import { NoteFormComponent, NoteFormResult } from './note-form.component';
import { jpegDataUrl } from '../core/photo';
import { HttpErrorResponse } from '@angular/common/http';
import { bearingDeg, compassPoint, formatDistance } from '../core/geo';
import { HeadingService, arrowRotation } from '../core/heading.service';

@Component({
  selector: 'app-note-detail',
  templateUrl: 'note-detail.component.html',
  styleUrls: ['note-detail.component.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon, IonNote, IonText, IonList, IonListHeader, IonItem, IonLabel,
    DatePipe, DecimalPipe],
})
export class NoteDetailComponent {
  // Set via componentProps (plain @Input, see NoteFormComponent).
  @Input({ required: true }) set noteId(id: string) {
    this.id.set(id);
  }

  private modals = inject(ModalController);
  private notesService = inject(NotesService);
  private unlock = inject(UnlockService);
  private location = inject(LocationService);
  private auth = inject(AuthService);
  private ui = inject(Ui);
  private photos = inject(PhotoService);
  private api = inject(ApiService);
  readonly compass = inject(HeadingService);
  readonly arrowRotation = arrowRotation;

  private id = signal('');
  readonly note = computed(() => this.notesService.notes().find((n) => n.id === this.id()));
  readonly state = computed(() => this.unlock.states().get(this.id()));
  readonly openedAt = computed(() => this.notesService.opened()[this.id()]);
  readonly canDelete = computed(() => !!this.note()?.isMine || this.auth.user()?.role === 'admin');
  /** Direction from me to the note, for the arrow while it is still far. */
  readonly bearing = computed(() => {
    const pos = this.location.position();
    const note = this.note();
    return pos && note ? bearingDeg({ lat: pos.coords.latitude, lon: pos.coords.longitude }, note) : null;
  });
  readonly formatDistance = formatDistance;
  readonly compassPoint = compassPoint;
  /** Full photo once the note is readable (from the phone, or downloaded); undefined while loading. */
  readonly photo = signal<string | null | undefined>(undefined);
  /** Own note: who opened it (online only); null when it could not be loaded. */
  readonly opens = signal<{ username: string; openedAt: string }[] | null>(null);
  readonly maxAccuracy = MAX_ACCURACY_M;
  readonly fixesNeeded = UNLOCK_FIXES;

  constructor() {
    addIcons({ lockClosed, lockOpen, time, locate, trashOutline, navigate, camera, compassOutline, createOutline, personCircleOutline });
    this.location.start();   // keep positioning while the modal covers the map
    effect(() => {
      const note = this.note();
      if (!note?.hasPhoto || this.state()?.kind !== 'readable') return;
      this.photos.get(note.id).then((url) => this.photo.set(url));
    });
    let loadedOpens = '';
    effect(() => {
      const note = this.note();
      if (!note?.isMine || !note.openCount || loadedOpens === note.id) return;
      loadedOpens = note.id;
      this.api.get<{ username: string; openedAt: string }[]>(`/notes/${note.id}/opens`)
        .then((list) => this.opens.set(list), () => this.opens.set(null));
    });
  }

  async open() {
    if (this.state()?.kind !== 'unlockable') return;
    await this.notesService.markOpened(this.id());
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    // Show text and photo at once (no scrolling in the half-height sheet).
    (await this.modals.getTop())?.setCurrentBreakpoint(0.9).catch(() => {});
  }

  /** Edit my own note in the same form (place stays). */
  async edit() {
    const note = this.note();
    if (!note) return;
    const modal = await this.modals.create({
      component: NoteFormComponent, componentProps: { existing: note, existingPhotoUrl: this.photo() ?? null },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<NoteFormResult>();
    if (role !== 'confirm' || !data) return;
    try {
      await this.notesService.updateNote(note.id, data);
      if (data.photo) this.photo.set(jpegDataUrl(data.photo.jpeg));
      else if (data.removePhoto) this.photo.set(null);
      this.ui.toast('Note saved', 'success');
    } catch (err) {
      const offline = err instanceof HttpErrorResponse && err.status === 0;
      this.ui.toast(offline ? 'Editing needs a network connection. Try again later.' : errorMessage(err), 'danger');
    }
  }

  async remove() {
    const note = this.note();
    if (!note) return;
    const text = note.isMine ? 'Delete your note for good?' : `Delete the note from ${note.author} (moderation)?`;
    if (!(await this.ui.confirm('Delete note', text, 'Delete', true))) return;
    try {
      await this.notesService.deleteNote(note.id);
      this.ui.toast('Note deleted');
      this.close();
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  close() {
    this.modals.dismiss();
  }
}
