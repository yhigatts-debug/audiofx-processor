
import { GoogleGenAI, Type } from "@google/genai";

export const getGeminiPresets = async (description: string) => {
  // ブラウザ環境において、複数の方法でAPIキーの取得を試みます
  const apiKey = (window as any).process?.env?.API_KEY || 
                 (typeof process !== 'undefined' ? process.env?.API_KEY : undefined);

  if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.length < 10) {
    // Netlifyの「Environment variables」はビルド用であり、ブラウザからは直接見えません。
    // 「Snippet injection」機能を使用して、以下を注入する必要があります：
    // <script>window.process = { env: { API_KEY: "あなたのキー" } };</script>
    throw new Error("APIキーが正しく認識されていません。NetlifyのSnippet設定で window.process.env.API_KEY が正しく定義されているか確認してください。");
  }

  // APIを呼び出す直前にインスタンス化し、常に最新のキーを使用するようにします
  const ai = new GoogleGenAI({ apiKey });

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
  } catch (e: any) {
    console.error("Gemini API Error details:", e);
    // SDK内部のエラーメッセージをより分かりやすいものに変換
    if (e.message?.includes("API Key")) {
      throw new Error("APIキーがSDKに正しく渡されていません。Snippetの記述（window.process.env.API_KEY = \"...\"）を確認してください。");
    }
    throw new Error(e.message || "Gemini APIへの接続中にエラーが発生しました。");
  }
};
