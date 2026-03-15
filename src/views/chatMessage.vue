<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ElMessage } from "element-plus";
import MarkdownIt from "markdown-it";
import {
  CopyDocument,
  EditPen,
  Close,
  Delete,
} from "@element-plus/icons-vue";
import { DynamicScroller, DynamicScrollerItem } from "vue-virtual-scroller";

import { chatStream } from "@/apis/deepseek";
import ChatInput from "@/components/chat/ChatInput.vue";
import { useSessionStore } from "@/stores/session";
import assistantAvatar from "@/assets/avatars/assistant.svg";
import userAvatar from "@/assets/avatars/user.svg";

defineOptions({ name: "ChatMessage" });

const sessionStore = useSessionStore();
const msg = ref("");
const isTyping = ref(false);
const showNewMessageIndicator = ref(false);

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

markdown.validateLink = (url) => {
  const value = String(url || "").trim();
  if (!value) return false;
  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    return false;
  }
};

const defaultLinkOpen =
  markdown.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet("href") || "";
  const isExternal =
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:");

  if (isExternal) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const renderMarkdown = (text) => {
  return markdown.render(String(text ?? ""));
};

// 模型选择（你可以固定一个，或者保留选择逻辑）
const selectedModel = computed({
  get: () => sessionStore.model,
  set: (value) => sessionStore.setModel(value),
});
const modelOptions = computed(() => sessionStore.modelOptions);

// 获取当前会话消息
const messages = computed(() => sessionStore.getcurmsgs());


// 自动滚动控制
let autoScroll = true;
const userPaused = ref(false); // 用户手动暂停自动滚动
const scroller = ref(null);
const scrollElement = ref(null);

const resolveScrollElement = () => {
  if (typeof window === "undefined") return null;

  const root = scroller.value?.$el;
  const base =
    root instanceof HTMLElement ? root : document.querySelector(".content");
  if (!base) return null;

  const isScrollable = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const canScroll = overflowY === "auto" || overflowY === "scroll";
    return canScroll && element.scrollHeight > element.clientHeight;
  };

  if (isScrollable(base)) return base;

  const walker = document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    if (isScrollable(node)) {
      return node;
    }
    node = walker.nextNode();
  }

  return base;
};

const isAtBottom = (element) => {
  if (!element) return true;
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 20;
};

const forceScrollToBottom = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const element = scrollElement.value || resolveScrollElement();
  if (!element) return;
  element.scrollTop = element.scrollHeight;
};

const scrollToBottom = async () => {
  if (!autoScroll || userPaused.value) return;
  await nextTick();
  const element = scrollElement.value || resolveScrollElement();
  if (!element) return;
  element.scrollTop = element.scrollHeight;
};

// 监听滚动，判断用户是否离开底部
const handleScroll = () => {
  const element = scrollElement.value;
  if (!element) return;

  const atBottom = isAtBottom(element);

  if (atBottom) {
    userPaused.value = false;
    autoScroll = true;
    showNewMessageIndicator.value = false;
    return;
  }

  autoScroll = false;

  if (isTyping.value) {
    userPaused.value = true;
    showNewMessageIndicator.value = true;
  }
};

// 监听用户交互（打断自动滚动）
const handleUserInteraction = () => {
  if (!isTyping.value) return;
  userPaused.value = true;
  autoScroll = false;
  showNewMessageIndicator.value = true;
};

const registerChatListeners = () => {
  const element = scrollElement.value;
  if (!element) return;
  element.addEventListener("wheel", handleUserInteraction, { passive: true });
  element.addEventListener("touchstart", handleUserInteraction, {
    passive: true,
  });
  element.addEventListener("mousedown", handleUserInteraction, {
    passive: true,
  });
  element.addEventListener("scroll", handleScroll, { passive: true });
};

const removeChatListeners = () => {
  const element = scrollElement.value;
  if (!element) return;
  element.removeEventListener("wheel", handleUserInteraction);
  element.removeEventListener("touchstart", handleUserInteraction);
  element.removeEventListener("mousedown", handleUserInteraction);
  element.removeEventListener("scroll", handleScroll);
};

// 流式缓冲逻辑（核心）
const pendingDeltas = ref("");
let bufferTimer = null;

const flushBuffer = () => {
  if (!pendingDeltas.value) return;
  sessionStore.adddelta(pendingDeltas.value);
  pendingDeltas.value = "";
  scrollToBottom();
};

