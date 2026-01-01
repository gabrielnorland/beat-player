// Beat Player Test - Web Audio (2-bar loop, synced scheduling)

let audioCtx = null;

// Master chain: mix -> gentle "limiting" compressor -> output
let masterGain, masterComp;

// Timing
let bpm = 85;
let isRunning = false;

const stepsPerBar = 16;     // 16th notes in a 4/4 bar
const bars = 2;
const totalSteps = stepsPerBar * bars; // 32 steps
let currentStep = 0;
let nextStepTime = 0;

const scheduleAheadTime = 0.12; // seconds
const lookaheadMs = 25;         // scheduler interval
let schedulerTimer = null;

// Toggles
const state = {
  drums: false,
  djembe: false,
  melody: false,
};

// Melody pattern (indexed by 16th step). We'll place notes on 8ths (every 2 steps).
let melodyPattern = makeNewMelodyPattern();

// ---------- UI ----------
const btnDrums = document.getElementById("btnDrums");
const btnDjembe = document.getElementById("btnDjembe");
const btnMelody = document.getElementById("btnMelody");
const btnDice = document.getElementById("btnDice");

const bpmSlider = document.getElementById("bpm");
const bpmText = document.getElementById("bpmText");

bpmSlider.addEventListener("input", () => {
  bpm = parseInt(bpmSlider.value, 10);
  bpmText.textContent = String(bpm);
});

// Toggle buttons
btnDrums.addEventListener("click", async () => {
  await ensureAudio();
  state.drums = !state.drums;
  setButtonState(btnDrums, state.drums);
  startIfNeeded();
});

btnDjembe.addEventListener("click", async () => {
  await ensureAudio();
  state.djembe = !state.djembe;
  setButtonState(btnDjembe, state.djembe);
  startIfNeeded();
});

btnMelody.addEventListener("click", async () => {
  await ensureAudio();
  state.melody = !state.melody;
  setButtonState(btnMelody, state.melody);
  startIfNeeded();
});

btnDice.addEventListener("click", async () => {
  await ensureAudio();
  melodyPattern = makeNewMelodyPattern();
  // brief visual press
  btnDice.classList.add("is-on");
  setTimeout(() => btnDice.classList.remove("is-on"), 120);
  startIfNeeded();
});

function setButtonState(btn, on){
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

// ---------- Audio setup ----------
async function ensureAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;

    // Compressor as "auto limiter" (gentle)
    masterComp = audioCtx.createDynamicsCompressor();
    masterComp.threshold.value = -18;
    masterComp.knee.value = 24;
    masterComp.ratio.value = 6;
    masterComp.attack.value = 0.003;
    masterComp.release.value = 0.12;

    masterGain.connect(masterComp);
    masterComp.connect(audioCtx.destination);
  }

  if (audioCtx.state !== "running"){
    await audioCtx.resume();
  }
}

function startIfNeeded(){
  if (!isRunning && (state.drums || state.djembe || state.melody)){
    startScheduler();
  }
}

// ---------- Scheduler ----------
function startScheduler(){
  isRunning = true;
  currentStep = 0;
  nextStepTime = audioCtx.currentTime + 0.05;

  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(() => schedulerTick(), lookaheadMs);
}

function stopScheduler(){
  isRunning = false;
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

function secondsPer16th(){
  // 1 beat = quarter note
  // 16th = beat / 4
  return (60 / bpm) / 4;
}

function schedulerTick(){
  // If nothing is on, stop to save CPU
  if (!state.drums && !state.djembe && !state.melody){
    stopScheduler();
    return;
  }

  while (nextStepTime < audioCtx.currentTime + scheduleAheadTime){
    scheduleStep(currentStep, nextStepTime);
    advanceStep();
  }
}

function advanceStep(){
  currentStep = (currentStep + 1) % totalSteps;
  nextStepTime += secondsPer16th();
}

// ---------- Patterns ----------
function scheduleStep(step, t){
  if (state.drums) scheduleRockBeat(step, t);
  if (state.djembe) scheduleDjembe(step, t);
  if (state.melody) scheduleMelody(step, t);
}

// Rock beat: kick + snare backbeat + hats (2 bars)
function scheduleRockBeat(step, t){
  // Steps per beat = 4 (16ths)
  const stepInBar = step % stepsPerBar;

  // Hi-hat on 8ths (every 2 steps)
  if (stepInBar % 2 === 0){
    hat(t, 0.045);
  }

  // Kick on beat 1 and 3 (step 0 and 8), plus a little push on "and of 3" (step 10)
  if (stepInBar === 0 || stepInBar === 8 || stepInBar === 10){
    kick(t, 0.11);
  }

  // Snare on beats 2 and 4 (step 4 and 12) => classic backbeat
  if (stepInBar === 4 || stepInBar === 12){
    snare(t, 0.14);
  }
}

// Djembe layer: lightly syncopated, not too busy
function scheduleDjembe(step, t){
  const stepInBar = step % stepsPerBar;

  // A simple repeating pattern (feel free to tweak)
  // Hits on: 3, 6, 9, 14 (0-based 16ths) in each bar
  const hits = new Set([3, 6, 9, 14]);
  if (hits.has(stepInBar)){
    djembe(t, 0.12, stepInBar === 14 ? 150 : 120);
  }
}

// Melody: notes only on 8ths (even 16th steps)
function scheduleMelody(step, t){
  const note = melodyPattern[step];
  if (!note) return;

  // 8th note duration-ish (short, to avoid busy)
  const dur = Math.min(0.22, secondsPer16th() * 2 * 0.9);
  triNote(t, dur, midiToHz(note));
}

// ---------- Melody generation ----------
function makeNewMelodyPattern(){
  // Put notes on 8ths across 2 bars => 16 positions (every 2 steps).
  // We'll map them into 32-step array with nulls in-between.
  const pattern = new Array(totalSteps).fill(null);

  // C major scale (C4 to C5)
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];

  let last = 64;
  for (let i = 0; i < totalSteps; i += 2){
    // Not too busy: around 45% chance of a note
    const play = Math.random() < 0.45;

    if (!play){
      pattern[i] = null;
      continue;
    }

    // Choose a note near the last one to keep it musical
    const choices = scale.filter(n => Math.abs(n - last) <= 5);
    const pool = choices.length ? choices : scale;

    let pick = pool[Math.floor(Math.random() * pool.length)];

    // Occasionally jump for variety
    if (Math.random() < 0.12){
      pick = scale[Math.floor(Math.random() * scale.length)];
    }

    // Avoid too many repeated notes
    if (pick === last && Math.random() < 0.6){
      pick = scale[Math.floor(Math.random() * scale.length)];
    }

    pattern[i] = pick;
    last = pick;
  }

  return pattern;
}

