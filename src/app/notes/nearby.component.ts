import { Component, computed, inject } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonNote, IonIcon, IonButtons, IonButton,
  ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { navigate, cameraOutline, compassOutline } from 'ionicons/icons';
import { NotesService } from '../core/notes.service';
import { UnlockService } from '../core/unlock.service';
import { LocationService } from '../core/location.service';
import { bearingDeg, compassPoint, distanceM, formatDistance } from '../core/geo';
import { HeadingService, arrowRotation } from '../core/heading.service';
import { NOTE_GLYPH, NOTE_KIND_LABEL, NoteKind, noteKind } from './note-kind';

interface NearbyNote {
  id: string;
  kind: NoteKind;
  title: string;
  subtitle: string;
  hasPhoto: boolean;
  distance: number | null;
  bearing: number | null;
}

/** Sheet with the notes meant for me, nearest first; dismisses with the chosen note id (role "select"). */
@Component({
  selector: 'app-nearby',
  templateUrl: 'nearby.component.html',
  styleUrls: ['nearby.component.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonNote, IonIcon, IonButtons, IonButton],
})
export class NearbyComponent {
  private modals = inject(ModalController);
  private notesService = inject(NotesService);
  private unlock = inject(UnlockService);
  private location = inject(LocationService);
  readonly compass = inject(HeadingService);
  readonly arrowRotation = arrowRotation;

  readonly glyph = NOTE_GLYPH;
  readonly formatDistance = formatDistance;
  readonly compassPoint = compassPoint;

  readonly notes = computed<NearbyNote[]>(() => {
    const pos = this.location.position();
    const here = pos && { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const states = this.unlock.states();
    return this.notesService.notes()
      .map((n) => {
        const kind = noteKind(states.get(n.id), n.isMine);
        return {
          id: n.id,
          kind,
          title: n.isMine ? `Your note for ${n.audienceLabel ?? 'everyone'}` : `From ${n.author}`,
          hasPhoto: n.hasPhoto,
          subtitle: n.isMine ? `opened ${n.openCount ?? 0}× on the spot` : NOTE_KIND_LABEL[kind],
          distance: here ? distanceM(here, n) : null,
          bearing: here ? bearingDeg(here, n) : null,
        };
      })
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  });

  constructor() {
    addIcons({ navigate, cameraOutline, compassOutline });
  }

  select(id: string) {
    this.modals.dismiss(id, 'select');
  }
}
