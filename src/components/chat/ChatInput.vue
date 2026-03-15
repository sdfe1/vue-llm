<template>
  <div class="container">
    <div class="input-area">
      <textarea
        ref="textarea"
        v-model="inputText"
        class="inputbox"
        :placeholder="placeholder"
        @input="resize"
        @keydown.enter.prevent="handleEnter"
      ></textarea>

      <!-- 语音实时预览 -->
      <div v-if="speechPreview" class="speech-preview">
        <el-icon><Microphone /></el-icon>
        <span>{{ speechPreview }}</span>
      </div>

      <div class="toolbar">
        <!-- 语音按钮 -->
        <button
          v-if="isSpeechSupported"
          class="toolbar-btn"
          :class="{ recording: isRecording }"
          type="button"
          @click="toggleRecording"
          :disabled="isTyping"
        >
          <el-icon><Microphone /></el-icon>
          <span>{{ isRecording ? "停止语音" : "语音输入" }}</span>
        </button>
        <span class="toolbar-hint">Shift + Enter 换行</span>
      </div>
    </div>

    <div class="action-area">
      <button
        v-if="!isTyping"
        class="send-button"
        type="button"
        :disabled="sendDisabled"
        @click="handleSubmit"
      >
        <span>发送</span>
        <el-icon><Promotion /></el-icon>
      </button>
      <button v-else class="stop-button" type="button" @click="stopGeneration">
        停止
        <el-icon class="stop-icon"><CircleClose /></el-icon>
      </button>
    </div>
  </div>
</template>

<script setup>
import {
  CircleClose,
  Microphone,
  Promotion,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  computed,
  defineEmits,
  defineProps,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { abortStream } from "@/apis/deepseek";

defineOptions({ name: "ChatInput" });

const props = defineProps({
  msg: {
    type: String,
    default: "",
  },
  isTyping: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:msg", "update:isTyping", "submit"]);

// 双向绑定输入框内容
const inputText = computed({
  get: () => props.msg,
  set: (val) => emit("update:msg", val),
});

// 是否正在生成
const isTyping = computed({
  get: () => props.isTyping,
  set: (val) => emit("update:isTyping", val),
});

const textarea = ref(null);
const speechPreview = ref("");
const isRecording = ref(false);
const recognition = ref(null);

const placeholder = computed(() =>
  isSpeechSupported.value
    ? "输入你的问题，或点击语音输入按钮试试看…"
    : "输入你的问题…",
);

const sendDisabled = computed(() => !inputText.value.trim());

// Web Speech API 兼容性检测
const isSpeechSupported = computed(
  () =>
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),
);

// 自动调整输入框高度
const resize = () => {
  const el = textarea.value;
  if (!el) return;

  const minHeight = 120;
  const maxHeight = 240;
  el.style.height = "auto";
  const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
};

const handleSubmit = () => {
  if (sendDisabled.value) return;
  emit("submit"); // 不需要传 attachments 了
  speechPreview.value = "";
  nextTick(() => {
    resize();
  });
};

const handleEnter = (event) => {
  if (event.shiftKey) {
    // 换行逻辑保持不变
    const el = textarea.value;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const value = inputText.value;
    const newValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
    inputText.value = newValue;
    nextTick(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 1;
      resize();
    });
    return;
  }
  handleSubmit();
};

const stopGeneration = () => {
  abortStream();
};

// 语音识别逻辑（保留）
const ensureRecognition = () => {
  if (!isSpeechSupported.value || recognition.value) return;

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const instance = new SpeechRecognition();
  instance.lang = "zh-CN";
  instance.interimResults = true;
  instance.continuous = true;

  instance.onresult = (event) => {
    let finalText = "";
    let interimText = "";

    for (const result of event.results) {
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interimText += result[0].transcript;
      }
    }

    if (finalText) {
      inputText.value = `${inputText.value} ${finalText}`.trim();
      nextTick(resize);
    }

    speechPreview.value = interimText;
  };

  instance.onerror = () => {
    stopRecording();
  };

  instance.onend = () => {
    stopRecording();
  };

  recognition.value = instance;
};

const startRecording = () => {
  if (!isSpeechSupported.value || isRecording.value) return;
  ensureRecognition();
  try {
    recognition.value?.start();
    isRecording.value = true;
    speechPreview.value = "正在听…";
  } catch (error) {
    console.error(error);
    ElMessage.error("无法启动语音识别");
    isRecording.value = false;
  }
};

const stopRecording = () => {
  if (recognition.value && typeof recognition.value.stop === "function") {
    recognition.value.stop();
  }
  isRecording.value = false;
  speechPreview.value = "";
};

const toggleRecording = () => {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
};

onMounted(() => {
  resize();
});

onBeforeUnmount(() => {
  stopRecording();
});

watch(inputText, (value) => {
  if (!value.trim()) {
    nextTick(resize);
  }
});

watch(isTyping, (value) => {
  if (value) {
    stopRecording();
  }
});
</script>

<style scoped>
/* 样式保持原样，删除了 .file-input 和 .attachments 相关的样式 */
.container {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--color-panel);
  border-top: 1px solid var(--color-border);
  backdrop-filter: blur(6px);
}

.input-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inputbox {
  width: 100%;
  min-height: 120px;
  max-height: 240px;
  font-size: 15px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 16px;
  border: 1px solid var(--color-border);
  background: var(--color-input-background);
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
  resize: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  outline: none;
}

.inputbox:focus {
  border-color: var(--color-accent);
  box-shadow: 0 4px 18px rgba(59, 130, 246, 0.18);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 12px;
  border: none;
  background: var(--color-toolbar-bg);
  color: var(--color-toolbar-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toolbar-btn:hover {
  background: var(--color-toolbar-hover-bg);
  color: var(--color-accent-strong);
}

.toolbar-btn.recording {
  background: var(--color-stop-button-bg);
  color: var(--color-stop-button-text);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-toolbar-muted);
}

.speech-preview {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--color-toolbar-bg);
  border: 1px solid rgba(59, 130, 246, 0.18);
}

.action-area {
  display: flex;
  align-items: center;
}

.send-button,
.stop-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px;
  height: 48px;
  border-radius: 16px;
  border: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.send-button {
  background: linear-gradient(135deg, var(--color-accent-strong), var(--color-accent));
  color: var(--color-accent-contrast);
  box-shadow: 0 8px 16px rgba(59, 130, 246, 0.28);
}

.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  box-shadow: none;
}

.send-button:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 20px rgba(59, 130, 246, 0.36);
}

.stop-button {
  background: var(--color-stop-button-bg);
  color: var(--color-stop-button-text);
  box-shadow: 0 6px 12px var(--color-stop-button-shadow);
}

.stop-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px var(--color-stop-button-shadow);
}

.stop-icon {
  font-size: 16px;
}

@media (max-width: 960px) {
  .container {
    flex-direction: column;
    align-items: stretch;
  }

  .action-area {
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .container {
    padding: 16px 18px;
    gap: 12px;
  }

  .toolbar {
    gap: 10px;
  }

  .toolbar-hint {
    margin-left: 0;
    width: 100%;
    text-align: right;
  }

  .action-area {
    width: 100%;
  }

  .send-button,
  .stop-button {
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 14px 14px;
  }

  .toolbar-btn span {
    display: none;
  }

  .toolbar-hint {
    font-size: 11px;
  }
}
</style>