const onDelta = (delta) => {
  pendingDeltas.value += delta;
  if (!bufferTimer) {
    bufferTimer = setTimeout(() => {
      flushBuffer();
      bufferTimer = null;
    }, 100); // 100ms 缓冲一次，足够平滑
  }
};

const handleStreamFinished = () => {
  isTyping.value = false;
  flushBuffer();
  showNewMessageIndicator.value = false;
};

// 提交发送
const submit = async () => {
  const trimmed = msg.value.trim();
  if (!trimmed) return;

  userPaused.value = false;
  autoScroll = true;
  showNewMessageIndicator.value = false;

  // 1. 用户消息上屏
  sessionStore.sessionpush({
    role: "user",
    content: trimmed,
  });
  msg.value = "";
  await scrollToBottom();

  // 2. AI 消息占位
  const aiMessage = { role: "assistant", content: "" };
  sessionStore.sessionpush(aiMessage);
  isTyping.value = true;

  try {
    // 3. 发起请求
    const payloadMessages = sessionStore.getMessagesForModel();
    // 移除刚加的空消息，避免发给后端
    if (payloadMessages.length) payloadMessages.pop();

    await chatStream(
      payloadMessages,
      onDelta, // 接收增量
      handleStreamFinished, // 完成回调
      null, // 不需要 reasoning
      selectedModel.value
    );
  } catch (error) {
    isTyping.value = false;
    pendingDeltas.value = "";
    sessionStore.adddelta("抱歉，请求出错，请重试。");
    ElMessage.error(error?.message || "请求失败");
    flushBuffer();
  }
};

// 复制功能
const copyMessage = (text) => {
  navigator.clipboard.writeText((text ?? "").trim());
};

// 删除消息
const handleDeleteMessage = (index) => {
  sessionStore.removeMessageAt(index);
};

// 标题编辑逻辑
const isEditingTitle = ref(false);
const tempTitle = ref("");

const startEditing = () => {
  tempTitle.value = sessionStore.curname;
  isEditingTitle.value = true;
  nextTick(() => document.querySelector(".title-input input")?.focus());
};

const saveTitle = () => {
  if (tempTitle.value.trim()) {
    sessionStore.updateTitle(tempTitle.value.trim());
  }
  isEditingTitle.value = false;
};

const cancelEditing = () => isEditingTitle.value = false;

// 切换会话
const selecthistory = (name) => {
  flushBuffer();
  sessionStore.selecthistory(name);
};

defineExpose({ selecthistory });

watch(
  () => sessionStore.curname,
  async () => {
    removeChatListeners();
    userPaused.value = false;
    autoScroll = true;
    showNewMessageIndicator.value = false;
    await nextTick();
    scrollElement.value = resolveScrollElement();
    registerChatListeners();
    await forceScrollToBottom();
  }
);

onMounted(async () => {
  scrollElement.value = resolveScrollElement();
  await forceScrollToBottom();
  registerChatListeners();
});

onBeforeUnmount(() => {
  clearTimeout(bufferTimer);
  flushBuffer();
  removeChatListeners();
});

const scrollToBottomOnClick = async () => {
  userPaused.value = false;
  autoScroll = true;
  showNewMessageIndicator.value = false;
  await forceScrollToBottom();
};
</script>

