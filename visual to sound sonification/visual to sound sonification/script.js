(() => {
  "use strict";

  // =====================================
  // 1. ELEMENTS
  // =====================================

  const $ = id => document.getElementById(id);

  const canvas = $("imageCanvas");
  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const visual = $("visualCanvas");
  const vctx = visual.getContext("2d");

  const input = $("imageInput");
  const drop = $("dropZone");

  let audio = null;
  let master = null;
  let analyser = null;

  let bassFilter = null;
  let trebleFilter = null;

  let delay = null;
  let feedback = null;
  let reverb = null;

  let recordingDestination = null;
  let recorder = null;
  let recordedChunks = [];

  let imageLoaded = false;
  let playing = false;
  let recording = false;

  let currentMode = "dream";
  let sensitivity = 1;
  let lastSoundTime = 0;
  let lastFrequency = 440;
  let animationFrame = null;
  let lastRecordingBlob = null;

  // =====================================
  // 2. HELPERS
  // =====================================

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function setHint(message) {
    $("hint").textContent = message;
  }

  function setStatus(message, active = false) {
    $("systemStatus").innerHTML = `<i></i> ${message}`;
    $("systemStatus").style.color =
      active ? "#82f5ce" : "";

    $("soundState").textContent =
      active ? "PLAYING" : "STOPPED";
  }

  // =====================================
  // 3. SOUND MODES
  // =====================================

  const modes = {
    dream: {
      wave: "sine",
      multiplier: 1,
      sub: 0.5,
      upper: 2,
      attack: 0.1,
      duration: 0.9
    },

    ocean: {
      wave: "sine",
      multiplier: 0.75,
      sub: 0.5,
      upper: 1.25,
      attack: 0.18,
      duration: 1.2
    },

    galaxy: {
      wave: "triangle",
      multiplier: 1.3,
      sub: 0.5,
      upper: 2.5,
      attack: 0.05,
      duration: 0.8
    },

    nature: {
      wave: "sine",
      multiplier: 0.9,
      sub: 0.5,
      upper: 1.5,
      attack: 0.12,
      duration: 1
    },

    arcade: {
      wave: "square",
      multiplier: 1.5,
      sub: 0.5,
      upper: 2,
      attack: 0.02,
      duration: 0.35
    },

    cinematic: {
      wave: "triangle",
      multiplier: 0.8,
      sub: 0.25,
      upper: 2,
      attack: 0.2,
      duration: 1.5
    }
  };

  // =====================================
  // 4. CREATE REVERB
  // =====================================

  function createReverb() {
    const length = audio.sampleRate * 2;
    const impulse = audio.createBuffer(
      2,
      length,
      audio.sampleRate
    );

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);

      for (let i = 0; i < length; i++) {
        const fade = 1 - i / length;

        data[i] =
          (Math.random() * 2 - 1) *
          Math.pow(fade, 2.5);
      }
    }

    return impulse;
  }

  // =====================================
  // 5. INITIALIZE AUDIO
  // =====================================

  function setupAudio() {
    if (audio) return;

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error(
        "Your browser does not support Web Audio."
      );
    }

    audio = new AudioContextClass();

    // Main volume
    master = audio.createGain();
    master.gain.value = 0;

    // Bass
    bassFilter = audio.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 180;

    // Treble
    trebleFilter = audio.createBiquadFilter();
    trebleFilter.type = "highshelf";
    trebleFilter.frequency.value = 2500;

    // Echo
    delay = audio.createDelay(1);
    delay.delayTime.value = 0.25;

    feedback = audio.createGain();
    feedback.gain.value = 0.12;

    // Reverb
    reverb = audio.createConvolver();
    reverb.buffer = createReverb();

    const reverbVolume = audio.createGain();
    reverbVolume.gain.value = 0.2;

    // Visualizer
    analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Recording output
    recordingDestination =
      audio.createMediaStreamDestination();

    // Main sound route
    bassFilter.connect(trebleFilter);
    trebleFilter.connect(master);

    // Echo route
    trebleFilter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(master);

    // Reverb route
    trebleFilter.connect(reverb);
    reverb.connect(reverbVolume);
    reverbVolume.connect(master);

    // Output and recording
    master.connect(analyser);
    analyser.connect(audio.destination);
    master.connect(recordingDestination);

    updateAudioSettings();
  }

  // =====================================
  // 6. AUDIO SETTINGS
  // =====================================

  function updateAudioSettings() {
    if (!audio) return;

    const now = audio.currentTime;

    const volume =
      Number($("volume").value) / 100;

    const bass =
      Number($("bass").value);

    const treble =
      Number($("treble").value);

    const echo =
      Number($("echo").value) / 100;

    const reverbAmount =
      Number($("reverb").value) / 100;

    master.gain.setTargetAtTime(
      playing ? volume * 0.7 : 0,
      now,
      0.08
    );

    bassFilter.gain.setTargetAtTime(
      (bass - 50) * 0.25,
      now,
      0.08
    );

    trebleFilter.gain.setTargetAtTime(
      (treble - 50) * 0.24,
      now,
      0.08
    );

    feedback.gain.setTargetAtTime(
      echo * 0.4,
      now,
      0.08
    );

    // Keep feedback below unstable levels.
    reverb.buffer = reverb.buffer || createReverb();

    reverb.disconnect();

    const reverbVolume = audio.createGain();
    reverbVolume.gain.value = reverbAmount * 0.55;

    reverb.connect(reverbVolume);
    reverbVolume.connect(master);
  }

  // =====================================
  // 7. PLAY A SOUND
  // =====================================

  function playTone(frequency, brightness = 0.5) {
    if (!audio || !playing) return;

    const now = audio.currentTime;
    const mode = modes[currentMode];

    const volume =
      Number($("volume").value) / 100;

    const notes = [
      [frequency * mode.multiplier, 0.12, mode.wave],
      [frequency * mode.sub, 0.09, "sine"],
      [frequency * mode.upper, 0.035, "sine"]
    ];

    notes.forEach(([freq, loudness, waveform], index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();

      oscillator.type = waveform;

      oscillator.frequency.setValueAtTime(
        clamp(freq, 45, 1800),
        now
      );

      if (index === 0) {
        oscillator.detune.setValueAtTime(
          (brightness - 0.5) * 25,
          now
        );
      }

      const peak = Math.max(
        0.001,
        loudness * volume
      );

      gain.gain.setValueAtTime(0.0001, now);

      gain.gain.exponentialRampToValueAtTime(
        peak,
        now + mode.attack
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + mode.duration
      );

      oscillator.connect(gain);
      gain.connect(bassFilter);

      oscillator.start(now);
      oscillator.stop(now + mode.duration + 0.05);
    });

    lastFrequency = frequency;

    $("frequencyReadout").textContent =
      `${Math.round(frequency)} Hz · ${currentMode.toUpperCase()}`;
  }

  // =====================================
  // 8. START SOUND
  // =====================================

  async function startSound() {
    try {
      setupAudio();

      await audio.resume();

      playing = true;

      updateAudioSettings();

      setStatus("AUDIO ACTIVE", true);

      $("startBtn").textContent = "▶ Sound playing";
      $("stopBtn").disabled = false;
      $("recordBtn").disabled = false;

      setHint(
        imageLoaded
          ? "Move your finger or mouse across the image."
          : "Upload an image to explore its sounds."
      );

      playTone(440);

      startVisualizer();

    } catch (error) {
      console.error("SONORA audio error:", error);

      alert(
        "Could not start audio. Try Chrome and press Start Sound again.\n\n" +
        error.message
      );
    }
  }

  // =====================================
  // 9. STOP SOUND
  // =====================================

  function stopSound() {
    playing = false;

    if (audio && master) {
      master.gain.setTargetAtTime(
        0,
        audio.currentTime,
        0.05
      );
    }

    setStatus("SYSTEM READY");

    $("startBtn").textContent = "▶ Start sound";
    $("stopBtn").disabled = true;

    setHint("Sound stopped. Press Start Sound to continue.");

    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    drawStaticVisualizer();
  }

  // =====================================
  // 10. IMAGE UPLOAD
  // =====================================

  function loadImage(file) {
    if (!file || !file.type.startsWith("image/")) {
      alert("Please select a valid image.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const maxSize = 1400;

      const scale = Math.min(
        1,
        maxSize / Math.max(image.width, image.height)
      );

      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );

      imageLoaded = true;

      canvas.hidden = false;
      $("emptyState").hidden = true;
      $("canvasTag").hidden = false;

      $("imageName").textContent =
        file.name.toUpperCase();

      // Original image preview
      $("originalPreview").innerHTML = "";

      const preview = new Image();
      preview.src = canvas.toDataURL("image/jpeg", 0.85);
      preview.alt = "Uploaded image";

      $("originalPreview").appendChild(preview);

      analyzeColors();

      setHint(
        "Image loaded! Press Start Sound and explore its colours."
      );

      $("recordBtn").disabled = !audio;

      URL.revokeObjectURL(url);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      alert("Could not open this image.");
    };

    image.src = url;
  }

  // =====================================
  // 11. IMAGE COLOUR ANALYSIS
  // =====================================

  function analyzeColors() {
    const sample = document.createElement("canvas");

    sample.width = 100;
    sample.height = 100;

    const sampleCtx = sample.getContext("2d", {
      willReadFrequently: true
    });

    sampleCtx.drawImage(
      canvas,
      0,
      0,
      sample.width,
      sample.height
    );

    const pixels = sampleCtx.getImageData(
      0,
      0,
      sample.width,
      sample.height
    ).data;

    const colours = new Map();

    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i] >> 4;
      const g = pixels[i + 1] >> 4;
      const b = pixels[i + 2] >> 4;

      const key = `${r},${g},${b}`;

      colours.set(
        key,
        (colours.get(key) || 0) + 1
      );
    }

    const topColours = [...colours.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    $("palette").innerHTML = "";
    $("paletteStatus").textContent = "ANALYSIS COMPLETE";

    topColours.forEach(([key]) => {
      const [r, g, b] = key.split(",").map(
        n => Number(n) * 17
      );

      const hex = "#" + [r, g, b]
        .map(n => n.toString(16).padStart(2, "0"))
        .join("");

      const button = document.createElement("button");
      button.className = "swatch";
      button.style.background = hex;
      button.title = hex;

      const label = document.createElement("span");
      label.textContent = hex.toUpperCase();

      button.appendChild(label);

      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(hex);
          setHint(`${hex.toUpperCase()} copied.`);
        } catch {
          setHint(`Selected colour: ${hex.toUpperCase()}`);
        }
      });

      $("palette").appendChild(button);
    });
  }

  // =====================================
  // 12. MAP IMAGE POSITION TO SOUND
  // =====================================

  function scanImage(clientX, clientY) {
    if (!imageLoaded || !playing) return;

    const now = performance.now();

    if (now - lastSoundTime < 100) return;

    lastSoundTime = now;

    const rect = canvas.getBoundingClientRect();

    // Account for the image's contained aspect ratio.
    const canvasRatio = canvas.width / canvas.height;
    const boxRatio = rect.width / rect.height;

    let drawWidth = rect.width;
    let drawHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (canvasRatio > boxRatio) {
      drawHeight = rect.width / canvasRatio;
      offsetY = (rect.height - drawHeight) / 2;
    } else {
      drawWidth = rect.height * canvasRatio;
      offsetX = (rect.width - drawWidth) / 2;
    }

    const x = (clientX - rect.left - offsetX) / drawWidth;
    const y = (clientY - rect.top - offsetY) / drawHeight;

    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    const px = clamp(
      Math.floor(x * canvas.width),
      0,
      canvas.width - 1
    );

    const py = clamp(
      Math.floor(y * canvas.height),
      0,
      canvas.height - 1
    );

    const pixel = ctx.getImageData(
      px,
      py,
      1,
      1
    ).data;

    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];

    const brightness = (r + g + b) / 765;

    let frequency =
      110 +
      brightness * 420 +
      x * 140 +
      (1 - y) * 130;

    // Colour changes the tone.
    if (b > r && b > g) {
      frequency *= 1.2;
    } else if (g > r && g > b) {
      frequency *= 1.05;
    } else if (r > g && r > b) {
      frequency *= 0.85;
    }

    frequency = clamp(
      frequency * sensitivity,
      65,
      1500
    );

    playTone(frequency, brightness);

    $("generatedPreview").style.background =
      `radial-gradient(circle at ${x * 100}% ${y * 100}%,
      rgba(${r},${g},${b},.75), transparent 45%), #090b1c`;
  }

  canvas.addEventListener("pointermove", event => {
    scanImage(event.clientX, event.clientY);
  });

  canvas.addEventListener("pointerdown", event => {
    scanImage(event.clientX, event.clientY);
  });

  // =====================================
  // 13. VISUALIZER
  // =====================================

  function resizeVisualizer() {
    const rect = visual.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    visual.width = Math.max(1, Math.floor(rect.width * dpr));
    visual.height = Math.floor(220 * dpr);

    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBars(data) {
    const width = visual.clientWidth;
    const height = 220;

    vctx.clearRect(0, 0, width, height);

    const count = 48;
    const gap = 4;
    const barWidth = (width - gap * (count - 1)) / count;

    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * data.length / count);

      const value = data
        ? data[index] / 255
        : 0.035 + Math.abs(Math.sin(i * 0.4)) * 0.04;

      const barHeight = Math.max(5, value * 170);

      const x = i * (barWidth + gap);
      const y = (height - barHeight) / 2;

      const gradient = vctx.createLinearGradient(
        0,
        y,
        0,
        y + barHeight
      );

      gradient.addColorStop(0, "#63e6ff");
      gradient.addColorStop(0.55, "#9b7cff");
      gradient.addColorStop(1, "#ff78c8");

      vctx.fillStyle = gradient;

      // fillRect works in older browsers too.
      vctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  function drawStaticVisualizer() {
    drawBars(null);
  }

  function startVisualizer() {
    if (!analyser || !playing) return;

    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }

    const data = new Uint8Array(
      analyser.frequencyBinCount
    );

    function animate() {
      if (!playing) {
        animationFrame = null;
        return;
      }

      analyser.getByteFrequencyData(data);
      drawBars(data);

      animationFrame = requestAnimationFrame(animate);
    }

    animate();
  }

  // =====================================
  // 14. RECORD AUDIO
  // =====================================

  function startRecording() {
    if (!window.MediaRecorder) {
      alert("Audio recording is not supported in this browser.");
      return;
    }

    if (!recordingDestination || !playing) {
      alert("Start the sound before recording.");
      return;
    }

    try {
      recordedChunks = [];

      let options = {};

      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options.mimeType = "audio/webm";
      }

      recorder = new MediaRecorder(
        recordingDestination.stream,
        options
      );

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        lastRecordingBlob = new Blob(
          recordedChunks,
          {
            type: recorder.mimeType || "audio/webm"
          }
        );

        $("saveBtn").disabled = false;

        $("recordBtn").textContent = "● Record soundtrack";

        setHint("Recording complete. You can now save your soundtrack.");

        downloadBlob(
          lastRecordingBlob,
          "sonora-soundtrack.webm"
        );
      };

      recorder.start();

      recording = true;

      $("recordBtn").textContent = "■ Stop recording";

      setHint("Recording your SONORA soundtrack...");

    } catch (error) {
      console.error(error);
      alert("Recording failed: " + error.message);
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    recording = false;
  }

  // =====================================
  // 15. DOWNLOAD AUDIO
  // =====================================

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  // =====================================
  // 16. SAVE LIBRARY
  // =====================================

  function saveTrack() {
    if (!lastRecordingBlob) {
      setHint("Record a soundtrack before saving.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const library = JSON.parse(
          localStorage.getItem("sonoraLibrary") || "[]"
        );

        library.unshift({
          id: Date.now(),
          name: $("imageName").textContent,
          mode: currentMode,
          date: new Date().toLocaleString(),
          audio: reader.result,
          image: canvas.toDataURL("image/jpeg", 0.45)
        });

        localStorage.setItem(
          "sonoraLibrary",
          JSON.stringify(library.slice(0, 5))
        );

        loadLibrary();

        setHint("Soundtrack saved to your library.");

      } catch (error) {
        console.error(error);
        setHint("Storage is full. Try a shorter recording.");
      }
    };

    reader.readAsDataURL(lastRecordingBlob);
  }

  // =====================================
  // 17. LOAD LIBRARY
  // =====================================

  function loadLibrary() {let library = [];

    try {
      library = JSON.parse(
        localStorage.getItem("sonoraLibrary") || "[]"
      );
    } catch (error) {
      console.error("Library error:", error);
    }

    const container = $("libraryList");
    container.innerHTML = "";

    if (!library.length) {
      container.innerHTML =
        '<div class="library-empty">Your saved soundtracks will appear here.</div>';
      return;
    }

    library.forEach(item => {
      const row = document.createElement("div");
      row.className = "library-item";

      const image = document.createElement("img");
      image.className = "library-thumb";
      image.src = item.image || "";
      image.alt = "";

      const meta = document.createElement("div");
      meta.className = "library-meta";

      const name = document.createElement("b");
      name.textContent = item.name;

      const details = document.createElement("small");
      details.textContent = `${item.mode} · ${item.date}`;

      meta.append(name, details);

      const actions = document.createElement("div");
      actions.className = "library-actions";

      const download = document.createElement("button");
      download.className = "small-action";
      download.textContent = "Download";

      download.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = item.audio;
        a.download = `sonora-${item.id}.webm`;
        a.click();
      });

      const remove = document.createElement("button");
      remove.className = "small-action";
      remove.textContent = "Delete";

      remove.addEventListener("click", () => {
        const updated = library.filter(
          track => track.id !== item.id
        );

        localStorage.setItem(
          "sonoraLibrary",
          JSON.stringify(updated)
        );

        loadLibrary();
      });

      actions.append(download, remove);
      row.append(image, meta, actions);

      container.appendChild(row);
    });
  }

  // =====================================
  // 18. BUTTON EVENTS
  // =====================================

  $("uploadBtn").addEventListener("click", event => {
    event.stopPropagation();
    input.click();
  });

  $("changeImageBtn").addEventListener("click", () => {
    input.click();
  });

  input.addEventListener("change", () => {
    if (input.files && input.files[0]) {
      loadImage(input.files[0]);
    }
  });

  drop.addEventListener("click", event => {
    if (event.target === drop || event.target === $("emptyState")) {
      input.click();
    }
  });

  drop.addEventListener("dragover", event => {
    event.preventDefault();
    drop.classList.add("dragging");
  });

  drop.addEventListener("dragleave", () => {
    drop.classList.remove("dragging");
  });

  drop.addEventListener("drop", event => {
    event.preventDefault();
    drop.classList.remove("dragging");

    if (event.dataTransfer.files[0]) {
      loadImage(event.dataTransfer.files[0]);
    }
  });

  $("startBtn").addEventListener("click", startSound);
  $("stopBtn").addEventListener("click", stopSound);

  $("recordBtn").addEventListener("click", () => {
    if (!recording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  $("saveBtn").addEventListener("click", saveTrack);

  // =====================================
  // 19. MODE BUTTONS
  // =====================================

  document.querySelectorAll(".mode").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".mode").forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      currentMode = button.dataset.mode;

      const label = button.querySelector("span");

      setHint(
        `${label ? label.textContent : currentMode} mode selected.`
      );
    });
  });

  // =====================================
  // 20. SLIDERS
  // =====================================

  const sliderIds = [
    "volume",
    "bass",
    "treble",
    "reverb",
    "echo"
  ];

  sliderIds.forEach(id => {
    $(id).addEventListener("input", () => {
      $(id + "Value").textContent = $(id).value + "%";
      updateAudioSettings();
    });
  });

  $("sensitivity").addEventListener("input", () => {
    sensitivity = Number($("sensitivity").value) / 100;

    $("sensitivityValue").textContent =
      sensitivity.toFixed(1) + "×";
  });

  // =====================================
  // 21. INITIALIZE WEBSITE
  // =====================================

  function initialize() {
    resizeVisualizer();
    drawStaticVisualizer();
    loadLibrary();

    setStatus("SYSTEM READY");

    console.log("SONORA JavaScript loaded successfully.");
  }

  window.addEventListener("resize", () => {
    resizeVisualizer();
    drawStaticVisualizer();
  });

  initialize();

})();