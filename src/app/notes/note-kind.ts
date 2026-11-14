import { UnlockState } from '../core/unlock.service';

/** What a note marker shows; also used by the nearby list and the legend. */
export type NoteKind = 'mine' | 'opened' | 'unlockable' | 'future' | 'locked' | 'pending' | 'failed';

export const NOTE_GLYPH: Record<NoteKind, string> = {
  mine: '✎', opened: '✓', unlockable: '🔓', future: '🕒', locked: '🔒', pending: '⇡', failed: '!',
};

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  locked: 'Locked: go there to open',
  unlockable: 'You are there: open now',
  opened: 'Opened by you',
  future: 'Not readable yet',
  mine: 'Your note',
  pending: 'Your note, waiting for upload',
  failed: 'Your note, rejected by the server',
};

export function noteKind(state: UnlockState | undefined, isMine: boolean): NoteKind {
  switch (state?.kind) {
    case 'readable': return isMine ? 'mine' : 'opened';
    case 'unlockable': return 'unlockable';
    case 'future': return 'future';
    default: return 'locked';
  }
}

/** Marker pin as HTML for a Leaflet DivIcon (styles in global.scss). */
export function notePinHtml(kind: NoteKind): string {
  return `<div class="note-pin note-pin--${kind}"><span>${NOTE_GLYPH[kind]}</span></div>`;
}
