// BREACHLINE — synthesized sound. No audio files: every effect is built
// from oscillators and filtered noise through the Web Audio API, so the
// game stays fully offline and the dossier stays small. All sounds are
// guarded: if the AudioContext cannot start (or the player muted), the
// game simply plays silent.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(duration) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst({ dur, freq, type = 'lowpass', gain = 0.5, q = 1, when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq, freqEnd, dur, type = 'sine', gain = 0.3, when = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const sounds = {
    unlock() { ensure(); },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; },
    isMuted() { return muted; },

    shot(weaponId) {
      if (weaponId === 'lm88') {
        burst({ dur: 0.28, freq: 900, gain: 0.9, q: 0.7 });
        tone({ freq: 160, freqEnd: 55, dur: 0.22, type: 'triangle', gain: 0.7 });
      } else if (weaponId === 'vk9') {
        burst({ dur: 0.09, freq: 2400, gain: 0.42 });
        tone({ freq: 220, freqEnd: 90, dur: 0.07, type: 'square', gain: 0.16 });
      } else if (weaponId === 'ar77') {
        burst({ dur: 0.14, freq: 1700, gain: 0.6 });
        tone({ freq: 190, freqEnd: 70, dur: 0.1, type: 'triangle', gain: 0.35 });
      } else {
        burst({ dur: 0.08, freq: 3000, gain: 0.35 });
      }
    },
    distantShot() {
      burst({ dur: 0.12, freq: 700, gain: 0.16 });
    },
    hit() { tone({ freq: 1250, dur: 0.05, type: 'square', gain: 0.14 }); },
    headshot() {
      tone({ freq: 1560, dur: 0.05, type: 'square', gain: 0.16 });
      tone({ freq: 2090, dur: 0.07, type: 'square', gain: 0.14, when: 0.05 });
    },
    kill() {
      tone({ freq: 880, dur: 0.09, type: 'triangle', gain: 0.22 });
      tone({ freq: 1320, dur: 0.12, type: 'triangle', gain: 0.2, when: 0.08 });
    },
    reload() {
      tone({ freq: 500, dur: 0.04, type: 'square', gain: 0.12 });
      tone({ freq: 340, dur: 0.04, type: 'square', gain: 0.12, when: 0.35 });
      tone({ freq: 620, dur: 0.05, type: 'square', gain: 0.14, when: 0.75 });
    },
    dryFire() { tone({ freq: 900, dur: 0.03, type: 'square', gain: 0.1 }); },
    hurt() {
      burst({ dur: 0.1, freq: 500, gain: 0.3 });
      tone({ freq: 130, freqEnd: 70, dur: 0.14, type: 'sawtooth', gain: 0.18 });
    },
    step() { burst({ dur: 0.05, freq: 420, gain: 0.07 }); },
    plantBeep() { tone({ freq: 980, dur: 0.08, type: 'square', gain: 0.2 }); },
    plantStart() {
      tone({ freq: 660, dur: 0.1, type: 'square', gain: 0.2 });
      tone({ freq: 660, dur: 0.1, type: 'square', gain: 0.2, when: 0.18 });
    },
    defuseBeep() { tone({ freq: 1180, dur: 0.06, type: 'square', gain: 0.16 }); },
    explosion() {
      burst({ dur: 1.4, freq: 320, gain: 1.0, q: 0.5 });
      tone({ freq: 90, freqEnd: 28, dur: 1.1, type: 'sine', gain: 0.9 });
      burst({ dur: 0.5, freq: 2400, gain: 0.35, when: 0.02 });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', gain: 0.22, when: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.2, when: i * 0.13 }));
    },
    buy() {
      tone({ freq: 740, dur: 0.06, type: 'square', gain: 0.14 });
      tone({ freq: 988, dur: 0.08, type: 'square', gain: 0.14, when: 0.06 });
    },
    denied() { tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.16 }); },
    click() { tone({ freq: 700, dur: 0.03, type: 'square', gain: 0.1 }); },
  };
  return sounds;
}
