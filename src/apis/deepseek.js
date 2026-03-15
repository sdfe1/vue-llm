const BASE_URL = "https://api.deepseek.com/v1";
let currentAbortController = null;

// 🌊 流式对话（核心函数 - Fetch 实现）
export async function chatStream(
  messages,
  onChunk,
  onDone,
  onReasoning,
  model = "deepseek-reasoner",
) {
  // 1. 创建 AbortController 用于中断请求
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  try {
    const apiKey = (import.meta.env?.VITE_DEEPSEEK_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error(
        "未配置 DeepSeek API Key，请在 .env.local 中设置 VITE_DEEPSEEK_API_KEY",
      );
    }
    
    // 2. 发起 Fetch 请求 
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        model: model || "deepseek-reasoner",
        messages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.error?.message || `请求失败: ${response.status}`;
      throw new Error(msg);
    }

    // 3. 获取 Reader 和 Decoder 
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = ""; // 用于处理粘包的缓冲区

    // 4. 循环读取流
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 解码当前块并追加到缓冲区
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // 按双换行符分割 SSE 消息
      const lines = buffer.split("\n");
      // 保留最后一个可能不完整的片段在缓冲区中
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith("data: ")) continue;

        const data = trimmedLine.slice(6); // 去掉 "data: " 前缀

        if (data === "[DONE]") {
          onDone?.();
          return;
        }

        try {
          const payload = JSON.parse(data);
          
          // 处理推理内容
          const reasoning = payload.choices?.[0]?.delta?.reasoning_content;
          if (reasoning) onReasoning?.(reasoning);

          // 处理回复内容
          const content = payload.choices?.[0]?.delta?.content;
          if (content) onChunk?.(content);
        } catch (e) {
          console.warn("解析 SSE 消息失败:", e);
        }
      }
    }
    
    onDone?.();

  } catch (error) {
    if (error.name === "AbortError") {
      onDone?.(); // 用户手动停止
    } else {
      throw error;
    }
  } finally {
    currentAbortController = null;
  }
}

export function abortStream() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}
