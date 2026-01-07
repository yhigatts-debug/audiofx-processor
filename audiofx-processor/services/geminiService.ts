
import { GoogleGenAI, Type } from "@google/genai";

export const getGeminiPresets = async (description: string) => {
  // リクエストの直前にインスタンスを生成（最新のAPIキーを反映するため）
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
        thinkingConfig: { thinkingBudget: 0 },
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
