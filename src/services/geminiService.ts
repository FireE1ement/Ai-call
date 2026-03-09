import { GoogleGenAI, Modality } from "@google/genai";

export class GeminiVoiceAssistant {
  private ai: any;
  private session: any;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(systemInstruction: string, onMessage: (text: string, audio?: string) => void) {
    try {
      this.session = await this.ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            console.log("Gemini Live session opened");
          },
          onmessage: async (message: any) => {
            if (message.serverContent?.modelTurn?.parts) {
              const textPart = message.serverContent.modelTurn.parts.find((p: any) => p.text);
              const audioPart = message.serverContent.modelTurn.parts.find((p: any) => p.inlineData);
              
              if (textPart || audioPart) {
                onMessage(textPart?.text || "", audioPart?.inlineData?.data);
              }
            }
            
            if (message.serverContent?.outputAudioTranscription) {
               // Handle transcription if needed
            }
          },
          onerror: (error: any) => {
            console.error("Gemini Live error:", error);
          },
          onclose: () => {
            console.log("Gemini Live session closed");
          }
        }
      });
    } catch (error) {
      console.error("Failed to connect to Gemini Live:", error);
      throw error;
    }
  }

  async sendAudio(base64Data: string) {
    if (this.session) {
      await this.session.sendRealtimeInput({
        media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
      });
    }
  }

  async sendText(text: string) {
    if (this.session) {
      await this.session.sendRealtimeInput({
        text
      });
    }
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
  }
}
