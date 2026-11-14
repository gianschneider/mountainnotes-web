import { Component, computed, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonList, IonItem, IonLabel, IonButton,
  IonIcon, IonNote,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { trashOutline, cloudDownloadOutline } from 'ionicons/icons';
import { MapRegion, OfflineMapService } from '../core/offline-map.service';
import { Ui } from '../core/ui';

/** Downloaded map regions with their size; deleting frees the space. */
@Component({
  selector: 'app-offline-maps',
  templateUrl: 'offline-maps.page.html',
  imports: [
    DatePipe, DecimalPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonList, IonItem,
    IonLabel, IonButton, IonIcon, IonNote,
  ],
})
export class OfflineMapsPage {
  private offlineMap = inject(OfflineMapService);
  private ui = inject(Ui);

  readonly regions = this.offlineMap.regions;
  readonly totalMb = computed(() => this.regions().reduce((sum, r) => sum + r.bytes, 0) / 1e6);

  constructor() {
    addIcons({ trashOutline, cloudDownloadOutline });
  }

  async remove(region: MapRegion) {
    if (!(await this.ui.confirm('Delete offline map', `Delete «${region.name}» from the phone?`, 'Delete', true))) return;
    await this.offlineMap.remove(region);
    this.ui.toast('Offline map deleted');
  }
}
