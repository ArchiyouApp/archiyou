/**
 * feedback — send visitor feedback from a configurator (server: routes/feedback.ts).
 *
 * Public: works signed out. The script it was about is taken from the configurator's
 * active script, and the page URL (params included) so the configuration can be
 * reproduced when the feedback is read on /admin.
 */

import { editorScript } from '../state/core';

import { api } from './api.js';

export async function sendConfiguratorFeedback(message: string): Promise<void>
{
  const script = editorScript.get();
  await api.post('/feedback', {
    message,
    scriptId: script?.id ?? null,
    fileId: script?.fileId ?? null,
    scriptAuthor: script?.author ?? null,
    scriptName: script?.name ?? null,
    scriptVersion: script?.version ?? null,
    url: window.location.href.slice(0, 2000),
  });
}
