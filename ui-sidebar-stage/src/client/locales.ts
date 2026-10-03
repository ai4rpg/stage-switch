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
  'guide.description': '查看当前阶段与切换历史',
  empty: '这个会话还没有阶段记录。',
  current: '当前阶段',
  history: '切换历史',
  switched: '切换到',
  entered: '进入',
} satisfies Record<string, string>

/** English dictionary. */
export const en: Record<SidebarStageKey, string> = {
  'type.label': 'Stage',
  'guide.title': 'Stage',
  'guide.description': 'Current stage and transition history',
  empty: 'No stage records in this session yet.',
  current: 'Current stage',
  history: 'Transition history',
  switched: 'Switched to',
  entered: 'Entered',
}

/** Every key the namespace defines. */
export type SidebarStageKey = keyof typeof zh

/** This package's copy namespace. */
export const NS = 'sidebarStage'
