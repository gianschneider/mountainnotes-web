import { Component, inject } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonToggle } from '@ionic/angular';
import { DEFAULT_UNLOCK_RADIUS_M, MAX_ACCURACY_M, PROXIMITY_M, UNLOCK_FIXES } from '../core/note';
import { NOTE_GLYPH, NOTE_KIND_LABEL, NoteKind } from './note-kind';
import { FILTER_GROUPS, MapFilterService } from './map-filter.service';

/** Map filter, marker colours and the unlock rules. */
@Component({
  selector: 'app-legend',
  templateUrl: 'legend.component.html',
  styleUrls: ['legend.component.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonToggle],
})
export class LegendComponent {
  readonly filter = inject(MapFilterService);
  readonly groups = FILTER_GROUPS;
  readonly kinds: NoteKind[] = ['locked', 'unlockable', 'opened', 'future', 'mine', 'pending', 'failed'];
  readonly glyph = NOTE_GLYPH;
  readonly label = NOTE_KIND_LABEL;
  readonly radius = DEFAULT_UNLOCK_RADIUS_M;
  readonly fixes = UNLOCK_FIXES;
  readonly accuracy = MAX_ACCURACY_M;
  readonly proximity = PROXIMITY_M;
}
