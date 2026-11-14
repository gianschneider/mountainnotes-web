import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton, IonLabel,
  IonList, IonItem, IonNote, ModalController,
} from '@ionic/angular';
import { NotesService } from '../core/notes.service';
import { OutboxService } from '../core/outbox.service';
import { NoteDetailComponent } from '../notes/note-detail.component';
import { NOTE_GLYPH, NoteKind } from '../notes/note-kind';

interface ListedNote {
  id: string;
  kind: NoteKind;
  body: string;
  meta: string;
  date: string;
  synced: boolean;     // only synced notes have a detail view
}

/** My placed and found notes, from what is stored on the phone (a first step towards the tour book). */
@Component({
  selector: 'app-my-notes',
  templateUrl: 'my-notes.page.html',
  styleUrls: ['my-notes.page.scss'],
  imports: [
    DatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton,
    IonLabel, IonList, IonItem, IonNote,
  ],
})
export class MyNotesPage {
  private notesService = inject(NotesService);
  private outbox = inject(OutboxService);
  private modals = inject(ModalController);

  readonly view = signal<'placed' | 'found'>('placed');
  readonly glyph = NOTE_GLYPH;

  readonly placed = computed<ListedNote[]>(() => {
    const synced = this.notesService.notes().filter((n) => n.isMine);
    const ids = new Set(synced.map((n) => n.id));
    const waiting = this.outbox.entries().filter((e) => !ids.has(e.note.id) && e.status !== 'synced');
    return [
      ...waiting.map((e) => ({
        id: e.note.id, kind: e.status as NoteKind, body: e.note.body, date: e.note.createdAt, synced: false,
        meta: `for ${e.audienceLabel} · ${e.status === 'pending' ? 'waiting for upload' : 'rejected: ' + (e.error ?? '')}`,
      })),
      ...synced.map((n) => ({
        id: n.id, kind: 'mine' as NoteKind, body: n.body, date: n.createdAt, synced: true,
        meta: `for ${n.audienceLabel ?? 'everyone'} · opened ${n.openCount ?? 0}×`,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));
  });

  readonly found = computed<ListedNote[]>(() => {
    const opened = this.notesService.opened();
    return this.notesService.notes()
      .filter((n) => !n.isMine && (n.openedByMe || n.id in opened))
      .map((n) => ({
        id: n.id, kind: 'opened' as NoteKind, body: n.body, date: opened[n.id] ?? n.createdAt, synced: true,
        meta: `from ${n.author}`,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  async open(note: ListedNote) {
    if (!note.synced) return;
    const modal = await this.modals.create({ component: NoteDetailComponent, componentProps: { noteId: note.id } });
    await modal.present();
  }
}
