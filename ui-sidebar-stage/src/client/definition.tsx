/**
 * What the `stage` tab type IS: a page type opened by kind, offered through
 * the guide, in the extension band (a type from outside the product).
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const STAGE_KIND = 'stage'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const STAGE_ID = '@ai4rpg/dsh-ui-sidebar-stage'

/**
 * The stage type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function stageDefinition(t: TranslateNS<'sidebarStage'>): SidebarRightTabDefinition {
  return {
    id: STAGE_ID,
    kind: STAGE_KIND,
    priority: 'extension',
    title: () => t('type.label'),
    guide: [{
      id: 'stage',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }
}
