# TASK-034: Voice Mode — Full Conversation (Claude.ai Pattern)
## Priority: FEATURE | Phase: V4 | Depends on: TASK-018 (streaming)
## Files allowed: lib/voice/*, components/ubunye/UbunyeVoice.tsx, components/ubunye/UbunyeChat.tsx

## Description
Add two-way voice conversation to Ubunye chat. User speaks, Ubunye speaks back.

## Stage 1 — Free (Browser APIs):
Voice In: Web Speech API (SpeechRecognition)
Voice Out: Web Speech API (speechSynthesis)
Cost: R0

## Stage 2 — Premium (swap later):
Voice In: OpenAI Whisper (all SA languages)
Voice Out: ElevenLabs (natural voice, clone Thabang's voice)
Cost: ~R200/month

## Implementation:

### lib/voice/types.ts
export interface STTProvider {
  startListening(options: { lang: string, onResult: (text: string) => void, onEnd: () => void }): void;
  stopListening(): void;
  isSupported(): boolean;
}

export interface TTSProvider {
  speak(text: string, options?: { lang?: string, rate?: number, voice?: string }): Promise<void>;
  stopSpeaking(): void;
  isSupported(): boolean;
}

### lib/voice/stt/browser.ts — Web Speech API
### lib/voice/stt/whisper.ts — OpenAI Whisper (future)
### lib/voice/tts/browser.ts — Web Speech API
### lib/voice/tts/elevenlabs.ts — ElevenLabs (future)

### lib/voice/index.ts
Reads: VOICE_STT_PROVIDER=browser, VOICE_TTS_PROVIDER=browser

### components/ubunye/UbunyeVoice.tsx
Two modes:

1. PUSH-TO-TALK:
   - Mic button next to chat input
   - Hold to speak, release to send
   - Visual: mic icon turns gold, pulse animation
   - Transcription shows live in input field

2. HANDS-FREE (like Claude.ai):
   - Toggle button: "Voice Mode" in chat header
   - When on, full conversation loop:
     a. Ubunye finishes speaking
     b. Auto-starts listening (2 second delay)
     c. User speaks naturally
     d. Detects pause (1.5 seconds silence) → sends message
     e. Ubunye responds with text
     f. Text-to-speech reads response aloud
     g. Back to step (a)
   - User can interrupt — start talking and Ubunye stops speaking
   - "End Voice Mode" button always visible

3. SPEAKER BUTTON on each message:
   - Small speaker icon on every Ubunye response
   - Click to read that message aloud
   - Shows progress bar while speaking

### Visual design:
- Energy sphere reacts to voice amplitude (AudioContext analyser)
- Sphere pulses with user's voice input
- Sphere glows while Ubunye speaks
- Sphere dims in silence between turns
- Full screen mode on mobile with large mic button

### Language support:
- en-ZA (English South Africa) — default
- zu-ZA (Zulu)
- xh-ZA (Xhosa)
- st-ZA (Sotho)
- af-ZA (Afrikaans)
- Language selector in voice mode settings

### Accessibility:
- Works with screen readers
- Keyboard shortcut: hold Space for push-to-talk
- Visual transcript always shown alongside audio
- Captions during Ubunye speech

## Acceptance criteria
- [ ] Push-to-talk works — hold mic, speak, release, message sends
- [ ] Hands-free works — continuous conversation loop
- [ ] Speaker button on each message reads aloud
- [ ] Energy sphere reacts to voice
- [ ] Language selector with 5+ SA languages
- [ ] Falls back gracefully on unsupported browsers
- [ ] Mobile: large mic button, works in portrait
- [ ] npm run build passes