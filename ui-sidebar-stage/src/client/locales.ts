/**
 * `sidebarStage` namespace dictionaries, and the namespace's declaration.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarStage'>` or `PropsLocale<'sidebarStage'>` needs only
 * this file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Stage tab type name, guide entry, and body states. */
    sidebarStage: SidebarStageKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '阶段',
  'guide.title': '阶段',
  'guide.description': '查看当前阶段与阶段旅程',
  empty: '这个会话还没有阶段记录。',
  emptyTitle: '还没有阶段',
  emptyHint: '这个会话进入阶段后，阶段旅程会出现在这里。',
  current: '当前阶段',
  history: '切换历史',
  journey: '阶段旅程',
  switched: '切换到',
  entered: '进入',
  switchTo: '切换到…',
  switchStage: '切换阶段',
  switchFailed: '切换失败',
  switchUnavailable: '阶段切换命令不可用',
  live: '进行中',
  idle: '空闲',
  inStage: '在本阶段',
  notStarted: '等待首轮',
  now: '当前',
  notVisited: '未访问',
  nextUp: '下一站',
  visitedCount: '已访问 {count} 个',
  messages: '消息',
  tools: '工具调用',
  tokens: 'Token',
  messagesShort: '条',
  toolsShort: '工具',
  errorsShort: '错误',
  contextShort: '上下文',
  requested: '已请求 {stage}',
  historyTruncated: '更早的阶段记录未显示。',
  historyPartial: '更早的历史未加载，计数可能不完整。',
  searchPlaceholder: '切换到阶段…',
  route: '阶段路线',
  noMatches: '没有匹配的阶段',
  custom: '自定义',
  hintNavigate: '选择',
  hintSwitch: '切换',
  hintClose: '关闭',
  typeAny: '或直接输入阶段名',
  switchRow: '切换',
  openStage: '打开阶段视图',
} satisfies Record<string, string>

/** English dictionary. */
export const en: Record<SidebarStageKey, string> = {
  'type.label': 'Stage',
  'guide.title': 'Stage',
  'guide.description': 'Current stage and stage journey',
  empty: 'No stage records in this session yet.',
  emptyTitle: 'No stage yet',
  emptyHint: 'Once this session enters a stage, its journey appears here.',
  current: 'Current stage',
  history: 'Transition history',
  journey: 'Journey',
  switched: 'Switched to',
  entered: 'Entered',
  switchTo: 'Switch to…',
  switchStage: 'Switch stage',
  switchFailed: 'Switch failed',
  switchUnavailable: 'The stage switch command is unavailable',
  live: 'Live',
  idle: 'Idle',
  inStage: 'in stage',
  notStarted: 'Waiting for the first turn',
  now: 'Now',
  notVisited: 'Not visited',
  nextUp: 'next up',
  visitedCount: '{count} visited',
  messages: 'messages',
  tools: 'tool calls',
  tokens: 'tokens',
  messagesShort: 'msg',
  toolsShort: 'tools',
  errorsShort: 'errors',
  contextShort: 'CTX',
  requested: 'Requested {stage}',
  historyTruncated: 'Earlier stage visits are not shown.',
  historyPartial: 'Older history is not loaded; counts may be partial.',
  searchPlaceholder: 'Switch to stage…',
  route: 'Route',
  noMatches: 'No matching stage',
  custom: 'custom',
  hintNavigate: 'navigate',
  hintSwitch: 'switch',
  hintClose: 'close',
  typeAny: 'or type any stage name',
  switchRow: 'Switch',
  openStage: 'Open stage view',
}

/** Every key the namespace defines. */
export type SidebarStageKey = keyof typeof zh

/** This package's copy namespace. */
export const NS = 'sidebarStage'