function midiToHz(m){
  return 440 * Math.pow(2, (m - 69) / 12);
}

// ---------- Sound design helpers ----------
function makeGainEnv(t, attack, decay, sustain, release, peak=1.0){
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.linearRampToValueAtTime(peak * sustain, t + attack + decay);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay + release);
  return g;
}

// Melody synth: triangle + HPF + gentle envelope (avoid clicks)
function triNote(t, dur, freq){
  const osc = audioCtx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);

  const hpf = audioCtx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.setValueAtTime(180, t); // gentle HPF to keep it light
  hpf.Q.value = 0.7;

  // Small gain to keep headroom
  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.18, t + 0.008);
  env.gain.linearRampToValueAtTime(0.11, t + Math.min(0.06, dur * 0.5));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(hpf);
  hpf.connect(env);
  env.connect(masterGain);

  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Kick: sine with pitch drop + envelope
function kick(t, len){
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.08);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.85, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);

  // Slight lowpass to soften click
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(900, t);
  lp.Q.value = 0.7;

  osc.connect(lp);
  lp.connect(env);
  env.connect(masterGain);

  osc.start(t);
  osc.stop(t + len + 0.02);
}

// Snare: noise + bandpass + short env + tiny tone
function snare(t, len){
  // Noise
  const noise = makeNoiseBufferSource();
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1800, t);
  bp.Q.value = 0.9;

  const envN = audioCtx.createGain();
  envN.gain.setValueAtTime(0.0001, t);
  envN.gain.linearRampToValueAtTime(0.35, t + 0.003);
  envN.gain.exponentialRampToValueAtTime(0.0001, t + len);

  // Tiny tonal body
  const tone = audioCtx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(180, t);

  const envT = audioCtx.createGain();
  envT.gain.setValueAtTime(0.0001, t);
  envT.gain.linearRampToValueAtTime(0.10, t + 0.003);
  envT.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.09, len));

  noise.connect(bp);
  bp.connect(envN);
  envN.connect(masterGain);

  tone.connect(envT);
  envT.connect(masterGain);

  noise.start(t);
  noise.stop(t + len + 0.02);

  tone.start(t);
  tone.stop(t + len + 0.02);
}

// Hat: short highpassed noise
function hat(t, len){
  const noise = makeNoiseBufferSource();

  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(6500, t);
  hp.Q.value = 0.7;

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.12, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);

  noise.connect(hp);
  hp.connect(env);
  env.connect(masterGain);

  noise.start(t);
  noise.stop(t + len + 0.02);
}

// Djembe: short sine "thump" + bandpassed noise
function djembe(t, len, freq=120){
  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.06);

  const envO = audioCtx.createGain();
  envO.gain.setValueAtTime(0.0001, t);
  envO.gain.linearRampToValueAtTime(0.24, t + 0.003);
  envO.gain.exponentialRampToValueAtTime(0.0001, t + len);

  const noise = makeNoiseBufferSource();
  const bp = audioCtx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(900, t);
  bp.Q.value = 1.2;

  const envN = audioCtx.createGain();
  envN.gain.setValueAtTime(0.0001, t);
  envN.gain.linearRampToValueAtTime(0.08, t + 0.003);
  envN.gain.exponentialRampToValueAtTime(0.0001, t + len * 0.9);

  osc.connect(envO);
  envO.connect(masterGain);

  noise.connect(bp);
  bp.connect(envN);
  envN.connect(masterGain);

  osc.start(t);
  osc.stop(t + len + 0.02);

  noise.start(t);
  noise.stop(t + len + 0.02);
}

// Noise buffer helper (cheap + click-free with envelopes)
function makeNoiseBufferSource(){
  const bufferSize = audioCtx.sampleRate * 0.25; // 250ms
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++){
    data[i] = (Math.random() * 2 - 1);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  return src;
}
