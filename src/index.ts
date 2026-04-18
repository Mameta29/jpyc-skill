import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PluginFactory } from './types.js';
import { buildJpycEcCommand } from './commands/jpyc-ec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const create: PluginFactory = (ctx) => ({
  name: 'jpyc-ec',
  commands: buildJpycEcCommand(ctx),
  skills: [
    {
      name: 'jpyc-ec-purchase',
      skillDir: path.resolve(__dirname, '../skills/jpyc-ec-purchase'),
    },
  ],
});

export type { PluginContext, PluginFactory, AcliPlugin, PluginSkill } from './types.js';