<template>
  <div class="header">
    <div class="header-title">
      <template v-if="!isEditingTitle">
        {{ sessionStore.curname }}
        <el-icon @click="startEditing"><EditPen /></el-icon>
      </template>
      <template v-else>
        <el-input
          v-model="tempTitle"
          class="title-input"
          size="small"
          @keyup.enter="saveTitle"
          @blur="saveTitle"
        />
        <el-icon @click="cancelEditing"><Close /></el-icon>
      </template>
    </div>
    <el-select
      v-model="selectedModel"
      size="small"
      class="model-select"
      :disabled="isTyping"
      placeholder="选择模型"
      :teleported="false"
    >
      <el-option
        v-for="option in modelOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
  </div>

  <DynamicScroller
    ref="scroller"
    class="content"
    :items="messages"
    :min-item-size="80"
    key-field="id"
    :key="sessionStore.curname"
  >
    <template #default="{ item, index, active }">
      <DynamicScrollerItem
        :item="item"
        :active="active"
        :data-index="index"
        :size-dependencies="[item.content]"
      >
        <div
          class="message-row"
          :class="item.role === 'user' ? 'is-user' : 'is-assistant'"
        >
          <img
            class="message-avatar"
            :src="item.role === 'user' ? userAvatar : assistantAvatar"
            alt="Avatar"
          />
          <div
            class="message"
            :class="item.role === 'user' ? 'user-message' : 'assistant-message'"
          >
            <div class="message-header">
              <span class="message-role">{{ item.role === 'user' ? '我' : 'AI' }}</span>
              <div class="message-actions">
                <el-tooltip content="复制" placement="top">
                  <button @click="copyMessage(item.content)" class="action-btn">
                    <el-icon><CopyDocument /></el-icon>
                  </button>
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <button @click="handleDeleteMessage(index)" class="action-btn">
                    <el-icon><Delete /></el-icon>
                  </button>
                </el-tooltip>
              </div>
            </div>

            <div
              v-if="item.role === 'assistant'"
              class="message-body markdown-body"
              v-html="renderMarkdown(item.content)"
            ></div>
            <div v-else class="message-body plain-body">{{ item.content }}</div>
          </div>
        </div>
      </DynamicScrollerItem>
    </template>
  </DynamicScroller>

  <!-- 输入区 -->
  <ChatInput v-model:msg="msg" v-model:isTyping="isTyping" @submit="submit" />

  <!-- 新消息指示器 -->
  <div
    v-if="showNewMessageIndicator"
    class="new-message-indicator"
    @click="scrollToBottomOnClick"
  >
    👇 新消息
  </div>
</template>

<style scoped>
/* 样式简化版，去掉了 Markdown 相关样式 */
.header {
  padding: 16px 24px;
  background: var(--color-panel);
  border-bottom: 1px solid var(--color-border);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-title {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.model-select {
  width: 140px;
}

.title-input {
  width: 200px;
}

.content {
  flex: 1;
  overflow-y: auto;
  overflow-anchor: none;
  background: var(--color-panel-alt);
  padding: 24px 10% 140px;
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 20px;
}

.message-row.is-user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--color-surface);
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-soft);
}

.message.user-message {
  background: var(--color-bubble-user);
  border-color: var(--color-bubble-user-border);
  color: var(--color-bubble-user-text);
}

.message.assistant-message {
  background: var(--color-elevated-surface);
  color: var(--color-text-primary);
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--color-muted);
}

.message-actions {
  display: flex;
  gap: 4px;
  opacity: 0; /* 默认隐藏，hover 显示 */
  transition: opacity 0.2s;
}

.message:hover .message-actions {
  opacity: 1;
}

.action-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-toolbar-muted);
  padding: 2px;
}

.action-btn:hover {
  color: var(--color-accent);
}

.message-body {
  font-size: 14px;
  line-height: 1.6;
  word-break: break-all;
  color: inherit;
}

.plain-body {
  white-space: pre-wrap;
}

:deep(.markdown-body) {
  white-space: normal;
  color: inherit;
}

:deep(.markdown-body p) {
  margin: 8px 0;
}

:deep(.markdown-body h1),
:deep(.markdown-body h2),
:deep(.markdown-body h3) {
  margin: 12px 0 8px;
  line-height: 1.25;
}

:deep(.markdown-body h1) {
  font-size: 18px;
}

:deep(.markdown-body h2) {
  font-size: 16px;
}

:deep(.markdown-body h3) {
  font-size: 15px;
}

:deep(.markdown-body ul),
:deep(.markdown-body ol) {
  margin: 8px 0;
  padding-left: 20px;
}

:deep(.markdown-body code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  background: rgba(15, 23, 42, 0.06);
  border-radius: 6px;
  padding: 2px 6px;
}

:deep(.markdown-body pre) {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 10px;
  overflow: auto;
  background: rgba(15, 23, 42, 0.06);
}

:deep(.markdown-body pre code) {
  background: transparent;
  padding: 0;
}

:deep(.markdown-body blockquote) {
  margin: 10px 0;
  padding: 0 0 0 12px;
  border-left: 3px solid rgba(59, 130, 246, 0.6);
  color: rgba(15, 23, 42, 0.75);
}

:deep(.markdown-body a) {
  color: var(--color-link);
  text-decoration: none;
}

:deep(.markdown-body a:hover) {
  color: var(--color-link-hover);
  text-decoration: underline;
}

.new-message-indicator {
  position: fixed;
  bottom: 80px;
  right: 24px;
  background: #409eff;
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}
</style>
