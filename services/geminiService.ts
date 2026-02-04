
import { GoogleGenAI, Type } from "@google/genai";

export const getGeminiPresets = async (description: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        [Role] Professional Acoustic Engineer & Sound Designer
        [Task] Create 3 highly realistic reverb presets for the environment: "${description}"
        
        [Available Engines & Required Specific Params]
        1. "lexicon" (Rich FDN): Classic lush reverb.
           Params to set: lexSpin (0-2), lexWander (0-1), lexBassMult (0.5-2).
        2. "bricasti" (Dense Schroeder): Realistic rooms/spaces.
           Params to set: briDensity (0-1), briSize (0.1-5), briVRoll (1000-20000).
        3. "tcelectronic" (Advanced FDN8): Transparent & Airy.
           Params to set: tcAir (0-1), tcEarlyLate (0-1), tcHiDamp (0-1).

        [Common Params]
        - reverbDuration (RT60): 0.1 to 10.0s
        - reverbPreDelay: 0.0 to 0.3s
        - lowCut: 20 to 1000Hz
        - highCut: 1000 to 20000Hz
        - wetGain: 0.2 to 1.2 (Standard is 0.6)

        [Requirement]
        For each preset, select the most appropriate engine (algoMode) and MUST provide realistic values for its specific parameters listed above.
        
        [Output] Strictly JSON only.
      `,
      config: {
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
                      algoMode: { type: Type.STRING, description: "Must be 'lexicon', 'bricasti', or 'tcelectronic'" },
                      reverbDuration: { type: Type.NUMBER },
                      reverbPreDelay: { type: Type.NUMBER },
                      lowCut: { type: Type.NUMBER },
                      highCut: { type: Type.NUMBER },
                      wetGain: { type: Type.NUMBER },
                      // Lexicon
                      lexSpin: { type: Type.NUMBER },
                      lexWander: { type: Type.NUMBER },
                      lexBassMult: { type: Type.NUMBER },
                      // Bricasti
                      briDensity: { type: Type.NUMBER },
                      briSize: { type: Type.NUMBER },
                      briVRoll: { type: Type.NUMBER },
                      // TC
                      tcAir: { type: Type.NUMBER },
                      tcEarlyLate: { type: Type.NUMBER },
                      tcHiDamp: { type: Type.NUMBER }
                    },
                    required: ["algoMode", "reverbDuration", "reverbPreDelay", "lowCut", "highCut", "wetGain"]
                  }
                }
              }
            }
          }
        }
      }
    });

    const text = response.text?.trim();
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
  } catch (e: any) {
    console.error("Gemini API Error:", e);
    throw new Error("Geminiからの応答が不正です。もう一度お試しください。");
  }
};
