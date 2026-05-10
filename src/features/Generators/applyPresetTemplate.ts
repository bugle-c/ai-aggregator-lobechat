const PLACEHOLDER = '{{user_prompt}}';

/**
 * Render a preset prompt template with the user-typed prompt.
 *
 * Behaviour matches higgsfield's flow: the template wraps the user
 * prompt rather than replacing it. If the template contains
 * `{{user_prompt}}`, every occurrence is substituted. If the template
 * has no placeholder (e.g. just a style tag), the user prompt is
 * appended after a comma. If the template is empty, the user prompt
 * is returned untouched.
 */
export const applyPresetTemplate = (
  template: string | undefined | null,
  userPrompt: string,
): string => {
  const prompt = userPrompt.trim();
  if (!template) return prompt;

  if (template.includes(PLACEHOLDER)) {
    return template.split(PLACEHOLDER).join(prompt);
  }

  return prompt ? `${template}, ${prompt}` : template;
};
