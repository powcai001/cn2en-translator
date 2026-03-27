import axios from "axios";

export interface TranslateSettings {
  apiProvider: "google" | "openai";
  openaiApiKey: string;
  openaiApiUrl: string;
  openaiAuthHeaderName?: string;
  openaiAuthPrefix?: string;
  openaiModel: string;
  // 截图翻译相关设置
  visionModel?: string;
}

// 百度翻译API配置
const BAIDU_APP_ID = process.env.VITE_BAIDU_APP_ID || "";
const BAIDU_SECRET_KEY = process.env.VITE_BAIDU_SECRET_KEY || "";

// 生成百度翻译API签名
function generateBaiduSign(query: string, salt: string): string {
  const crypto = require("crypto");
  const str = BAIDU_APP_ID + query + salt + BAIDU_SECRET_KEY;
  return crypto.md5(str).toString();
}

// 使用百度翻译API
async function baiduTranslate(text: string): Promise<string> {
  if (!BAIDU_APP_ID || !BAIDU_SECRET_KEY) {
    throw new Error("请配置百度翻译API密钥");
  }

  const sourceLanguage = detectLanguage(text);
  const targetLanguage = getTargetLanguage(sourceLanguage);
  const salt = Date.now().toString();
  const sign = generateBaiduSign(text, salt);

  const response = await axios.get(
    "https://fanyi-api.baidu.com/api/trans/vip/translate",
    {
      params: {
        q: text,
        from: sourceLanguage,
        to: targetLanguage,
        appid: BAIDU_APP_ID,
        salt,
        sign,
      },
    },
  );

  if (response.data.error_code) {
    throw new Error(`翻译API错误: ${response.data.error_msg}`);
  }

  return response.data.trans_result.map((item: any) => item.dst).join("\n");
}

// 使用Google Translate（免费API）
async function googleTranslate(text: string): Promise<string> {
  const sourceLanguage = detectLanguage(text);
  const targetLanguage = getTargetLanguage(sourceLanguage);

  const response = await axios.get(
    "https://translate.googleapis.com/translate_a/single",
    {
      params: {
        client: "gtx",
        sl: sourceLanguage === "zh" ? "zh-CN" : "en",
        tl: targetLanguage === "zh" ? "zh-CN" : "en",
        dt: "t",
        q: text,
      },
      timeout: 10000,
    },
  );

  return response.data[0].map((item: any) => item[0]).join("");
}

function normalizeChatCompletionsUrl(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/$/, "");

  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

function buildAuthHeaders(settings: TranslateSettings): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = settings.openaiApiKey?.trim();
  const headerName = settings.openaiAuthHeaderName?.trim();
  const prefix = settings.openaiAuthPrefix?.trim();

  if (token && headerName) {
    headers[headerName] = prefix ? `${prefix} ${token}` : token;
  }

  return headers;
}

function detectLanguage(text: string): "zh" | "en" {
  const chineseMatches = text.match(/[\u4e00-\u9fff]/g) || [];
  const englishMatches = text.match(/[a-zA-Z]/g) || [];

  return chineseMatches.length >= englishMatches.length ? "zh" : "en";
}

function getTargetLanguage(sourceLanguage: "zh" | "en"): "zh" | "en" {
  return sourceLanguage === "zh" ? "en" : "zh";
}

// 使用OpenAI API
async function openaiTranslate(
  text: string,
  settings: TranslateSettings,
): Promise<string> {
  if (!settings.openaiApiUrl?.trim()) {
    throw new Error("请配置 OpenAI 兼容接口地址");
  }

  const sourceLanguage = detectLanguage(text);
  const targetLanguage = getTargetLanguage(sourceLanguage);
  const systemPrompt =
    targetLanguage === "zh"
      ? "You are a professional translator. Detect whether the input is mainly English or Chinese. Translate English into natural Simplified Chinese, and Chinese into natural English. Only return the translation."
      : "You are a professional translator. Detect whether the input is mainly Chinese or English. Translate Chinese into natural English, and English into natural Simplified Chinese. Only return the translation.";

  const requestUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);
  const response = await axios.post(
    requestUrl,
    {
      model: settings.openaiModel || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    {
      headers: buildAuthHeaders(settings),
      timeout: 30000,
    },
  );

  if (response.data.error) {
    throw new Error(`OpenAI API错误: ${response.data.error.message}`);
  }

  return response.data.choices[0]?.message?.content?.trim() || "翻译失败";
}

// 主翻译函数
export async function translate(
  text: string,
  settings?: TranslateSettings,
): Promise<string> {
  const provider = settings?.apiProvider || "google";

  if (provider === "openai") {
    return await openaiTranslate(text, settings!);
  }

  // Google翻译（备用百度）
  try {
    return await googleTranslate(text);
  } catch (error) {
    console.warn("Google翻译失败，尝试备用方案...", error);
    try {
      return await baiduTranslate(text);
    } catch (baiduError) {
      throw new Error("所有翻译服务均不可用，请检查网络连接");
    }
  }
}

export async function translateImage(
  imageBuffer: Buffer,
  settings: TranslateSettings,
): Promise<string> {
  if (!settings.openaiApiUrl?.trim()) {
    throw new Error("请配置 OpenAI 兼容接口地址");
  }

  const base64Image = imageBuffer.toString("base64");
  const requestUrl = normalizeChatCompletionsUrl(settings.openaiApiUrl);

  const response = await axios.post(
    requestUrl,
    {
      model: settings.visionModel || "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Detect whether the main text in this image is primarily English or Chinese. Translate English into natural Simplified Chinese, and Chinese into natural English. Return only the translation. If there is no clear Chinese or English text, return "No text detected".',
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    },
    {
      headers: buildAuthHeaders(settings),
      timeout: 30000,
    },
  );

  if (response.data.error) {
    throw new Error(`OpenAI API错误: ${response.data.error.message}`);
  }

  const result =
    response.data.choices[0]?.message?.content?.trim() || "翻译失败";

  // 处理可能的多模态响应格式
  if (result.includes("No text detected")) {
    return "未检测到文字";
  }

  return result;
}
