// Pronunciation through the browser's built-in speech synthesis (free, offline
// on most systems). The button is only offered when a Swedish voice exists.

let voice: SpeechSynthesisVoice | null = null;
let ready = false;

function pickVoice(): void {
  const voices = globalThis.speechSynthesis?.getVoices() ?? [];
  const swedish = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('sv'));
  voice = swedish.find((v) => v.localService) ?? swedish[0] ?? null;
  ready = voices.length > 0;
}

export function initSpeech(): void {
  if (!globalThis.speechSynthesis) return;
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function canSpeak(): boolean {
  if (!ready) pickVoice();
  return !!voice;
}

export function speak(text: string): void {
  if (!voice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}
