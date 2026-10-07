import type { ElementTable } from 'claude-code'

/**
 * The elements the views draw with: what every surface has, plus `Input` where there is one (the mobile
 * surface has no text field, so search is skipped there).
 */
export type Kit = Pick<ElementTable, 'Box' | 'Text' | 'Button' | 'Code'> & { Input?: ElementTable<'terminal'>['Input'] }

export function kitOf(elements: ElementTable): Kit {
  const { Box, Text, Button, Code } = elements
  return { Box, Text, Button, Code, Input: 'Input' in elements ? elements.Input : undefined }
}
