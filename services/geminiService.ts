
import { GoogleGenAI, Type } from "@google/genai";

export const getGeminiPresets = async (description: string) => {
  // Always use a new instance to ensure it uses the latest API key from process.env.API_KEY
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      // Use gemini-3-pro-preview for complex reasoning tasks like acoustic engineering
      model: 'gemini-3-pro-preview',
      contents: `
        [Role] Professional Acoustic Engineer
        [Task] Create 3 reverb presets for the following environment:
        "${description}"
        
        [Constraints]
        - Output strictly valid JSON.
        - No prose, no explanations.
        - rt60: 0.1 to 8.0 (seconds)
        - damping: 1.0 to 10.0
        - preDelay: 0.0 to 0.3 (seconds)
        - lowCut: 20 to 1500 (Hz)
        - highCut: 500 to 20000 (Hz)
        - wetGain: 0.0 to 1.0
      `,
      config: {
        // By default, the model decides how much to think, but for complex tasks, pro models benefit from reasoning.
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            presets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  settings: {
                    type: Type.OBJECT,
                    properties: {
                      reverbDuration: { type: Type.NUMBER },
                      reverbDecay: { type: Type.NUMBER },
                      reverbPreDelay: { type: Type.NUMBER },
                      lowCut: { type: Type.NUMBER },
                      highCut: { type: Type.NUMBER },
                      wetGain: { type: Type.NUMBER }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const data = JSON.parse(text);
    return (data.presets || []).map((p: any) => ({
      ...p,
      settings: {
        ...p.settings,
        dryGain: 0.0,
        wetPathDryGain: 1.0
      }
    }));
  } catch (e) {
    console.error("Gemini API Error:", e);
    return [];
  }
};
