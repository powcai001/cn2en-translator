import axios from 'axios'

export interface TranslateSettings {
  apiProvider: 'google' | 'openai'
  openaiApiKey: string
  openaiApiUrl: string
  openaiModel: string
}

// 百度翻译API配置
const BAIDU_APP_ID = process.env.VITE_BAIDU_APP_ID || ''
const BAIDU_SECRET_KEY = process.env.VITE_BAIDU_SECRET_KEY || ''

// 生成百度翻译API签名
function generateBaiduSign(query: string, salt: string): string {
  const crypto = require('crypto')
  const str = BAIDU_APP_ID + query + salt + BAIDU_SECRET_KEY
  return crypto.md5(str).toString()
}

// 使用百度翻译API
async function baiduTranslate(text: string): Promise<string> {
  if (!BAIDU_APP_ID || !BAIDU_SECRET_KEY) {
    throw new Error('请配置百度翻译API密钥')
  }

  const salt = Date.now().toString()
  const sign = generateBaiduSign(text, salt)

  const response = await axios.get(
    'https://fanyi-api.baidu.com/api/trans/vip/translate',
    {
      params: {
        q: text,
        from: 'zh',
        to: 'en',
        appid: BAIDU_APP_ID,
        salt,
        sign,
      },
    }
  )

  if (response.data.error_code) {
    throw new Error(`翻译API错误: ${response.data.error_msg}`)
  }

  return response.data.trans_result.map((item: any) => item.dst).join('\n')
}

// 使用Google Translate（免费API）
async function googleTranslate(text: string): Promise<string> {
  const response = await axios.get(
    'https://translate.googleapis.com/translate_a/single',
    {
      params: {
        client: 'gtx',
        sl: 'zh-CN',
        tl: 'en',
        dt: 't',
        q: text,
      },
      timeout: 10000,
    }
  )

  return response.data[0].map((item: any) => item[0]).join('')
}

// 使用OpenAI API
async function openaiTranslate(text: string, settings: TranslateSettings): Promise<string> {
  if (!settings.openaiApiKey) {
    throw new Error('请配置OpenAI API密钥')
  }

  const baseUrl = settings.openaiApiUrl.replace(/\/$/, '')
  const response = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model: settings.openaiModel || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Translate the given Chinese text to English. Only return the translation, no explanations.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.openaiApiKey}`
      },
      timeout: 30000,
    }
  )

  if (response.data.error) {
    throw new Error(`OpenAI API错误: ${response.data.error.message}`)
  }

  return response.data.choices[0]?.message?.content?.trim() || '翻译失败'
}

// 主翻译函数
export async function translate(text: string, settings?: TranslateSettings): Promise<string> {
  const provider = settings?.apiProvider || 'google'

  if (provider === 'openai') {
    return await openaiTranslate(text, settings!)
  }

  // Google翻译（备用百度）
  try {
    return await googleTranslate(text)
  } catch (error) {
    console.warn('Google翻译失败，尝试备用方案...', error)
    try {
      return await baiduTranslate(text)
    } catch (baiduError) {
      throw new Error('所有翻译服务均不可用，请检查网络连接')
    }
  }
}
