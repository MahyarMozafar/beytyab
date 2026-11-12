// A soft paper sound for page turns. It is made from filtered noise in the
// browser, so there is no sound file to download. Off until the visitor
// turns it on.

let enabled = false;
let context = null;

export const soundIsOn = () => enabled;

export function setSound(on) {
  enabled = Boolean(on);
}

export function pageSound() {
  if (!enabled) return;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') context.resume();
    const seconds = 0.42;
    const frames = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) samples[i] = Math.random() * 2 - 1;

    const source = context.createBufferSource();
    source.buffer = buffer;

    // A band of hiss that slides upward sounds like paper moving through air.
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    const now = context.currentTime;
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + seconds * 0.7);
    filter.frequency.exponentialRampToValueAtTime(1400, now + seconds);

    const volume = context.createGain();
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(0.16, now + seconds * 0.35);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    source.connect(filter).connect(volume).connect(context.destination);
    source.start(now);
    source.stop(now + seconds);
  } catch { /* sound is a nicety; never let it break the page */ }
}
